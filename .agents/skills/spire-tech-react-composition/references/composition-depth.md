# Composition depth

See also `spire-tech-frontend-patterns` composition reference for the shared baseline.

## Checklist

- [ ] Public props are a small, named set — not N interacting booleans
- [ ] Compound parts document required vs optional children
- [ ] Context value is stable and typed to state/actions/meta
- [ ] No components defined inside render
- [ ] Tests can mount parts without the whole app shell when isolation matters
