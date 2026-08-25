import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export class EditJournal {
  constructor(private readonly root: string) {}
  private file(id: string) {
    return path.join(this.root, "edit-recovery", `${id}.json`);
  }
  async prepare(entry: Record<string, unknown>) {
    const full = { ...entry, status: "prepared" };
    await fs.mkdir(path.dirname(this.file(String(entry.editId))), { recursive: true });
    await fs.writeFile(this.file(String(entry.editId)), JSON.stringify(full), "utf8");
    return full;
  }
  async markApplied(id: string) {
    const f = this.file(id);
    const e = JSON.parse(await fs.readFile(f, "utf8"));
    e.status = "applied";
    await fs.writeFile(f, JSON.stringify(e), "utf8");
    return e;
  }
  async revert(id: string) {
    const e = JSON.parse(await fs.readFile(this.file(id), "utf8"));
    const kind = e.kind ?? "content";
    if (kind === "delete") {
      const exists = await fs.access(e.target).then(() => true, () => false);
      if (exists) {
        e.status = "conflict";
        await fs.writeFile(this.file(id), JSON.stringify(e));
        return { ok: false, entry: e };
      }
      await fs.mkdir(path.dirname(e.target), { recursive: true });
      await fs.writeFile(e.target, e.before ?? "", "utf8");
      e.status = "reverted";
      await fs.writeFile(this.file(id), JSON.stringify(e));
      return { ok: true, entry: e };
    }
    if (kind === "rename") {
      const fromAbs = e.fromPathAbs ?? e.fromPath;
      const toAbs = e.toPathAbs ?? e.toPath;
      const dest = await fs.readFile(toAbs, "utf8").catch(() => null);
      const destHash = dest === null ? null : crypto.createHash("sha256").update(dest).digest("hex");
      const caseOnly =
        typeof fromAbs === "string" &&
        typeof toAbs === "string" &&
        fromAbs !== toAbs &&
        fromAbs.toLowerCase() === toAbs.toLowerCase();
      const sourceExists = caseOnly
        ? false
        : await fs.access(fromAbs).then(() => true, () => false);
      if (dest === null || destHash !== e.afterHash || sourceExists) {
        e.status = "conflict";
        await fs.writeFile(this.file(id), JSON.stringify(e));
        return { ok: false, entry: e };
      }
      await fs.rename(toAbs, fromAbs);
      e.status = "reverted";
      await fs.writeFile(this.file(id), JSON.stringify(e));
      return { ok: true, entry: e };
    }
    const current = await fs.readFile(e.target, "utf8").catch(() => null);
    const hash = current === null ? null : crypto.createHash("sha256").update(current).digest("hex");
    if (hash !== e.afterHash) {
      e.status = "conflict";
      await fs.writeFile(this.file(id), JSON.stringify(e));
      return { ok: false, entry: e };
    }
    if (e.before === null) await fs.rm(e.target, { force: true });
    else await fs.writeFile(e.target, e.before, "utf8");
    e.status = "reverted";
    await fs.writeFile(this.file(id), JSON.stringify(e));
    return { ok: true, entry: e };
  }
}
