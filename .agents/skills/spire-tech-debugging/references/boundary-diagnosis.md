# Boundary diagnosis

For each boundary in the failing path, capture what enters, what leaves and which contract applies. Useful boundaries include UI to client state, client to transport, transport to handler, handler to domain logic, domain logic to storage, and producer to cache or queue.

Compare the broken path with a working path using the same fields and stages. Look for the first divergence rather than cataloguing every later difference.

Check assumptions explicitly:

- input shape, type, encoding and units;
- identity, tenant and permission context;
- configuration and feature state;
- dependency version and capability;
- serialization and defaulting;
- transaction, retry and idempotency boundaries.

Instrumentation must answer a hypothesis. Broad logging without a decision question creates noise and can expose secrets. Redact sensitive values and remove temporary probes after use.
