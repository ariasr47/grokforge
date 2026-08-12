import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Native folder picker (Windows Forms). Blocks until user selects or cancels.
 * Returns absolute path or null if cancelled.
 */
export async function pickFolderNative(): Promise<string | null> {
  if (process.platform === "win32") {
    const ps = `
Add-Type -AssemblyName System.Windows.Forms | Out-Null
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = 'Open workspace folder for Grok Code Shell'
$d.ShowNewFolderButton = $true
$r = $d.ShowDialog()
if ($r -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Out.Write($d.SelectedPath)
}
`;
    try {
      const { stdout } = await execFileAsync(
        "powershell.exe",
        [
          "-NoProfile",
          "-STA",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          ps,
        ],
        {
          windowsHide: false,
          timeout: 300_000,
          maxBuffer: 1024 * 1024,
        },
      );
      const path = String(stdout || "").trim();
      return path || null;
    } catch {
      return null;
    }
  }

  // non-Windows: no dialog in host yet
  return null;
}
