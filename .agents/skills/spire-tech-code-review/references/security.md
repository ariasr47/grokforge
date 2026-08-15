# Security review

## Identity and authorization

Trace how identity is established and where permission is enforced. Authentication without authorization is insufficient. Check object ownership, tenant scope, role and capability on the protected operation, not only in the UI or route declaration. Denial must occur before any protected mutation or disclosure.

## Untrusted input and injection

Follow input into queries, shells, templates, evaluators, URLs, file paths and parsers. Require parameterization or a constrained representation. Check SQL and command injection, XSS, unsafe deserialization, path traversal and server-side request forgery. Validation at one boundary does not authorize later use in a different context.

## Browser and request integrity

For state-changing browser requests, check cross-site request forgery (CSRF) protections, origin assumptions, cookie settings and replay/idempotency behavior appropriate to the action. Escaping output and validating input solve different problems.

## Secrets and sensitive data

Look for credentials, tokens, reset links, internal errors and personal data in source, logs, analytics, caches and responses. Error paths often disclose more than success paths. Verify redaction and least-data responses.

## Tenant and data boundaries

Every read, write, cache key, background job and export must preserve tenant or owner scope. A lookup by object ID alone is suspicious when ownership is separate. Check bulk operations and indirect references as well as single-item routes.

## Destructive operations

Confirm authorization, target scope, confirmation/idempotency, transaction boundaries, auditability and failure recovery. A partial delete or cross-scope update is Critical when it can cause irreversible loss.
