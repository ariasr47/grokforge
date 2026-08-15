# Reference — Nx opt-in (foundation)

Nx is **optional**. Use only when the human ruled monorepo shape = Nx.

## Before scaffolding

- Confirm package manager and Node pin.  
- Sketch apps vs libs on a Decision card (names, boundaries).  
- Ensure Spire seam `project.json` will point `backend.dir` / `frontend.dir` at real app roots.

## After scaffolding

- Document layout in PROJECT_CONTEXT §2.  
- Put serve/test commands in PROJECT_CONTEXT §7 and seam `serve_cmd` / `test_cmd`.  
- Verify project graph lists expected projects without duplicate-name errors.  
- CI: full tests until affected is proven correct.

## Stop / fall back

If the graph cannot correctly list projects or affected selection is wrong on real paths, surface a Decision card: fix graph, or abandon Nx for workspaces/single-package, or document-only.

## Spire kit note

The Spire OS repository itself is not an Nx workspace (measured removal 2026-08-09). Do not treat kit layout as the consumer template.
