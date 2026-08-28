; Honest unsigned first-run — install-time pin outside the hashed payload (SPEC §2 / §9).
; Failure → no pin write. Never bake a digest into the NSIS payload.

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

  ; Local hash of the setup exe ($EXEPATH). $$env:PSModulePath=$$null so Windows
  ; PowerShell 5.1 still loads Get-FileHash when the parent inherited pwsh 7
  ; module dirs. Console.Write avoids a trailing newline (must be 64 hex).
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command "$$env:PSModulePath=$$null; [Console]::Out.Write(((Get-FileHash -LiteralPath ''$EXEPATH'' -Algorithm SHA256).Hash.ToLowerInvariant()).Trim())"'
  Pop $R0 ; exit code
  Pop $R7 ; stdout (expected: 64 lowercase hex)
  IntCmp $R0 0 grokforge_hash_strip grokforge_pin_done grokforge_pin_done

  grokforge_hash_strip:
    StrLen $R6 $R7
    IntCmp $R6 0 grokforge_pin_done grokforge_pin_done 0
    StrCpy $R5 $R7 1 -1
    StrCmp $R5 "$\n" grokforge_hash_chop 0
    StrCmp $R5 "$\r" grokforge_hash_chop grokforge_hash_len
  grokforge_hash_chop:
    IntOp $R6 $R6 - 1
    StrCpy $R7 $R7 $R6
    Goto grokforge_hash_strip

  grokforge_hash_len:
    StrLen $R6 $R7
    IntCmp $R6 64 grokforge_hash_write grokforge_pin_done grokforge_pin_done

  grokforge_hash_write:
    ; Overwrite on upgrade. Exact two-line pin.
    FileOpen $R2 "$R9\installer-digest.pin" w
    FileWrite $R2 "version=${VERSION}$\r$\n"
    FileWrite $R2 "sha256=$R7$\r$\n"
    FileClose $R2

  grokforge_pin_done:
!macroend
