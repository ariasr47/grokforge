# Reference — GitHub Actions shape (foundation)

Use only when foundation Decision card chose GitHub Actions. Adapt package manager and scripts to the consumer.

## Minimum honest CI

1. Checkout  
2. Setup runtime (Node pin from Decision card — do not invent)  
3. Install dependencies (`npm ci` / `pnpm i --frozen-lockfile` / …)  
4. Lint if the repo has a lint script  
5. Test with the **same** command family as `project.json` `test_cmd` / package `test`  

## Affected tests (Nx only)

Only enable affected pipelines when the monorepo graph enumerates projects correctly. If affected returns empty on real changes, prefer full `test` until the graph is fixed.

## Do not

- Greenwash: “build passed” without tests the product cares about  
- Embed secrets  
- Pin Spire-kit Node versions by default unless the consumer shares them  
