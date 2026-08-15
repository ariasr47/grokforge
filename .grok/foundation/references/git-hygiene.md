# Reference — Git hygiene (foundation)

## Init

- Run `git init` only when `.git` is absent.  
- Do not force `git remote` changes.  
- First commit is the human’s call.

## Ignores

Prefer ignoring: `node_modules/`, build outputs, `.env` / secret files, coverage caches, OS junk.  
Respect monorepo-tool ignore files when present; do not delete them without a card.

## Line endings

Spire consumers should prefer LF for framework-touched text. Do not rewrite an entire history for EOL without an explicit ask.

## Do not

- Commit credentials, local settings with tokens, or large binaries  
- `git push --force` unless the human explicitly orders it  
