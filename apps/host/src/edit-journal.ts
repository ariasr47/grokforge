import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { MutationKind } from "./run-types.js";

export type EditJournalEntry = {
  editId: string;
  workspace: string;
  kind?: MutationKind;
  target?: string;
  fromPath?: string;
  toPath?: string;
  fromPathAbs?: string;
  toPathAbs?: string;
  before: string | null;
  beforeHash: string | null;
  afterHash: string | null;
  diff: string | null;
  runId: string;
  invocationId: string;
  policy: unknown;
  status: "prepared" | "applied" | "reverted" | "conflict";
};

export class EditJournal {
  constructor(private readonly root: string) {}
  private file(id: string) {
    return path.join(this.root, "edit-recovery", `${id}.json`);
  }
  async prepare(entry: Omit<EditJournalEntry, "status">) {
    const full = { ...entry, status: "prepared" as const };
    await fs.mkdir(path.dirname(this.file(entry.editId)), { recursive: true });
    await fs.writeFile(this.file(entry.editId), JSON.stringify(full), "utf8");
    return full;
  }
  async markApplied(id: string) {
    const e = await this.get(id);
    e.status = "applied";
    await fs.writeFile(this.file(id), JSON.stringify(e), "utf8");
    return e;
  }
  async get(id: string) {
    return JSON.parse(await fs.readFile(this.file(id), "utf8")) as EditJournalEntry;
  }
  async revert(id: string, ownership?: { runId: string }) {
    const e = await this.get(id);
    if (ownership && e.runId !== ownership.runId) {
      throw Object.assign(new Error("edit is owned by another run"), { code: "recovery_not_owned", entry: e });
    }
    const kind = e.kind ?? "content";
    if (kind === "delete") {
      const target = e.target;
      if (!target) {
        e.status = "conflict";
        await fs.writeFile(this.file(id), JSON.stringify(e), "utf8");
        return { ok: false, entry: e };
      }
      const exists = await fs.access(target).then(() => true, () => false);
      if (exists) {
        e.status = "conflict";
        await fs.writeFile(this.file(id), JSON.stringify(e), "utf8");
        return { ok: false, entry: e };
      }
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, e.before ?? "", "utf8");
      e.status = "reverted";
      await fs.writeFile(this.file(id), JSON.stringify(e), "utf8");
      return { ok: true, entry: e };
    }
    if (kind === "rename") {
      const fromAbs = e.fromPathAbs ?? e.fromPath;
      const toAbs = e.toPathAbs ?? e.toPath;
      const dest = toAbs ? await fs.readFile(toAbs, "utf8").catch(() => null) : null;
      const destHash = dest === null ? null : crypto.createHash("sha256").update(dest).digest("hex");
      const caseOnly =
        typeof fromAbs === "string" &&
        typeof toAbs === "string" &&
        fromAbs !== toAbs &&
        fromAbs.toLowerCase() === toAbs.toLowerCase();
      const sourceExists = !fromAbs || caseOnly
        ? false
        : await fs.access(fromAbs).then(() => true, () => false);
      if (!fromAbs || !toAbs || dest === null || destHash !== e.afterHash || sourceExists) {
        e.status = "conflict";
        await fs.writeFile(this.file(id), JSON.stringify(e), "utf8");
        return { ok: false, entry: e };
      }
      await fs.rename(toAbs, fromAbs);
      e.status = "reverted";
      await fs.writeFile(this.file(id), JSON.stringify(e), "utf8");
      return { ok: true, entry: e };
    }
    const target = e.target;
    if (!target) {
      e.status = "conflict";
      await fs.writeFile(this.file(id), JSON.stringify(e), "utf8");
      return { ok: false, entry: e };
    }
    const current = await fs.readFile(target, "utf8").catch(() => null);
    const hash = current === null ? null : crypto.createHash("sha256").update(current).digest("hex");
    if (hash !== e.afterHash) {
      e.status = "conflict";
      await fs.writeFile(this.file(id), JSON.stringify(e), "utf8");
      return { ok: false, entry: e };
    }
    if (e.before === null) await fs.rm(target, { force: true });
    else await fs.writeFile(target, e.before, "utf8");
    e.status = "reverted";
    await fs.writeFile(this.file(id), JSON.stringify(e), "utf8");
    return { ok: true, entry: e };
  }
}
