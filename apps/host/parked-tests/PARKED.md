# PARKED — vendor Code spawn tests (0.6.7)

**Why:** Forge Code is house grok-acp. These files assume Code acquires `grok agent stdio` and then journals vendor Skills / children / browser / MCP / hooks. Host `npm test` was 100-red on that class (`house !== vendor`, 8s waits for vendor sessionUpdate that never arrives).

**Restore:** move the files back under `apps/host/src/` if Code ever spawns vendor stdio again. Projection coverage for “if the host sent vendor identity” stays in the shell.

Parked 2026-09-08 with the 0.6.7 preflight. Do not delete.
