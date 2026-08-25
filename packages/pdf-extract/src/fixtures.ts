import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";

export function fixtureOversizedBytes(): Uint8Array {
  return new Uint8Array(20_000_001);
}

export function fixtureCorruptPdf(): Uint8Array {
  return new TextEncoder().encode("%PDF-1.4\ntruncated junk");
}

/** Openable text-layer PDF. Default glyphs "Hello PDF". */
export async function fixtureTextLayerPdf(glyph = "Hello PDF"): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(glyph, { x: 72, y: 720, size: 24, font });
  const saved = await doc.save();
  return new Uint8Array(saved);
}

/** Opens successfully but yields zero text-layer glyphs (scanned product name → empty-extract). */
export async function fixtureEmptyExtractPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  const saved = await doc.save();
  return new Uint8Array(saved);
}

const PAD = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

function padPassword(pw: string): Buffer {
  const b = Buffer.from(pw, "latin1");
  const out = Buffer.alloc(32);
  b.copy(out, 0, 0, 32);
  if (b.length < 32) Buffer.from(PAD).copy(out, b.length, 0, 32 - b.length);
  return out;
}

function rc4(key: Buffer, data: Buffer): Buffer {
  const s = Buffer.alloc(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i]! + key[i % key.length]!) & 255;
    const t = s[i]!;
    s[i] = s[j]!;
    s[j] = t;
  }
  const out = Buffer.alloc(data.length);
  let ii = 0;
  j = 0;
  for (let k = 0; k < data.length; k++) {
    ii = (ii + 1) & 255;
    j = (j + s[ii]!) & 255;
    const t = s[ii]!;
    s[ii] = s[j]!;
    s[j] = t;
    out[k] = data[k]! ^ s[(s[ii]! + s[j]!) & 255]!;
  }
  return out;
}

function md5(buf: Buffer): Buffer {
  return createHash("md5").update(buf).digest();
}

function hex(buf: Buffer): string {
  return buf.toString("hex");
}

/**
 * pdf-lib 1.17.1 has no encrypt API (`save({ userPassword })` is ignored).
 * Build a Standard-security (R=2, 40-bit) PDF so pdfjs throws PasswordException
 * when opened with password "" — never supply "test" in production extract.
 */
function buildPasswordRequiredPdf(): Uint8Array {
  const userPw = "test";
  const ownerPw = "owner";
  const P = -4;
  const id = Buffer.from("0123456789abcdef");
  const userPad = padPassword(userPw);
  const ownerHash = md5(padPassword(ownerPw));
  const O = rc4(ownerHash.subarray(0, 5), userPad);
  const keyHash = createHash("md5");
  keyHash.update(userPad);
  keyHash.update(O);
  const pBuf = Buffer.alloc(4);
  pBuf.writeInt32LE(P);
  keyHash.update(pBuf);
  keyHash.update(id);
  const key = keyHash.digest().subarray(0, 5);
  const U = rc4(key, Buffer.from(PAD));

  const rawStream = Buffer.from("BT /F1 24 Tf 72 720 Td (secret) Tj ET\n");
  const extra = Buffer.alloc(5);
  extra.writeUInt16LE(4, 0);
  extra[2] = 0;
  extra.writeUInt16LE(0, 3);
  const objKey = md5(Buffer.concat([key, extra])).subarray(0, 10);
  const encStream = rc4(objKey, rawStream);

  const parts: Buffer[] = [];
  const offsets: number[] = [0];
  const push = (chunk: string | Buffer) => {
    parts.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  };
  const lenSoFar = () => parts.reduce((n, p) => n + p.length, 0);
  const addObj = (n: number, body: string) => {
    offsets[n] = lenSoFar();
    push(`${n} 0 obj\n${body}\nendobj\n`);
  };

  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  addObj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  addObj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  addObj(
    3,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
  );
  offsets[4] = lenSoFar();
  push(`4 0 obj\n<< /Length ${encStream.length} >>\nstream\n`);
  push(encStream);
  push("\nendstream\nendobj\n");
  addObj(5, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  addObj(
    6,
    `<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${hex(O)}> /U <${hex(U)}> /P ${P} >>`,
  );

  const body = Buffer.concat(parts);
  let xref = "xref\n0 7\n0000000000 65535 f \n";
  for (let i = 1; i <= 6; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size 7 /Root 1 0 R /Encrypt 6 0 R /ID [<${hex(id)}> <${hex(id)}>] >>\nstartxref\n${body.length}\n%%EOF\n`;
  return new Uint8Array(Buffer.concat([body, Buffer.from(xref), Buffer.from(trailer)]));
}

/**
 * Password-required PDF. User password is "test" — extract core must pass password ""
 * and classify as encrypted (never supply "test" in production extract).
 */
export async function fixtureEncryptedPdf(): Promise<Uint8Array> {
  return buildPasswordRequiredPdf();
}
