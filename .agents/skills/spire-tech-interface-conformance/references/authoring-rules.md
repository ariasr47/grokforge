# Interface conformance authoring rules

## Auth

An endpoint behind a session adds `"auth": true`. The runner then sends the session only to those
endpoints. Supply session via `--auth-cookie` or `--auth-signup` per project `conformance.auth`.
A marked-auth endpoint without a session is a **configuration error** (exit 2), not a FAIL receipt.

## Expected HTTP status (`expect_status`)

Default is **200**. Set `"expect_status": 400` (or 404/500/…) when the contract promises an error
path. Live runs FAIL if the response status differs. When status matches, `required` is checked on
the JSON body (empty body ⇒ `{}`; empty `required` is valid for no-body errors). Sample mode still
validates body shape only — status is live evidence. Omit the key for success endpoints so older
specs stay valid.

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
    },
    {
      "method": "GET",
      "path": "/api/example/missing",
      "expect_status": 404,
      "required": {
        "error": "string",
        "code": "string"
      }
    }
  ]
}
```

Heading text must be exactly `## Conformance spec` for mechanical extraction.
