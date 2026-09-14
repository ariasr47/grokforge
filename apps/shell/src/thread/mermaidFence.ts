import { fenceInfoToken } from "./codeHighlight";

export function isMermaidLang(langInfo?: string): boolean {
  return fenceInfoToken(langInfo) === "mermaid";
}

export const MERMAID_FAIL_COPY = "Couldn't draw this diagram.";
export const MERMAID_EMPTY_COPY = "No diagram.";

export type MermaidRenderer = (
  code: string,
  id: string,
  appearanceKey: string,
) => Promise<string>;

let rendererOverride: MermaidRenderer | null = null;

/** Test seam: inject success/fail; pass null to clear. */
export function __setMermaidRendererForTests(fn: MermaidRenderer | null): void {
  rendererOverride = fn;
}

async function defaultRenderer(
  code: string,
  id: string,
  appearanceKey: string,
): Promise<string> {
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: appearanceKey === "light" ? "default" : "dark",
  });
  const out = await mermaid.render(id, code);
  if (!out?.svg) throw new Error("mermaid returned no svg");
  return out.svg;
}

export async function renderMermaidSvg(
  code: string,
  id: string,
  appearanceKey: string,
): Promise<string> {
  const trimmed = code.trim();
  if (!trimmed) throw new Error("empty");
  const render = rendererOverride ?? defaultRenderer;
  return render(trimmed, id, appearanceKey);
}
