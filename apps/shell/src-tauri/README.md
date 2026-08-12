# Tauri desktop

Requires **MSVC** (Visual Studio C++ Build Tools).

Installed on this machine via:

```text
winget install Microsoft.VisualStudio.2022.BuildTools
  + Workload.VCTools / VC.Tools.x86.x64
rustup default stable-x86_64-pc-windows-msvc
```

## Run

From repo root (loads VsDevCmd automatically):

```powershell
npm run desktop
# or
npm run desktop:tauri
```

Web-app fallback (no Tauri):

```powershell
npm run desktop:web
```
