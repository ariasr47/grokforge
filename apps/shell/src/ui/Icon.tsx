import type { LucideIcon, LucideProps } from "lucide-react";

export type { LucideIcon };

/** Chrome glyph. Brand mark stays SVG — do not use this for the Forge mark. */
export function Icon({
  icon: Glyph,
  size = 16,
  strokeWidth = 1.5,
  className,
  ...rest
}: { icon: LucideIcon } & LucideProps) {
  return (
    <Glyph
      size={size}
      strokeWidth={strokeWidth}
      className={["ui-icon", className].filter(Boolean).join(" ")}
      aria-hidden
      {...rest}
    />
  );
}
