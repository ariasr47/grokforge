/**
 * @deprecated Use ToolActivityGroup from ./ToolActivity — kept as a thin
 * single-tool wrapper for any residual imports.
 */
import { ToolActivityGroup } from "./ToolActivity";
import type { ChatMessage } from "./messageBlocks";

interface Props {
  name?: string;
  content: string;
  ok?: boolean;
  defaultOpen?: boolean;
}

export function ToolCard({ name, content, ok, defaultOpen = false }: Props) {
  const tool: ChatMessage = {
    id: `legacy-${name ?? "tool"}`,
    role: "tool",
    content,
    toolMeta: {
      name,
      ok,
      done: ok !== undefined,
      summary: undefined,
    },
  };
  // defaultOpen is handled per-row when ok === false inside the group
  void defaultOpen;
  return <ToolActivityGroup tools={[tool]} />;
}
