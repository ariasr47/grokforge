import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { randomUUID } from "node:crypto";

export const TRUSTED_COMMAND_CLASS_IDS = [
  "npm", "npx", "cargo", "git:status", "git:diff", "git:log", "git:show",
] as const;
export type TrustedCommandClassId = (typeof TRUSTED_COMMAND_CLASS_IDS)[number];

export const TRUSTED_COMMAND_CLASS_CATALOG: { id: TrustedCommandClassId; label: string }[] = [
  { id: "npm", label: "npm" },
  { id: "npx", label: "npx" },
  { id: "cargo", label: "cargo" },
  { id: "git:status", label: "git status" },
  { id: "git:diff", label: "git diff" },
  { id: "git:log", label: "git log" },
  { id: "git:show", label: "git show" },
];

export type TrustedCommandClassesFallbackReason = "missing" | "invalid" | "unreadable" | null;

export type TrustedCommandClassesView = {
  status: "confirmed";
  workspace: string;
  classes: TrustedCommandClassId[];
  revision: string;
  source: "saved" | "fallback";
  fallbackReason: TrustedCommandClassesFallbackReason;
  savedForWorkspace: boolean;
  catalog: typeof TRUSTED_COMMAND_CLASS_CATALOG;
};

type Stored = {
  version: 1;
  workspace: string;
  classes: TrustedCommandClassId[];
  revision: string;
  savedAt: string;
};

const ID_SET = new Set<string>(TRUSTED_COMMAND_CLASS_IDS);

export class TrustedCommandClassStore {
  constructor(
    private readonly dataDir: string,
    private readonly revisionFactory: () => string = randomUUID,
  ) {}

  private async canonical(p: string): Promise<string> {
    if (!path.isAbsolute(p)) throw Object.assign(new Error("invalid_workspace"), { code: "invalid_workspace" });
    try {
      const resolved = await fs.realpath(p);
      const st = await fs.stat(resolved);
      if (!st.isDirectory()) throw new Error("invalid");
      return resolved;
    } catch {
      throw Object.assign(new Error("invalid_workspace"), { code: "invalid_workspace" });
    }
  }

  private file(workspace: string): string {
    const key =
      process.platform === "win32"
        ? workspace.toLowerCase().replaceAll("\\", "/")
        : workspace;
    return path.join(
      this.dataDir,
      "trusted-command-classes",
      crypto.createHash("sha256").update(key).digest("hex") + ".json",
    );
  }

  private normalizeClasses(input: unknown): TrustedCommandClassId[] {
    if (!Array.isArray(input)) {
      throw Object.assign(new Error("invalid_classes"), { code: "invalid_classes" });
    }
    const out = new Set<TrustedCommandClassId>();
    for (const id of input) {
      if (typeof id !== "string" || !ID_SET.has(id)) {
        throw Object.assign(new Error("invalid_classes"), { code: "invalid_classes" });
      }
      out.add(id as TrustedCommandClassId);
    }
    return [...out].sort();
  }

  async read(workspace: string): Promise<TrustedCommandClassesView> {
    const canonical = await this.canonical(workspace);
    const target = this.file(canonical);
    let fallback: TrustedCommandClassesFallbackReason = null;
    let record: Stored | null = null;
    try {
      const raw = await fs.readFile(target, "utf8");
      try {
        record = JSON.parse(raw) as Stored;
      } catch {
        fallback = "invalid";
        record = null;
      }
      if (
        !fallback &&
        (
          record?.version !== 1 ||
          record.workspace !== canonical ||
          !Array.isArray(record.classes) ||
          !record.revision ||
          record.classes.some((id) => !ID_SET.has(id))
        )
      ) {
        fallback = "invalid";
        record = null;
      }
    } catch (e) {
      fallback =
        (e as NodeJS.ErrnoException)?.code === "ENOENT" ? "missing" : "unreadable";
    }
    if (fallback || !record) {
      return {
        status: "confirmed",
        workspace: canonical,
        classes: [],
        revision: "fallback",
        source: "fallback",
        fallbackReason: fallback || "invalid",
        savedForWorkspace: false,
        catalog: TRUSTED_COMMAND_CLASS_CATALOG,
      };
    }
    return {
      status: "confirmed",
      workspace: canonical,
      classes: this.normalizeClasses(record.classes),
      revision: record.revision,
      source: "saved",
      fallbackReason: null,
      savedForWorkspace: true,
      catalog: TRUSTED_COMMAND_CLASS_CATALOG,
    };
  }

  async save(
    workspace: string,
    classes: unknown,
    expectedRevision: string,
  ): Promise<TrustedCommandClassesView> {
    const current = await this.read(workspace);
    if (current.revision !== expectedRevision) {
      throw Object.assign(new Error("class_revision_conflict"), {
        code: "class_revision_conflict",
      });
    }
    const normalized = this.normalizeClasses(classes);
    const record: Stored = {
      version: 1,
      workspace: current.workspace,
      classes: normalized,
      revision: this.revisionFactory(),
      savedAt: new Date().toISOString(),
    };
    const target = this.file(current.workspace);
    const tmp = `${target}.${process.pid}.tmp`;
    await fs.mkdir(path.dirname(target), { recursive: true });
    try {
      await fs.writeFile(tmp, JSON.stringify(record), "utf8");
      await fs.rename(tmp, target);
    } catch (e) {
      await fs.rm(tmp, { force: true }).catch(() => {});
      throw Object.assign(e instanceof Error ? e : new Error("class_save_failed"), {
        code: "class_save_failed",
      });
    }
    return {
      status: "confirmed",
      workspace: current.workspace,
      classes: normalized,
      revision: record.revision,
      source: "saved",
      fallbackReason: null,
      savedForWorkspace: true,
      catalog: TRUSTED_COMMAND_CLASS_CATALOG,
    };
  }
}
