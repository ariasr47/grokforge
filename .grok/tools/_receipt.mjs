// _receipt.mjs — the conformance receipt schema, and the only thing the kit actually guarantees.
//
// The kit does not, and never did, guarantee that the runner is correct: it reads a receipt written
// by a tool it does not verify at run time. What it CAN guarantee — and now enforces — is that a
// receipt is in this shape, and that GATE Q compared two of them produced independently
// (ORCHESTRATOR.md:303-305). That is also what makes a consumer-supplied runner
// (project.json `conformance.command`) safe: the artifact is checked, whoever wrote it.
//
// `auth` is checked the same way: tolerated when absent (receipts written before 2026-08-06 predate
// the field and must still validate), but constrained to a legal value when present. Under a
// `conformance.command` override, `auth` is whatever the delegated runner happened to write — this
// validator is the only thing standing between that and a receipt claiming a session method that
// doesn't exist.
//
// Node builtins only. No I/O — this validates an already-parsed object.

export const RECEIPT_VERDICTS = ['PASS', 'FAIL', 'UNVERIFIABLE'];
const MODES = ['live', 'sample'];
const AUTH_METHODS = [null, 'cookie', 'signup'];

/** Problems with a receipt, as human-readable strings. Empty array ⇒ valid. */
export function validateReceipt(receipt) {
  if (receipt === null || typeof receipt !== 'object' || Array.isArray(receipt)) {
    return ['receipt is not a JSON object'];
  }
  const problems = [];
  if (receipt.tool !== 'interface_conformance') {
    problems.push(`tool: expected "interface_conformance", got ${JSON.stringify(receipt.tool)}`);
  }
  if (!RECEIPT_VERDICTS.includes(receipt.verdict)) {
    problems.push(`verdict: expected one of ${RECEIPT_VERDICTS.join(' | ')}, got ${JSON.stringify(receipt.verdict)}`);
  }
  if (!MODES.includes(receipt.mode)) {
    problems.push(`mode: expected one of ${MODES.join(' | ')}, got ${JSON.stringify(receipt.mode)}`);
  }
  if (typeof receipt.source !== 'string' || receipt.source === '') {
    problems.push('source: expected a non-empty string naming the contract or spec');
  }
  if (typeof receipt.checked_at !== 'string' || receipt.checked_at === '') {
    problems.push('checked_at: expected a non-empty timestamp string');
  }
  // base_url is null in sample mode by design — only its type is constrained.
  if (receipt.base_url !== null && typeof receipt.base_url !== 'string') {
    problems.push('base_url: expected a string or null');
  }
  const s = receipt.summary;
  if (s === null || typeof s !== 'object' || Array.isArray(s)) {
    problems.push('summary: expected an object with pass, fail and total');
  } else {
    for (const key of ['pass', 'fail', 'total']) {
      if (!Number.isInteger(s[key])) problems.push(`summary.${key}: expected an integer, got ${JSON.stringify(s[key])}`);
    }
  }
  // Absence is legal (pre-2026-08-06 receipts have no `auth` key at all); a PRESENT value must be one
  // of the three the runner is documented to ever write.
  if (Object.hasOwn(receipt, 'auth') && !AUTH_METHODS.includes(receipt.auth)) {
    problems.push(`auth: expected one of null | "cookie" | "signup", got ${JSON.stringify(receipt.auth)}`);
  }
  if (!Array.isArray(receipt.endpoints)) {
    problems.push('endpoints: expected an array');
  } else if (receipt.endpoints.some((e) => e === null || typeof e !== 'object' || Array.isArray(e))) {
    // Receipts the kit writes always satisfy this; a hand-rolled `conformance.command` runner is
    // what makes it worth checking — nothing else constrains what lands in --report.
    problems.push('endpoints: every element must be an object');
  }
  return problems;
}
