; Honest unsigned first-run — install-time pin outside the hashed payload (SPEC §2 / §9).
; Failure → no pin write. Never bake a digest into the NSIS payload.
;
; Do not put PowerShell $env / $null in the nsExec command string. NSIS expands $
; at runtime ($$ is only one unescape), so $env becomes empty and Get-FileHash
; never runs. Hash and write in write-installer-pin.ps1 launched with -File.
;
; ${__FILEDIR__} inside the macro is the generated installer.nsi dir. Capture it
; at !include time so File packs this folder's helper.

!ifndef GROKFORGE_WRITE_PIN_PS1
  !define GROKFORGE_WRITE_PIN_PS1 "${__FILEDIR__}\write-installer-pin.ps1"
!endif

!macro NSIS_HOOK_POSTINSTALL
  ; Resolve channel dataDir (mirrors apps/host/src/channel.ts dataDir()).
  ClearErrors
  ReadEnvStr $R8 "GROKFORGE_DATA_DIR"
  ${If} $R8 != ""
    StrCpy $R9 "$R8"
  ${Else}
    StrCmp "${BUNDLEID}" "dev.grokforge.shell.dev" 0 grokforge_pin_check_name
      StrCpy $R9 "$PROFILE\.grokforge-dev"
      Goto grokforge_pin_dir_done
    grokforge_pin_check_name:
      StrCmp "${PRODUCTNAME}" "Forge Dev" 0 grokforge_pin_prod
        StrCpy $R9 "$PROFILE\.grokforge-dev"
        Goto grokforge_pin_dir_done
      grokforge_pin_prod:
        StrCpy $R9 "$PROFILE\.grokforge"
    grokforge_pin_dir_done:
  ${EndIf}

  CreateDirectory "$R9"

  ; Pack the helper into $TEMP, then run it. Exit code is the gate — not stdout length.
  File "/oname=$TEMP\grokforge-write-pin.ps1" "${GROKFORGE_WRITE_PIN_PS1}"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$TEMP\grokforge-write-pin.ps1" -ExePath "$EXEPATH" -DataDir "$R9" -Version "${VERSION}"'
  Pop $R0
  Pop $R7
  Delete "$TEMP\grokforge-write-pin.ps1"

  grokforge_pin_done:
!macroend
