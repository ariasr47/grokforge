import type { ReactNode } from "react";
import { Tooltip as AriaTooltip, TooltipTrigger } from "react-aria-components";

export function Hint({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <TooltipTrigger delay={400}>
      {children}
      <AriaTooltip className="ui-tooltip">{label}</AriaTooltip>
    </TooltipTrigger>
  );
}
