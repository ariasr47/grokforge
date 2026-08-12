use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;

fn host_channel() -> String {
    std::env::var("GROKFORGE_CHANNEL").unwrap_or_else(|_| "prod".into())
}

fn host_port() -> u16 {
    if let Ok(p) = std::env::var("GROKFORGE_PORT") {
        if let Ok(n) = p.parse::<u16>() {
            return n;
        }
    }
    let ch = host_channel().to_lowercase();
    if matches!(
        ch.as_str(),
        "dev" | "development" | "tst" | "test" | "qa"
    ) {
        8788
    } else {
        8787
    }
}

fn host_addr() -> String {
    format!("127.0.0.1:{}", host_port())
}

struct HostProcess {
    child: Mutex<Option<Child>>,
    /// True if this app instance spawned the process (should kill on exit).
    owned: Mutex<bool>,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct HostStatus {
    ok: bool,
    message: String,
    owned: bool,
    pid: Option<u32>,
}

fn is_repo_root(dir: &Path) -> bool {
    // Packaged install: resources/host/index.js present
    if dir
        .join("resources")
        .join("host")
        .join("index.js")
        .is_file()
    {
        return true;
    }
    dir.join("apps").join("host").join("src").join("index.ts").is_file()
        || (dir.join("package.json").is_file()
            && dir.join("apps").join("host").is_dir()
            && dir.join("apps").join("shell").is_dir())
}

fn repo_root() -> PathBuf {
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
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn host_healthy() -> bool {
    let addr: std::net::SocketAddr = match host_addr().parse() {
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
        host_port()
    );
    if stream.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut buf = Vec::new();
    let _ = stream.read_to_end(&mut buf);
    let text = String::from_utf8_lossy(&buf);
    text.contains("200") && (text.contains("\"ok\":true") || text.contains("\"ok\": true"))
}

fn wait_healthy(timeout: Duration) -> bool {
    let start = std::time::Instant::now();
    while start.elapsed() < timeout {
        if host_healthy() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    false
}

fn host_log_paths(root: &Path) -> (PathBuf, PathBuf) {
    let dir = dirs_home()
        .map(|h| h.join(".grokforge").join("logs"))
        .unwrap_or_else(|| root.join(".grokforge-logs"));
    let _ = std::fs::create_dir_all(&dir);
    (dir.join("host-stdout.log"), dir.join("host-stderr.log"))
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

fn spawn_host_process(root: &Path) -> Result<Child, String> {
    let (stdout_path, stderr_path) = host_log_paths(root);
    let stdout_file = std::fs::File::create(&stdout_path)
        .map_err(|e| format!("host stdout log: {e} ({})", stdout_path.display()))?;
    let stderr_file = std::fs::File::create(&stderr_path)
        .map_err(|e| format!("host stderr log: {e} ({})", stderr_path.display()))?;

    // Packaged resources first (desktop-self-host), then monorepo tsx entry
    let resource_host = root
        .join("resources")
        .join("host")
        .join("index.js");
    let resource_agent = root
        .join("resources")
        .join("agents")
        .join("grok-acp")
        .join("index.js");
    let tsx_cli = root.join("node_modules").join("tsx").join("dist").join("cli.mjs");
    let host_entry = root.join("apps").join("host").join("src").join("index.ts");

    let mut cmd = if resource_host.exists() {
        let mut c = Command::new("node");
        c.arg(resource_host.as_os_str()).current_dir(root);
        c
    } else if host_entry.exists() && tsx_cli.exists() {
        let mut c = Command::new("node");
        c.arg(tsx_cli.as_os_str())
            .arg(host_entry.as_os_str())
            .current_dir(root);
        c
    } else if host_entry.exists() {
        let mut c = Command::new("node");
        c.args(["--import", "tsx"])
            .arg(host_entry.as_os_str())
            .current_dir(root);
        c
    } else {
        return Err(format!(
            "Host entry missing at {} (and no resources/host/index.js). Install from monorepo or packaged build.",
            host_entry.display()
        ));
    };

    cmd.env("GROKFORGE_PORT", host_port().to_string())
        .env("GROKFORGE_CHANNEL", host_channel())
        .env("GROKFORGE_ROOT", root.as_os_str())
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

    cmd.spawn()
        .map_err(|e| format!("Failed to spawn host: {e}. Is Node on PATH?"))
}

fn kill_owned(state: &HostProcess) {
    if let Ok(mut guard) = state.child.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    if let Ok(mut owned) = state.owned.lock() {
        *owned = false;
    }
}

fn ensure_host_inner(app: &tauri::AppHandle) -> Result<HostStatus, String> {
    if host_healthy() {
        let owned = app
            .try_state::<HostProcess>()
            .and_then(|s| s.owned.lock().ok().map(|g| *g))
            .unwrap_or(false);
        let pid = app
            .try_state::<HostProcess>()
            .and_then(|s| s.child.lock().ok().and_then(|g| g.as_ref().map(|c| c.id())));
        return Ok(HostStatus {
            ok: true,
            message: if owned {
                "Host running (started by this app)".into()
            } else {
                format!("Host already healthy on :{}", host_port())
            },
            owned,
            pid,
        });
    }

    // Not healthy — kill any child we own, then spawn
    if let Some(state) = app.try_state::<HostProcess>() {
        kill_owned(&state);
    }

    let root = repo_root();
    let child = spawn_host_process(&root)?;
    let pid = child.id();

    if let Some(state) = app.try_state::<HostProcess>() {
        *state.child.lock().map_err(|e| e.to_string())? = Some(child);
        *state.owned.lock().map_err(|e| e.to_string())? = true;
    }

    if !wait_healthy(Duration::from_secs(20)) {
        if let Some(state) = app.try_state::<HostProcess>() {
            kill_owned(&state);
        }
        let (_, stderr_path) = host_log_paths(&root);
        return Err(format!(
            "Host started (pid {pid}) but /api/health never became ready. Check {}",
            stderr_path.display()
        ));
    }

    Ok(HostStatus {
        ok: true,
        message: format!("Host started (pid {pid})"),
        owned: true,
        pid: Some(pid),
    })
}

#[tauri::command]
fn ensure_host(app: tauri::AppHandle) -> Result<HostStatus, String> {
    ensure_host_inner(&app)
}

#[tauri::command]
fn host_status(app: tauri::AppHandle) -> HostStatus {
    let owned = app
        .try_state::<HostProcess>()
        .and_then(|s| s.owned.lock().ok().map(|g| *g))
        .unwrap_or(false);
    let pid = app
        .try_state::<HostProcess>()
        .and_then(|s| s.child.lock().ok().and_then(|g| g.as_ref().map(|c| c.id())));
    if host_healthy() {
        HostStatus {
            ok: true,
            message: "Host healthy".into(),
            owned,
            pid,
        }
    } else {
        HostStatus {
            ok: false,
            message: "Host offline".into(),
            owned,
            pid,
        }
    }
}

#[tauri::command]
fn restart_host(app: tauri::AppHandle) -> Result<HostStatus, String> {
    if let Some(state) = app.try_state::<HostProcess>() {
        kill_owned(&state);
        // Brief pause so port releases
        std::thread::sleep(Duration::from_millis(400));
    }
    // If something else still holds the port and is healthy after kill of our child, reuse
    if host_healthy() {
        return Ok(HostStatus {
            ok: true,
            message: "Host still healthy after restart attempt (external process)".into(),
            owned: false,
            pid: None,
        });
    }
    ensure_host_inner(&app)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(HostProcess {
            child: Mutex::new(None),
            owned: Mutex::new(false),
        })
        .setup(|app| {
            // Explicit window icon so taskbar never shows a blank square
            // (Windows sometimes fails to pick up a bad/legacy .ico embed).
            if let Some(win) = app.get_webview_window("main") {
                const ICON_PNG: &[u8] = include_bytes!("../icons/icon.png");
                if let Ok(img) = tauri::image::Image::from_bytes(ICON_PNG) {
                    let _ = win.set_icon(img);
                }
            }

            let handle = app.handle().clone();
            // Start host ASAP on a background thread so the window paints first
            std::thread::spawn(move || {
                let _ = ensure_host_inner(&handle);
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ensure_host,
            host_status,
            restart_host
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed = event
            {
                if let Some(state) = window.app_handle().try_state::<HostProcess>() {
                    let owned = state.owned.lock().map(|g| *g).unwrap_or(false);
                    if owned {
                        kill_owned(&state);
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
