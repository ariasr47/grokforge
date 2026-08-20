use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use hmac::{Hmac, Mac};
use rand::RngCore;
use sha2::Sha256;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Emitter, Manager};

// ---------------------------------------------------------------------------------------------
// D3 — compile-time channel (SPEC §2.7 "the channel a build reports is part of this contract",
// AC-S8). Deliberately NOT std::env::var: a runtime GROKFORGE_CHANNEL=dev on a prod install would
// move the data root, the port and the allowlist. Set by scripts/tauri-build.mjs /
// scripts/tauri-dev.mjs at packaging/dev-launch time; build.rs reruns on a change.
// ---------------------------------------------------------------------------------------------
const BUILD_CHANNEL: &str = match option_env!("GROKFORGE_BUILD_CHANNEL") {
    Some(c) => c,
    None => "prod",
};

fn host_channel() -> &'static str {
    if matches!(BUILD_CHANNEL, "dev" | "development" | "tst" | "test" | "qa") {
        "dev"
    } else {
        "prod"
    }
}

// ---------------------------------------------------------------------------------------------
// D4 — bounded port ladder, disjoint per channel so a prod app never squats the dev preferred
// port. Earns its cost on Windows excluded port ranges (Hyper-V/WinNAT/Docker reserve dynamic TCP
// ranges), where a fixed port makes an install simply dead with no user-available recovery.
// ---------------------------------------------------------------------------------------------
fn ladder() -> &'static [u16] {
    if host_channel() == "dev" {
        &[8788, 8810, 8811, 8812, 8813, 8814, 8815, 8816]
    } else {
        &[8787, 8800, 8801, 8802, 8803, 8804, 8805, 8806]
    }
}

/// Instance ownership (SPEC §2.5): a packaged build NEVER attaches to a listener it did not spawn,
/// whatever that listener's health payload says. A rung held by anything at all is a reason to
/// STEP, not to attach — the operator's monorepo `npm run start` resolves channel prod and binds
/// 8787 at the same commit, so an identity rule would call that a match and attach, which is
/// exactly the state AC20 forbids.
fn rung_is_free(port: u16) -> bool {
    if std::net::TcpListener::bind(("127.0.0.1", port)).is_ok() {
        return true;
    }
    // Exclusive bind fails for both a live listener and TIME_WAIT. Node can
    // listen through TIME_WAIT (SO_REUSEADDR); only a process that still
    // accepts connections is a reason to step.
    let Ok(addr) = host_addr(port).parse() else {
        return false;
    };
    TcpStream::connect_timeout(&addr, Duration::from_millis(150)).is_err()
}

fn host_addr(port: u16) -> String {
    format!("127.0.0.1:{}", port)
}

// ---------------------------------------------------------------------------------------------
// B9 — extended HostStatus, closed reason set (INTERFACE_CONTRACT.md "Launcher -> shell
// boundary"). `origin_refused` is the SINGLE spelling — `origin_rejected` appears nowhere.
// ---------------------------------------------------------------------------------------------
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct HostStatus {
    ok: bool,
    phase: &'static str, // "starting" | "ready" | "failed"
    owned: bool,
    port: Option<u16>,
    pid: Option<u32>,
    reason: Option<&'static str>,
    os_error: Option<i32>,
    message: String, // Details disclosure + diagnostics ONLY — never a headline
}

const REASON_ENTRY_MISSING: &str = "entry_missing";
const REASON_RUNTIME_MISSING: &str = "runtime_missing";
const REASON_PORT_UNAVAILABLE: &str = "port_unavailable";
const REASON_HEALTH_TIMEOUT: &str = "health_timeout";
const REASON_CRASHED: &str = "crashed";
const REASON_ORIGIN_REFUSED: &str = "origin_refused";
#[allow(dead_code)]
const REASON_FOREIGN_HOST: &str = "foreign_host"; // §5 row 9: Details annotation only, no card
#[allow(dead_code)]
const REASON_UNKNOWN: &str = "unknown";

/// SPEC §5 rows 1-4. The shell keys card selection on (reason, osError); the launcher never
/// attributes a cause it cannot observe.
fn classify_spawn_error(
    err: &std::io::Error,
    runtime_present: bool,
) -> (&'static str, Option<i32>) {
    let code = err.raw_os_error();
    if !runtime_present {
        return (REASON_ENTRY_MISSING, code);
    }
    (REASON_RUNTIME_MISSING, code)
}

// ---------------------------------------------------------------------------------------------
// B11 — one Job Object per spawned host, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE (SPEC §2.6, D2).
//
// Explicit close  => reaps the dead host AND its ACP grandchild before a replacement spawns.
// Implicit close  => the OS reaps the tree when the app process goes away (graceful exit, crash,
//                    or Task Manager kill), which is the whole-app teardown requirement.
//
// KILL_ON_JOB_CLOSE fires when the JOB HANDLE closes, not when a member dies — which is exactly
// why a mid-session host crash leaves an orphaned ACP grandchild unless the handle is closed
// first. That is the defect AC-S7 exists to catch. Assignment races nothing: the host has zero
// ACP children until the first prompt, so CREATE_SUSPENDED is not required.
// ---------------------------------------------------------------------------------------------
#[cfg(windows)]
struct HostJob(windows_sys::Win32::Foundation::HANDLE);

#[cfg(windows)]
unsafe impl Send for HostJob {}

#[cfg(windows)]
impl HostJob {
    fn create_and_assign(pid: u32) -> Option<Self> {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };
        use windows_sys::Win32::System::Threading::{
            OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
        };

        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return None;
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let ok = SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const core::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if ok == 0 {
                CloseHandle(job);
                return None;
            }
            let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
            if process.is_null() {
                CloseHandle(job);
                return None;
            }
            let assigned = AssignProcessToJobObject(job, process);
            CloseHandle(process);
            if assigned == 0 {
                CloseHandle(job);
                return None;
            }
            Some(HostJob(job))
        }
    }
}

#[cfg(windows)]
impl Drop for HostJob {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0);
        }
    }
}

struct HostProcess {
    child: Mutex<Option<Child>>,
    /// True if this app instance spawned the process (should kill on exit).
    owned: Mutex<bool>,
    #[cfg(windows)]
    job: Mutex<Option<HostJob>>,
    /// D2 fallback: set when AssignProcessToJobObject failed for the current child, so reap_host
    /// falls back to `taskkill /PID <pid> /T /F` instead of relying on the (absent) job handle.
    reap_by_taskkill: AtomicBool,
    reaped_pid: AtomicU32,
    /// B12 — the WHOLE ensure body (health probe -> ladder -> spawn -> wait-healthy -> sanity
    /// check) is serialized under this mutex, because ensure_host_inner runs both from setup()
    /// and as an invokable command. The old Mutex<Option<Child>> was held only while storing the
    /// child, so two hosts could both survive and each own an ACP child under a different root.
    ensure: Mutex<()>,
    /// B14 — bounded auto-restart bookkeeping: attempts within the current 60s window.
    restart_attempts: Mutex<Vec<std::time::Instant>>,
    /// Set once a restart cycle comes to rest in the terminal failure state, so the watcher stops
    /// trying and the reaped-tree observable (AC-S7) settles at zero of each process.
    terminal: AtomicBool,
    /// Monotonically increasing generation counter: each ensure/spawn bumps it, and the watcher
    /// thread for a given child exits once its generation is stale (a newer spawn superseded it).
    generation: AtomicU64,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BypassUnlockState {
    unlocked: bool,
    confirmation_version: Option<u32>,
    managed_disabled: bool,
    local_attestation: &'static str,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BypassActivationCapability {
    session_id: String,
    activation_token: String,
    expires_at: String,
}

// The host owns capability consumption/replay protection. The desktop keeps
// only the unlock bit and signing key; it must not maintain a second token
// ledger that can drift from the host's authoritative single-use check.
struct BypassState {
    unlocked: Mutex<bool>,
    secret: Vec<u8>,
}

fn bypass_view(state: &BypassState) -> BypassUnlockState {
    let unlocked = state.unlocked.lock().map(|v| *v).unwrap_or(false);
    let managed_disabled = std::env::var("GROKFORGE_MANAGED_BYPASS_DISABLED").ok().as_deref() == Some("1");
    // Repository/user-controlled environment can only make the capability
    // stricter; it can never assert an approved isolation context.
    let local_attestation = local_attestation();
    BypassUnlockState {
        unlocked,
        confirmation_version: unlocked.then_some(1),
        managed_disabled,
        local_attestation,
    }
}

fn local_attestation() -> &'static str {
    if std::env::var("GROKFORGE_LOCAL_ATTESTATION").ok().as_deref().is_some_and(|v| v != "") { return "unavailable"; }
    #[cfg(windows)] {
        use windows_sys::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
        use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
        unsafe {
            let mut token = std::ptr::null_mut();
            if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 { return "unavailable"; }
            let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 }; let mut size = 0u32;
            let ok = GetTokenInformation(token, TokenElevation, &mut elevation as *mut _ as *mut _, std::mem::size_of::<TOKEN_ELEVATION>() as u32, &mut size);
            windows_sys::Win32::Foundation::CloseHandle(token);
            if ok == 0 { return "unavailable"; }
            if elevation.TokenIsElevated != 0 { return "unavailable"; }
        }
    }
    #[cfg(not(windows))]
    { return "unavailable"; }
    #[cfg(windows)]
    { "local_standard_user" }
}
fn attestation_allows_bypass(attestation: &str, managed_disabled: bool) -> bool { !managed_disabled && attestation == "local_standard_user" }

#[tauri::command]
fn get_bypass_permissions_unlock(app: tauri::AppHandle) -> BypassUnlockState {
    app.state::<BypassState>().inner().clone_view()
}

impl BypassState {
    fn clone_view(&self) -> BypassUnlockState {
        bypass_view(self)
    }
}

#[tauri::command]
fn unlock_bypass_permissions(
    app: tauri::AppHandle,
    acknowledged: bool,
    confirmation_version: u32,
) -> Result<BypassUnlockState, String> {
    if !acknowledged || confirmation_version != 1 {
        return Err("confirmation_required".into());
    }
    let state = app.state::<BypassState>();
    let managed_disabled = std::env::var("GROKFORGE_MANAGED_BYPASS_DISABLED").ok().as_deref() == Some("1");
    if managed_disabled { return Err("bypass_disabled".into()); }
    if !attestation_allows_bypass(local_attestation(), managed_disabled) { return Err("attestation_unavailable".into()); }
    *state.unlocked.lock().map_err(|_| "state_unavailable")? = true;
    let view = bypass_view(&state);
    persist_bypass_unlock(&app, true);
    Ok(view)
}

#[tauri::command]
fn lock_bypass_permissions(app: tauri::AppHandle) -> BypassUnlockState {
    let state = app.state::<BypassState>();
    if let Ok(mut v) = state.unlocked.lock() {
        *v = false;
    }
    persist_bypass_unlock(&app, false);
    bypass_view(&state)
}

#[tauri::command]
fn authorize_bypass_permissions_activation(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<BypassActivationCapability, String> {
    if session_id.trim().is_empty() {
        return Err("session_required".into());
    }
    let state = app.state::<BypassState>();
    let managed_disabled = std::env::var("GROKFORGE_MANAGED_BYPASS_DISABLED").ok().as_deref() == Some("1");
    if managed_disabled { return Err("bypass_disabled".into()); }
    if !attestation_allows_bypass(local_attestation(), managed_disabled) { return Err("attestation_unavailable".into()); }
    if !state
        .unlocked
        .lock()
        .map_err(|_| "state_unavailable")?
        .to_owned()
    {
        return Err("unlock_required".into());
    }
    let host_pid = app.state::<HostProcess>().reaped_pid.load(Ordering::SeqCst);
    if host_pid == 0 {
        return Err("host_unavailable".into());
    }
    let mut nonce_bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = URL_SAFE_NO_PAD.encode(nonce_bytes);
    let issued = now_millis();
    let expires = issued + 60_000;
    let payload = serde_json::json!({"sessionId":session_id,"desktopProcessId":std::process::id(),"hostProcessId":host_pid,"nonce":nonce,"expiresAt":expires,"issuedAt":issued});
    let token = sign_activation_payload(&state.secret, &payload).map_err(|_| "token_secret")?;
    Ok(BypassActivationCapability {
        session_id,
        activation_token: token,
        expires_at: iso8601_from_epoch_ms(expires),
    })
}

fn now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

/// Host-compatible capability encoding: URL-safe JSON body, then HMAC-SHA256
/// over the exact body bytes using the URL-safe encoded shared secret.
fn sign_activation_payload(
    secret: &[u8],
    payload: &serde_json::Value,
) -> Result<String, &'static str> {
    let body = URL_SAFE_NO_PAD.encode(serde_json::to_vec(payload).map_err(|_| "token_encode")?);
    let shared_key = URL_SAFE_NO_PAD.encode(secret);
    let mut mac =
        Hmac::<Sha256>::new_from_slice(shared_key.as_bytes()).map_err(|_| "token_secret")?;
    mac.update(body.as_bytes());
    Ok(format!(
        "{}.{}",
        body,
        URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
    ))
}
fn persist_bypass_unlock(app: &tauri::AppHandle, unlocked: bool) {
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = std::fs::create_dir_all(&dir);
        let body = if unlocked {
            "{\"unlocked\":true,\"confirmationVersion\":1}"
        } else {
            "{\"unlocked\":false}"
        };
        let _ = std::fs::write(dir.join("bypass-unlock.json"), body.as_bytes());
    }
}
fn load_bypass_unlock(app: &tauri::AppHandle) -> bool {
    app.path()
        .app_data_dir()
        .ok()
        .and_then(|d| std::fs::read_to_string(d.join("bypass-unlock.json")).ok())
        .map(|s| s.contains("\"unlocked\":true"))
        .unwrap_or(false)
}

fn is_repo_root(dir: &Path) -> bool {
    // Monorepo layout only. A Tauri debug output dir also has
    // resources/host/index.js (copied from src-tauri/resources); treating that
    // as the repo root makes `tauri dev` spawn the leftover packaged host
    // (prod allowlist) and CORS-refuse the Vite origin.
    dir.join("apps")
        .join("host")
        .join("src")
        .join("index.ts")
        .is_file()
        || (dir.join("package.json").is_file()
            && dir.join("apps").join("host").is_dir()
            && dir.join("apps").join("shell").is_dir())
}

/// Dev-only walk-up, explicitly gated behind `cfg!(debug_assertions)` by its only caller
/// (`resource_root`). SPEC §2.3: the `std::env::current_dir()` fallback that used to terminate
/// this walk is DELETED — a shortcut launch, an Explorer launch and a terminal launch give three
/// different CWDs, so the same binary could otherwise resolve three different host entries.
#[cfg(debug_assertions)]
fn repo_root_dev() -> PathBuf {
    if let Ok(p) = std::env::var("GROKFORGE_ROOT") {
        let pb = PathBuf::from(p);
        if is_repo_root(&pb) {
            return pb;
        }
    }
    // Walk up from the running binary (dev + installed near monorepo)
    if let Ok(exe) = std::env::current_exe() {
        let mut dir = exe.parent().map(|p| p.to_path_buf());
        for _ in 0..10 {
            if let Some(ref d) = dir {
                if is_repo_root(d) {
                    return d.clone();
                }
                dir = d.parent().map(|p| p.to_path_buf());
            } else {
                break;
            }
        }
    }
    // Compile-time monorepo layout: apps/shell/src-tauri
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    if let Some(root) = manifest
        .parent()
        .and_then(|p| p.parent())
        .and_then(|p| p.parent())
    {
        if is_repo_root(root) {
            return root.to_path_buf();
        }
    }
    // Non-existent sentinel rather than current_dir(): a dev checkout that cannot be located this
    // way is a real configuration error, not something to paper over with an arbitrary CWD
    // (SPEC §2.3 — a shortcut, an Explorer launch and a terminal launch would otherwise resolve
    // three different host entries from the same binary).
    PathBuf::from("\\\\?\\GROKFORGE_REPO_ROOT_NOT_FOUND")
}

/// B8 — resource resolution (SPEC §2.3). Packaged: Tauri's resolver. Dev: the walk-up above,
/// behind an explicit `cfg!(debug_assertions)` gate. No `std::env::current_dir()` fallback.
fn resource_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // Dev: walk up to the monorepo. Do this BEFORE Tauri's resource_dir — in
    // `tauri dev` that directory is the debug output with a stale packaged
    // host, not the source tree.
    if cfg!(debug_assertions) {
        #[cfg(debug_assertions)]
        {
            let root = repo_root_dev();
            if is_repo_root(&root) {
                return Ok(root);
            }
        }
    }
    if let Ok(dir) = app.path().resource_dir() {
        if dir
            .join("resources")
            .join("host")
            .join("index.js")
            .is_file()
        {
            return Ok(dir);
        }
    }
    Err("resources/host/index.js not found under the resolved resource root".to_string())
}

fn host_healthy_at(port: u16) -> bool {
    let addr: std::net::SocketAddr = match host_addr(port).parse() {
        Ok(a) => a,
        Err(_) => return false,
    };
    let mut stream = match TcpStream::connect_timeout(&addr, Duration::from_millis(400)) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(600)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(600)));
    let req = format!(
        "GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n\r\n",
        port
    );
    if stream.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut buf = Vec::new();
    let _ = stream.read_to_end(&mut buf);
    let text = String::from_utf8_lossy(&buf);
    text.contains("200") && (text.contains("\"ok\":true") || text.contains("\"ok\": true"))
}

/// Decodes an HTTP/1.1 `Transfer-Encoding: chunked` body (RFC 7230 §4.1) into its payload.
/// `/api/health` is sent by `apps/host/src/index.ts` via the bare `http` module, which chunks
/// any `res.end(data)` call that did not set an explicit `Content-Length` — so the raw body here
/// begins with a hex chunk-size line (`d5\r\n{...}\r\n0\r\n\r\n`), not the JSON itself. Concatenates
/// every chunk's data until the terminating zero-size chunk; returns `None` on a malformed chunk
/// stream rather than guessing.
fn dechunk_body(body: &str) -> Option<String> {
    let mut out = String::new();
    let mut rest = body;
    loop {
        let line_end = rest.find("\r\n")?;
        let size_line = rest[..line_end].split(';').next().unwrap_or("").trim();
        let size = usize::from_str_radix(size_line, 16).ok()?;
        let data_start = line_end + 2;
        if size == 0 {
            return Some(out);
        }
        let data_end = data_start.checked_add(size)?;
        if data_end > rest.len() {
            return None;
        }
        out.push_str(&rest[data_start..data_end]);
        rest = rest.get(data_end..)?.strip_prefix("\r\n")?;
    }
}

/// Parses `service` and `pid` out of the raw `/api/health` JSON body without pulling in a JSON
/// crate dependency for two fields (this file already avoids serde_json parsing on the hot path).
/// Honors `Transfer-Encoding: chunked` (see `dechunk_body`) rather than assuming the host will
/// ever stop chunking — `host_healthy_at()` above stays a raw substring match and is unaffected
/// either way, since the JSON payload lands inside a single chunk.
fn health_service_and_pid(port: u16) -> Option<(String, u32)> {
    let addr: std::net::SocketAddr = host_addr(port).parse().ok()?;
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_millis(400)).ok()?;
    let _ = stream.set_read_timeout(Some(Duration::from_millis(600)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(600)));
    let req = format!(
        "GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n\r\n",
        port
    );
    stream.write_all(req.as_bytes()).ok()?;
    let mut buf = Vec::new();
    let _ = stream.read_to_end(&mut buf);
    let text = String::from_utf8_lossy(&buf);
    let header_end = text.find("\r\n\r\n")?;
    let headers = &text[..header_end];
    let raw_body = &text[header_end + 4..];
    let is_chunked = headers.lines().any(|line| {
        let mut parts = line.splitn(2, ':');
        let name = parts.next().unwrap_or("").trim();
        let value = parts.next().unwrap_or("").trim();
        name.eq_ignore_ascii_case("transfer-encoding")
            && value.to_ascii_lowercase().contains("chunked")
    });
    let body = if is_chunked {
        dechunk_body(raw_body)?
    } else {
        raw_body.to_string()
    };
    let json: serde_json::Value = serde_json::from_str(&body).ok()?;
    let service = json.get("service")?.as_str()?.to_string();
    let pid = json.get("pid")?.as_u64()? as u32;
    Some((service, pid))
}

fn wait_healthy(port: u16, timeout: Duration) -> bool {
    let start = std::time::Instant::now();
    while start.elapsed() < timeout {
        if host_healthy_at(port) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    false
}

// ---------------------------------------------------------------------------------------------
// B13 — native origin probe (SPEC §2.9). From inside the WebView a 403 carrying no
// Access-Control-Allow-Origin surfaces to fetch() as a rejected promise indistinguishable from
// connection-refused, so a shell-side rule for this class can never fire and would collapse into
// health_timeout — the single most likely packaging bug in this feature would present as "the
// engine didn't start".
//
// The explicit header is LOAD-BEARING: request-lockdown.ts returns true for an absent Origin, so
// a header-less probe returns 200 and proves nothing. That is why this cannot reuse
// host_healthy_at(). Do not change host_healthy_at(): it stays header-less on purpose (AC-S3).
// ---------------------------------------------------------------------------------------------
const PACKAGED_ORIGIN: &str = "http://tauri.localhost";

enum OriginProbe {
    Allowed,
    Refused,
    NotListening,
}

fn probe_origin(port: u16) -> OriginProbe {
    let addr: std::net::SocketAddr = match host_addr(port).parse() {
        Ok(a) => a,
        Err(_) => return OriginProbe::NotListening,
    };
    let mut stream = match TcpStream::connect_timeout(&addr, Duration::from_millis(500)) {
        Ok(s) => s,
        Err(_) => return OriginProbe::NotListening,
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(800)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(800)));
    let req = format!(
        "GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nOrigin: {}\r\nConnection: close\r\n\r\n",
        port, PACKAGED_ORIGIN
    );
    if stream.write_all(req.as_bytes()).is_err() {
        return OriginProbe::NotListening;
    }
    let mut buf = Vec::new();
    let _ = stream.read_to_end(&mut buf);
    let text = String::from_utf8_lossy(&buf);
    if text.starts_with("HTTP/1.1 200") || text.starts_with("HTTP/1.0 200") {
        OriginProbe::Allowed
    } else if text.starts_with("HTTP/1.1 403") || text.starts_with("HTTP/1.0 403") {
        OriginProbe::Refused
    } else {
        OriginProbe::NotListening
    }
}

fn host_log_paths(root: &Path) -> (PathBuf, PathBuf) {
    let dir = data_dir()
        .map(|h| h.join("logs"))
        .unwrap_or_else(|| root.join(".grokforge-logs"));
    let _ = std::fs::create_dir_all(&dir);
    (dir.join("host-stdout.log"), dir.join("host-stderr.log"))
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

/// B8 step 5 / SPEC §2.4: the host data root, channel-derived, never repo-relative. `%LOCALAPPDATA%`
/// (the install tree, `installMode: currentUser`) is user-writable, so keeping secrets and logs
/// under the data root instead is a structural property, not a code-review promise.
fn data_dir() -> Option<PathBuf> {
    dirs_home().map(|h| {
        h.join(if host_channel() == "dev" {
            ".grokforge-dev"
        } else {
            ".grokforge"
        })
    })
}

fn runtime_port_record_path() -> Option<PathBuf> {
    data_dir().map(|d| d.join("runtime-port.json"))
}

fn write_runtime_port_record(port: u16, pid: u32) {
    let Some(path) = runtime_port_record_path() else {
        return;
    };
    let _ = std::fs::create_dir_all(path.parent().unwrap_or(Path::new(".")));
    let body = format!(
        "{{\"port\":{},\"pid\":{},\"channel\":\"{}\",\"updatedAt\":\"{}\"}}",
        port,
        pid,
        host_channel(),
        chrono_like_now(),
    );
    let _ = std::fs::write(&path, body);
}

fn clear_runtime_port_record() {
    if let Some(path) = runtime_port_record_path() {
        let _ = std::fs::remove_file(path);
    }
}

/// A minimal RFC3339-ish timestamp with no extra date crate — good enough for a diagnostics field,
/// never parsed by anything in this feature.
fn chrono_like_now() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}", now.as_secs())
}

fn iso8601_from_epoch_ms(ms: u128) -> String {
    let secs = ms / 1000;
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let z = days + 719_468;
    let era = (if z >= 0 { z } else { z - 146_096 }) / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    let year = y + if m <= 2 { 1 } else { 0 };
    format!("{year:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3_600, (rem % 3_600) / 60, rem % 60)
}

fn spawn_host_process(
    root: &Path,
    port: u16,
    bypass_secret: &[u8],
) -> Result<(Child, bool), String> {
    let (stdout_path, stderr_path) = host_log_paths(root);
    let stdout_file = std::fs::File::create(&stdout_path)
        .map_err(|e| format!("host stdout log: {e} ({})", stdout_path.display()))?;
    let stderr_file = std::fs::File::create(&stderr_path)
        .map_err(|e| format!("host stderr log: {e} ({})", stderr_path.display()))?;

    // Packaged resources first (desktop-self-host), then monorepo tsx entry (dev-only).
    let resource_host = root.join("resources").join("host").join("index.js");
    let resource_agent = root
        .join("resources")
        .join("agents")
        .join("grok-acp")
        .join("index.js");
    let resource_node = root.join("resources").join("runtime").join("node.exe");

    let mut runtime_present = resource_node.exists();
    let mut entry_present = resource_host.exists();

    let mut cmd = if resource_host.exists() && resource_node.exists() {
        // §2.1 isolation rule: a packaged launch never consults system Node, on any path
        // including retry — this branch is the ONLY packaged spawn path.
        let mut c = Command::new(&resource_node);
        c.arg(resource_host.as_os_str());
        c
    } else if cfg!(debug_assertions) {
        // Dev-only: system Node + tsx loader in THIS process. Never the tsx CLI
        // (`cli.mjs` re-execs a child, so /api/health.pid != spawn pid and the
        // post-spawn ownership check reaps + walks the whole port ladder).
        // Never reachable in a release build (SPEC §2.1).
        let tsx_loader = root
            .join("node_modules")
            .join("tsx")
            .join("dist")
            .join("loader.mjs");
        let host_entry = root.join("apps").join("host").join("src").join("index.ts");
        entry_present = host_entry.exists() || resource_host.exists();
        runtime_present = true; // dev path relies on system Node; not the isolation-rule surface
        let node_bin = std::env::var("GROKFORGE_NODE").unwrap_or_else(|_| "node".into());
        if host_entry.exists() && tsx_loader.is_file() {
            let loader_url = format!(
                "file:///{}",
                tsx_loader.to_string_lossy().replace('\\', "/")
            );
            let mut c = Command::new(&node_bin);
            c.arg("--import").arg(loader_url).arg(host_entry.as_os_str());
            c
        } else if host_entry.exists() {
            let mut c = Command::new(&node_bin);
            c.args(["--import", "tsx"]).arg(host_entry.as_os_str());
            c
        } else {
            return Err(format!(
                "Host entry missing at {} (and no resources/host/index.js).",
                host_entry.display()
            ));
        }
    } else {
        return Err(format!(
            "Host entry missing at {} (packaged build, no dev fallback).",
            resource_host.display()
        ));
    };

    let _ = (runtime_present, entry_present); // consulted by classify_spawn_error's caller

    // B8 step 5 / SPEC §2.4: cwd is the DATA dir, never the install directory.
    let cwd = data_dir().unwrap_or_else(|| root.to_path_buf());
    let _ = std::fs::create_dir_all(&cwd);
    cmd.current_dir(&cwd);

    // Host spawn environment (INTERFACE_CONTRACT.md): absolute values only, nothing that moves
    // os.homedir() (no HOME/USERPROFILE override), never GROKFORGE_CHANNEL=dev in a prod build.
    cmd.env("GROKFORGE_PORT", port.to_string())
        .env("GROKFORGE_CHANNEL", host_channel())
        .env("GROKFORGE_ROOT", root.as_os_str())
        // Bind host attestation to this desktop process. The host compares
        // this value with the signed payload.desktopProcessId.
        .env("GROKFORGE_DESKTOP_PID", std::process::id().to_string())
        .env(
            "GROKFORGE_BYPASS_SECRET",
            URL_SAFE_NO_PAD.encode(bypass_secret),
        )
        .stdout(Stdio::from(stdout_file))
        .stderr(Stdio::from(stderr_file))
        .stdin(Stdio::null());

    if resource_agent.exists() {
        cmd.env("GROKFORGE_AGENT_ENTRY", resource_agent.as_os_str());
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    match cmd.spawn() {
        Ok(child) => Ok((child, runtime_present)),
        Err(e) => Err(format!("__SPAWN_ERROR__{}", e)),
    }
}

/// D2 — reap the currently-held child (job-handle close, or the taskkill fallback), called as the
/// FIRST step of every restart attempt and every terminal transition (SPEC §2.6). This is the
/// mechanism AC-S7 is checking: KILL_ON_JOB_CLOSE does not fire on a single member's death, so a
/// dead host's ACP grandchild is only reaped here, before a replacement spawns.
fn reap_host(state: &HostProcess) {
    let pid = state
        .child
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|c| c.id()))
        .or_else(|| {
            let p = state.reaped_pid.load(Ordering::SeqCst);
            if p != 0 {
                Some(p)
            } else {
                None
            }
        });
    state.reap_by_taskkill.store(false, Ordering::SeqCst);

    #[cfg(windows)]
    if let Ok(mut job) = state.job.lock() {
        // Dropping the HostJob closes the handle -> KILL_ON_JOB_CLOSE reaps the tree.
        *job = None;
    }

    // Always taskkill on Windows. Node can break away from the job, and
    // TIME_WAIT on every ladder rung after a half-killed walk is exactly
    // `port_unavailable` ("Forge couldn't get a connection on this PC").
    #[cfg(windows)]
    if let Some(pid) = pid {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }

    if let Ok(mut guard) = state.child.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    if let Ok(mut owned) = state.owned.lock() {
        *owned = false;
    }
    clear_runtime_port_record();
}

/// After reap, Windows keeps the listen port in TIME_WAIT. `rung_is_free`
/// uses an exclusive bind, so the whole ladder looks taken until that
/// expires — which is how Try again produced `port_unavailable` with no
/// other Forge copy running.
fn wait_any_rung_free(timeout: Duration) -> bool {
    let start = std::time::Instant::now();
    loop {
        if ladder().iter().copied().any(rung_is_free) {
            return true;
        }
        if start.elapsed() >= timeout {
            return false;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn current_owned_pid(app: &tauri::AppHandle) -> (bool, Option<u32>) {
    let owned = app
        .try_state::<HostProcess>()
        .and_then(|s| s.owned.lock().ok().map(|g| *g))
        .unwrap_or(false);
    let pid = app
        .try_state::<HostProcess>()
        .and_then(|s| s.child.lock().ok().and_then(|g| g.as_ref().map(|c| c.id())));
    (owned, pid)
}

/// B10 — the ensure body: walk the ladder, spawn, wait-healthy, post-spawn sanity check, then
/// (B13) the native origin probe. Runs entirely under `state.ensure`'s lock (B12), and every early
/// return still drops the guard because the guard is a local binding scoped to this function.
fn ensure_host_inner(app: &tauri::AppHandle) -> HostStatus {
    let state = match app.try_state::<HostProcess>() {
        Some(s) => s,
        None => {
            return HostStatus {
                ok: false,
                phase: "failed",
                owned: false,
                port: None,
                pid: None,
                reason: Some(REASON_UNKNOWN),
                os_error: None,
                message: "internal: HostProcess state missing".into(),
            };
        }
    };
    let _guard = state.ensure.lock().unwrap_or_else(|p| p.into_inner());

    // Already healthy on the preferred rung under OUR ownership? Nothing to do.
    let (owned, existing_pid) = current_owned_pid(app);
    if owned {
        if let Some(pid) = existing_pid {
            let preferred = ladder()[0];
            if host_healthy_at(preferred) {
                if let Some((service, hpid)) = health_service_and_pid(preferred) {
                    if service == "grokforge-host" && hpid == pid {
                        return HostStatus {
                            ok: true,
                            phase: "ready",
                            owned: true,
                            port: Some(preferred),
                            pid: Some(pid),
                            reason: None,
                            os_error: None,
                            message: "Host running (started by this app)".into(),
                        };
                    }
                }
            }
        }
    }

    // Not (yet) healthy under our ownership — reap any prior child we own, then walk the ladder.
    reap_host(&state);
    if !wait_any_rung_free(Duration::from_secs(5)) {
        return HostStatus {
            ok: false,
            phase: "failed",
            owned: false,
            port: None,
            pid: None,
            reason: Some(REASON_PORT_UNAVAILABLE),
            os_error: None,
            message: "Every rung of the port ladder is held.".into(),
        };
    }

    let root = match resource_root(app) {
        Ok(r) => r,
        Err(e) => {
            return HostStatus {
                ok: false,
                phase: "failed",
                owned: false,
                port: None,
                pid: None,
                reason: Some(REASON_ENTRY_MISSING),
                os_error: None,
                message: e,
            };
        }
    };

    for &rung in ladder() {
        if !rung_is_free(rung) {
            continue; // held by anything at all is a reason to STEP (SPEC §2.5)
        }

        // Known BEFORE spawning, independent of the spawn Result, so a spawn failure can still be
        // classified (SPEC §5 rows 1-4: entry_missing vs runtime_missing hinges on this).
        let runtime_present_for_classification = root
            .join("resources")
            .join("runtime")
            .join("node.exe")
            .exists()
            || cfg!(debug_assertions);

        let bypass_secret = app.state::<BypassState>().secret.clone();
        let (child, _runtime_present) = match spawn_host_process(&root, rung, &bypass_secret) {
            Ok(v) => v,
            Err(e) => {
                if let Some(raw) = e.strip_prefix("__SPAWN_ERROR__") {
                    let io_err = std::io::Error::from_raw_os_error(
                        raw.rsplit("os error ")
                            .next()
                            .and_then(|s| s.trim_end_matches(')').parse::<i32>().ok())
                            .unwrap_or(0),
                    );
                    let (reason, os_error) =
                        classify_spawn_error(&io_err, runtime_present_for_classification);
                    return HostStatus {
                        ok: false,
                        phase: "failed",
                        owned: false,
                        port: None,
                        pid: None,
                        reason: Some(reason),
                        os_error,
                        message: raw.to_string(),
                    };
                }
                return HostStatus {
                    ok: false,
                    phase: "failed",
                    owned: false,
                    port: None,
                    pid: None,
                    reason: Some(REASON_ENTRY_MISSING),
                    os_error: None,
                    message: e,
                };
            }
        };
        let pid = child.id();

        #[cfg(windows)]
        {
            match HostJob::create_and_assign(pid) {
                Some(job) => {
                    if let Ok(mut g) = state.job.lock() {
                        *g = Some(job);
                    }
                    state.reap_by_taskkill.store(false, Ordering::SeqCst);
                }
                None => {
                    // D2 fallback: AssignProcessToJobObject failed. Record the OS error and mark
                    // this child for taskkill-based reaping instead.
                    state.reap_by_taskkill.store(true, Ordering::SeqCst);
                    state.reaped_pid.store(pid, Ordering::SeqCst);
                }
            }
        }

        if let Ok(mut guard) = state.child.lock() {
            *guard = Some(child);
        }
        if let Ok(mut o) = state.owned.lock() {
            *o = true;
        }
        state.reaped_pid.store(pid, Ordering::SeqCst);
        state.generation.fetch_add(1, Ordering::SeqCst);
        state.terminal.store(false, Ordering::SeqCst);

        if !wait_healthy(rung, Duration::from_secs(20)) {
            // Never healthy on OUR rung with OUR child — stop, do not step (SPEC B10 step 3): a
            // health bug must not be hidden behind a port walk.
            reap_host(&state);
            return HostStatus {
                ok: false,
                phase: "failed",
                owned: false,
                port: None,
                pid: None,
                reason: Some(REASON_HEALTH_TIMEOUT),
                os_error: None,
                message: format!("Host started (pid {pid}) but /api/health never became ready."),
            };
        }

        // Post-spawn sanity check (D4): service AND pid must match. A mismatch means something
        // else answers on this rung — kill our child, step to the next rung.
        match health_service_and_pid(rung) {
            Some((service, hpid)) if service == "grokforge-host" && hpid == pid => {
                // B13 — native origin probe. A refused engine is useless; reap it.
                match probe_origin(rung) {
                    OriginProbe::Refused => {
                        reap_host(&state);
                        return HostStatus {
                            ok: false,
                            phase: "failed",
                            owned: false,
                            port: Some(rung),
                            pid: None,
                            reason: Some(REASON_ORIGIN_REFUSED),
                            os_error: None,
                            message: format!(
                                "Host on :{rung} refused the packaged origin ({PACKAGED_ORIGIN})."
                            ),
                        };
                    }
                    OriginProbe::NotListening => {
                        // Raced the child exiting right after the health check passed — treat as
                        // a timeout, not a distinct class (SPEC §2.9).
                        reap_host(&state);
                        return HostStatus {
                            ok: false,
                            phase: "failed",
                            owned: false,
                            port: None,
                            pid: None,
                            reason: Some(REASON_HEALTH_TIMEOUT),
                            os_error: None,
                            message: "Host became unreachable during the origin probe.".into(),
                        };
                    }
                    OriginProbe::Allowed => {}
                }

                write_runtime_port_record(rung, pid);
                return HostStatus {
                    ok: true,
                    phase: "ready",
                    owned: true,
                    port: Some(rung),
                    pid: Some(pid),
                    reason: None,
                    os_error: None,
                    message: format!("Host started (pid {pid})"),
                };
            }
            _ => {
                // §5 row 9 / foreign_host: unreachable as a launch OUTCOME under instance
                // ownership — a held-but-foreign rung is a reason to step, never a terminal
                // state. Logged as a Details annotation only; the loop continues to the next rung.
                reap_host(&state);
                continue;
            }
        }
    }

    HostStatus {
        ok: false,
        phase: "failed",
        owned: false,
        port: None,
        pid: None,
        reason: Some(REASON_PORT_UNAVAILABLE),
        os_error: None,
        message: "Every rung of the port ladder is held.".into(),
    }
}

#[tauri::command]
fn ensure_host(app: tauri::AppHandle) -> HostStatus {
    // B12: no longer returns Result — a rejected promise reaches the shell as an opaque error and
    // collapses the closed reason set (INTERFACE_CONTRACT.md).
    let status = ensure_host_inner(&app);
    if status.ok {
        if let Some(state) = app.try_state::<HostProcess>() {
            spawn_watcher(app.clone(), state.generation.load(Ordering::SeqCst));
        }
    }
    status
}

#[tauri::command]
fn host_status(app: tauri::AppHandle) -> HostStatus {
    let (owned, pid) = current_owned_pid(&app);
    let port = pid.and_then(|_| ladder().iter().copied().find(|&p| host_healthy_at(p)));
    if let Some(p) = port {
        HostStatus {
            ok: true,
            phase: "ready",
            owned,
            port: Some(p),
            pid,
            reason: None,
            os_error: None,
            message: "Host healthy".into(),
        }
    } else {
        HostStatus {
            ok: false,
            phase: "failed",
            owned,
            port: None,
            pid,
            reason: None,
            os_error: None,
            message: "Host offline".into(),
        }
    }
}

#[tauri::command]
fn restart_host(app: tauri::AppHandle) -> HostStatus {
    if let Some(state) = app.try_state::<HostProcess>() {
        // D2/§2.6: reap FIRST, before any replacement spawns — the whole point of the ordering.
        reap_host(&state);
        std::thread::sleep(Duration::from_millis(400));
    }
    let status = ensure_host_inner(&app);
    if status.ok {
        if let Some(state) = app.try_state::<HostProcess>() {
            spawn_watcher(app.clone(), state.generation.load(Ordering::SeqCst));
        }
    }
    status
}

// ---------------------------------------------------------------------------------------------
// B14 — supervision and bounded auto-restart (SPEC §2.6). The FIRST and ONLY pre-authorised cut
// if effort overruns (D6). At most 3 attempts in 60s with backoff (1s, 2s, 4s), then a terminal
// failure state. Every attempt reaps FIRST — the job's KILL_ON_JOB_CLOSE does not fire when a
// single member dies, so a naive restart would leave the dead host's ACP grandchild orphaned and
// bring up a second host whose first prompt spawns a second ACP child (AC-S7).
// ---------------------------------------------------------------------------------------------
fn spawn_watcher(app: tauri::AppHandle, generation: u64) {
    std::thread::spawn(move || {
        let pid = {
            let state = match app.try_state::<HostProcess>() {
                Some(s) => s,
                None => return,
            };
            state
                .child
                .lock()
                .ok()
                .and_then(|g| g.as_ref().map(|c| c.id()))
        };
        let Some(_pid) = pid else { return };

        // Poll rather than Child::wait() directly on the stored child, since the child handle is
        // shared with restart_host/reap_host via the same Mutex.
        loop {
            std::thread::sleep(Duration::from_millis(700));
            let state = match app.try_state::<HostProcess>() {
                Some(s) => s,
                None => return,
            };
            if state.generation.load(Ordering::SeqCst) != generation {
                return; // superseded by a newer spawn/restart — this watcher's job is done
            }
            let exited = {
                match state.child.lock() {
                    Ok(mut guard) => match guard.as_mut() {
                        Some(child) => matches!(child.try_wait(), Ok(Some(_))),
                        None => true, // already reaped elsewhere
                    },
                    Err(_) => true,
                }
            };
            if !exited {
                continue;
            }
            if state.generation.load(Ordering::SeqCst) != generation {
                return;
            }

            let _ = app.emit(
                "host-status",
                HostStatus {
                    ok: false,
                    phase: "failed",
                    owned: true,
                    port: None,
                    pid: None,
                    reason: Some(REASON_CRASHED),
                    os_error: None,
                    message: "Host process exited unexpectedly.".into(),
                },
            );

            let mut attempts = state
                .restart_attempts
                .lock()
                .unwrap_or_else(|p| p.into_inner());
            let now = std::time::Instant::now();
            attempts.retain(|t| now.duration_since(*t) < Duration::from_secs(60));
            if attempts.len() >= 3 {
                drop(attempts);
                reap_host(&state);
                state.terminal.store(true, Ordering::SeqCst);
                let _ = app.emit(
                    "host-status",
                    HostStatus {
                        ok: false,
                        phase: "failed",
                        owned: false,
                        port: None,
                        pid: None,
                        reason: Some(REASON_CRASHED),
                        os_error: None,
                        message: "Bounded restart limit reached; host is not running.".into(),
                    },
                );
                return;
            }
            let attempt_idx = attempts.len();
            attempts.push(now);
            drop(attempts);

            // Reap FIRST, on every attempt including the first (the whole point of B14).
            reap_host(&state);
            let backoff_ms = [1000u64, 2000, 4000][attempt_idx.min(2)];
            std::thread::sleep(Duration::from_millis(backoff_ms));

            let status = ensure_host_inner(&app);
            let _ = app.emit("host-status", status.clone());
            if status.ok {
                spawn_watcher(app.clone(), state.generation.load(Ordering::SeqCst));
            }
            return;
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Single-instance MUST be registered first (SPEC §2.5): a second launch focuses the
        // existing window and exits before any other plugin/setup runs.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(HostProcess {
            child: Mutex::new(None),
            owned: Mutex::new(false),
            #[cfg(windows)]
            job: Mutex::new(None),
            reap_by_taskkill: AtomicBool::new(false),
            reaped_pid: AtomicU32::new(0),
            ensure: Mutex::new(()),
            restart_attempts: Mutex::new(Vec::new()),
            terminal: AtomicBool::new(false),
            generation: AtomicU64::new(0),
        })
        .manage(BypassState {
            unlocked: Mutex::new(false),
            secret: {
                let mut b = [0u8; 32];
                rand::thread_rng().fill_bytes(&mut b);
                b.to_vec()
            },
        })
        .setup(|app| {
            if let Some(state) = app.try_state::<BypassState>() {
                if load_bypass_unlock(&app.handle()) {
                    if let Ok(mut v) = state.unlocked.lock() {
                        *v = true;
                    }
                }
            }
            // Explicit window icon so taskbar never shows a blank square
            // (Windows sometimes fails to pick up a bad/legacy .ico embed).
            if let Some(win) = app.get_webview_window("main") {
                const ICON_PNG: &[u8] = include_bytes!("../icons/icon.png");
                if let Ok(img) = tauri::image::Image::from_bytes(ICON_PNG) {
                    let _ = win.set_icon(img);
                }
            }

            let handle = app.handle().clone();
            // Start host ASAP on a background thread so the window paints first (SPEC §2.6).
            std::thread::spawn(move || {
                let status = ensure_host_inner(&handle);
                if status.ok {
                    if let Some(state) = handle.try_state::<HostProcess>() {
                        spawn_watcher(
                            handle.clone(),
                            state.generation.load(std::sync::atomic::Ordering::SeqCst),
                        );
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ensure_host,
            host_status,
            restart_host,
            get_bypass_permissions_unlock,
            unlock_bypass_permissions,
            lock_bypass_permissions,
            authorize_bypass_permissions_activation
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed = event
            {
                if let Some(state) = window.app_handle().try_state::<HostProcess>() {
                    let owned = state.owned.lock().map(|g| *g).unwrap_or(false);
                    if owned {
                        // §2.6 terminal transition: reap the per-host job FIRST (or its taskkill
                        // fallback). The app-level teardown (window close) needs no separate job —
                        // the per-host job's implicit close on app-process death already covers
                        // whole-app teardown (D2).
                        reap_host(&state);
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod reason_tests {
    use super::*;

    #[test]
    fn missing_file_codes_stay_runtime_missing_with_the_raw_code() {
        let e = std::io::Error::from_raw_os_error(2);
        assert_eq!(
            classify_spawn_error(&e, true),
            (REASON_RUNTIME_MISSING, Some(2))
        );
        let e = std::io::Error::from_raw_os_error(5);
        assert_eq!(
            classify_spawn_error(&e, true),
            (REASON_RUNTIME_MISSING, Some(5))
        );
        let e = std::io::Error::from_raw_os_error(193);
        assert_eq!(
            classify_spawn_error(&e, true),
            (REASON_RUNTIME_MISSING, Some(193))
        );
    }

    #[test]
    fn an_absent_runtime_file_is_entry_missing_not_runtime_missing() {
        let e = std::io::Error::from_raw_os_error(2);
        assert_eq!(classify_spawn_error(&e, false).0, REASON_ENTRY_MISSING);
    }
}

#[cfg(test)]
mod ladder_tests {
    use super::*;

    #[test]
    fn ladder_has_eight_rungs() {
        assert_eq!(ladder().len(), 8);
    }

    #[test]
    fn prod_and_dev_ladders_are_disjoint() {
        // BUILD_CHANNEL is a compile-time constant, so this test exercises whichever channel this
        // test binary was built with; the disjointness property is checked against the literal
        // rung lists rather than by building twice.
        let prod: &[u16] = &[8787, 8800, 8801, 8802, 8803, 8804, 8805, 8806];
        let dev: &[u16] = &[8788, 8810, 8811, 8812, 8813, 8814, 8815, 8816];
        for p in prod {
            assert!(!dev.contains(p), "prod rung {p} collides with a dev rung");
        }
    }

    #[test]
    fn preferred_rung_is_8787_prod_or_8788_dev() {
        let first = ladder()[0];
        assert!(first == 8787 || first == 8788);
    }
}

#[cfg(test)]
mod dechunk_tests {
    use super::*;

    #[test]
    fn decodes_the_observed_health_body() {
        // Byte-identical shape to what apps/host/src/index.ts's bare `http` module sends for
        // `/api/health` (F-1 repro): a hex chunk-size line, the JSON payload, CRLF, then the
        // terminating zero-size chunk.
        let body = "31\r\n{\"ok\":true,\"service\":\"grokforge-host\",\"pid\":1234}\r\n0\r\n\r\n";
        let decoded = dechunk_body(body).expect("valid chunked body decodes");
        let json: serde_json::Value =
            serde_json::from_str(&decoded).expect("decoded body is valid JSON");
        assert_eq!(json["service"], "grokforge-host");
        assert_eq!(json["pid"], 1234);
    }

    #[test]
    fn decodes_multiple_chunks() {
        let body = "5\r\n{\"ok\"\r\n4\r\n:tru\r\n1\r\ne\r\n1\r\n}\r\n0\r\n\r\n";
        let decoded = dechunk_body(body).expect("multi-chunk body decodes");
        assert_eq!(decoded, "{\"ok\":true}");
    }

    #[test]
    fn rejects_a_truncated_chunk_stream() {
        let body = "d5\r\n{\"ok\":true";
        assert_eq!(dechunk_body(body), None);
    }
}

#[cfg(test)]
mod bypass_capability_tests {
    use super::*;

    fn fixture_payload() -> serde_json::Value {
        serde_json::json!({
            "sessionId": "session-1",
            "desktopProcessId": 111,
            "hostProcessId": 222,
            "nonce": "nonce-1",
            "expiresAt": 1_700_000_060_000u64,
            "issuedAt": 1_700_000_000_000u64
        })
    }

    #[test]
    fn signs_the_exact_node_host_payload() {
        let secret = b"host-compatible-secret";
        let token = sign_activation_payload(secret, &fixture_payload()).expect("token");
        let (body, sig) = token.split_once('.').expect("body.signature");
        let expected_key = URL_SAFE_NO_PAD.encode(secret);
        let mut mac = Hmac::<Sha256>::new_from_slice(expected_key.as_bytes()).unwrap();
        mac.update(body.as_bytes());
        assert_eq!(sig, URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes()));
        let decoded: serde_json::Value =
            serde_json::from_slice(&URL_SAFE_NO_PAD.decode(body).unwrap()).unwrap();
        assert_eq!(decoded, fixture_payload());
    }

    #[test]
    fn payload_carries_expiry_and_process_bindings() {
        let p = fixture_payload();
        assert_eq!(p["sessionId"], "session-1");
        assert_eq!(p["desktopProcessId"], 111);
        assert_eq!(p["hostProcessId"], 222);
        assert!(p["expiresAt"].as_u64().unwrap() <= p["issuedAt"].as_u64().unwrap() + 60_000);
    }

    #[test]
    fn signing_is_deterministic_and_secret_changes_signature() {
        let payload = fixture_payload();
        let a = sign_activation_payload(b"a", &payload).unwrap();
        let b = sign_activation_payload(b"a", &payload).unwrap();
        let c = sign_activation_payload(b"b", &payload).unwrap();
        assert_eq!(a, b);
        assert_ne!(a, c);
    }

    #[test]
    fn activation_expiry_ipc_is_iso8601() {
        assert_eq!(iso8601_from_epoch_ms(1_700_000_060_000), "2023-11-14T22:14:20Z");
    }

    #[test]
    fn attestation_guard_only_allows_standard_unmanaged_local() {
        assert!(attestation_allows_bypass("local_standard_user", false));
        assert!(!attestation_allows_bypass("local_standard_user", true));
        assert!(!attestation_allows_bypass("elevated", false));
        assert!(!attestation_allows_bypass("remote", false));
        assert!(!attestation_allows_bypass("unavailable", false));
    }
}
