# Boundary rules

| Keep on server | Allow on client |
| --- | --- |
| API keys, session secrets | Presentational state |
| Authorization decisions | Optimistic UI after server confirmed rules |
| Privileged data fetches | Public or user-owned display data already authorized |

If a value cannot be serialized, redesign the boundary — do not silence the error.
