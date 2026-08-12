// _pyfmt.mjs — Python output-formatting emulation for the ported gate tools.
//
// The .py gates print Python reprs (dicts/lists in messages), write JSON via
// json.dumps(indent=2) (which escapes non-ASCII: ensure_ascii=True), and format
// percentages with f"{x:.0f}" (round-half-even). Byte-identical parity (spec §4)
// requires reproducing those three behaviors exactly. Nothing else lives here.
// Stdlib only.

/** Python repr() for values that came out of JSON.parse (str/num/bool/null/list/dict). */
export function pyRepr(v) {
  if (v === null) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') {
    // Python: single quotes, unless the string contains ' and not ".
    const q = v.includes("'") && !v.includes('"') ? '"' : "'";
    let body = v.replace(/\\/g, '\\\\');
    if (q === "'") body = body.replace(/'/g, "\\'");
    body = body.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
    return q + body + q;
  }
  if (Array.isArray(v)) return '[' + v.map(pyRepr).join(', ') + ']';
  return '{' + Object.entries(v).map(([k, x]) => `${pyRepr(k)}: ${pyRepr(x)}`).join(', ') + '}';
}

/** Python json.dumps(obj, indent=N): JSON.stringify shape + ensure_ascii escaping. */
export function pyJsonDumps(obj, indent = 2) {
  return JSON.stringify(obj, null, indent).replace(
    /[\u007f-\uffff]/g,
    (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
  );
}

/** Python f"{x:.0f}" — round-half-even. Domain here: x >= 0 (percentages). */
export function pyFixed0(x) {
  const floor = Math.floor(x);
  const frac = x - floor;
  if (frac > 0.5) return String(floor + 1);
  if (frac < 0.5) return String(floor);
  return String(floor % 2 === 0 ? floor : floor + 1);
}
