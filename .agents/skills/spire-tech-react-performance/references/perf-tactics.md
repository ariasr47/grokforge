# Perf tactics

| Symptom | First move |
| --- | --- |
| Large JS | Split route/heavy widgets; kill barrels |
| Slow first paint | Server data / streaming if allowed; reduce client work |
| Jank on type | Defer non-urgent updates; fix unstable props |
| Long lists | Windowing only with evidence |
| Memo everywhere | Revert; measure; memo hot pure leaves only |
