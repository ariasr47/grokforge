fn main() {
    // D3: GROKFORGE_BUILD_CHANNEL is read at COMPILE time via option_env! in lib.rs, never at
    // runtime via std::env::var — so a channel flip must actually trigger a rebuild.
    println!("cargo:rerun-if-env-changed=GROKFORGE_BUILD_CHANNEL");
    tauri_build::build()
}
