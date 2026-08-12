# Interface conformance authoring rules

## Auth

An endpoint behind a session adds `"auth": true`. The runner then sends the session only to those
endpoints. Supply session via `--auth-cookie` or `--auth-signup` per project `conformance.auth`.
A marked-auth endpoint without a session is a **configuration error** (exit 2), not a FAIL receipt.

## Frontend-only features

Point at an existing endpoint's contract when possible and mark `NO_BACKEND_CHANGE`. Do not invent
a backend surface for a UI-only change.

## Required shape reminder

```json
{
  "endpoints": [
    {
      "method": "GET",
      "path": "/api/example/{id}",
      "path_params": { "id": "abc123" },
      "query": {},
      "required": {
        "id": "string",
        "items[].name": "string",
        "updatedAt": "string|null"
      }
    }
  ]
}
```

Heading text must be exactly `## Conformance spec` for mechanical extraction.
