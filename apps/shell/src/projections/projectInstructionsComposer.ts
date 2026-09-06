import type { ProductMode, ProjectInstructionsPresenceView } from "../lib/api";

export type ProjectInstructionsComposerProjection =
  | { state: "absent_chat" }
  | { state: "disabled_no_workspace" }
  | { state: "loading" }
  | { state: "offline" }
  | { state: "empty" }
  | { state: "loaded"; path: string }
  | { state: "error" };

export type ProjectInstructionsComposerInput = {
  mode?: ProductMode | string | null;
  workspace?: string | null;
  connected: boolean;
  projectInstructions?: ProjectInstructionsPresenceView;
};

export const PI_COMPOSER_EMPTY = "No project instructions";
export const PI_COMPOSER_LOADED_LABEL = "Project instructions";
export const PI_COMPOSER_LOADING = "Checking project instructions…";
export const PI_COMPOSER_ERROR = "Couldn’t resolve project instructions.";
export const PI_COMPOSER_OFFLINE = "Reconnect to confirm project instructions.";

export function piComposerLoadedTitle(path: string): string {
  return `Loaded for Code turns from ${path}.`;
}

export const PROJECT_INSTRUCTION_PROBE_NAMES = ["AGENTS.md", "CLAUDE.md"] as const;

export function recognizedProjectInstructionPath(
  path: string | null | undefined,
): "AGENTS.md" | "CLAUDE.md" | null {
  if (path === "AGENTS.md" || path === "CLAUDE.md") return path;
  return null;
}

/**
 * Closed composer precedence — exactly one winner:
 * 1. Chat → absent_chat
 * 2. no bound workspace → disabled_no_workspace
 * 3. vouched === false + connected → loading
 * 4. vouched === false + offline → offline
 * 5. vouched === true + absent → empty
 * 6. vouched === true + present → loaded
 * 7. vouched === true + failed → error
 */
export function projectProjectInstructionsComposer(
  input: ProjectInstructionsComposerInput,
): ProjectInstructionsComposerProjection {
  if (input.mode !== "code") return { state: "absent_chat" };
  if (!input.workspace) return { state: "disabled_no_workspace" };

  const view = input.projectInstructions;
  const vouched = view?.vouched === true;
  if (!vouched) {
    return input.connected ? { state: "loading" } : { state: "offline" };
  }

  if (view.status === "absent") return { state: "empty" };
  if (view.status === "present") {
    const path = recognizedProjectInstructionPath(view.path);
    if (path) return { state: "loaded", path };
    return { state: "loading" };
  }
  if (view.status === "failed") return { state: "error" };
  return { state: "loading" };
}
