# Binding set

Typical pack contents (names vary by project):

- Domain/math constraints the feature must not violate
- Isolation / best-effort failure rules
- Promoted build invariants (always-load floor)
- Byte-identity or fingerprint guarantees when declared

If the pack is empty after regenerate, record that — do not invent floor rules from other products.
