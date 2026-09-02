import clsx from "clsx";
import { type ReactNode, useRef } from "react";
import { useButton } from "react-aria";

export type ChipTone = "default" | "quiet" | "on" | "attention";

export interface ChipProps {
  tone?: ChipTone;
  icon?: ReactNode;
  trailing?: ReactNode;
  children?: ReactNode;
  onPress?: () => void;
  title?: string;
  className?: string;
}

function ChipButton({
  className,
  title,
  onPress,
  children,
}: {
  className: string;
  title?: string;
  onPress: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const { buttonProps } = useButton({ onPress: () => onPress() }, ref);
  return (
    <button
      {...buttonProps}
      ref={ref}
      type="button"
      className={className}
      title={title}
    >
      {children}
    </button>
  );
}

/** Voidglass pill primitive. Pass `onPress` for an interactive chip; omit it for a static status pill. */
export function Chip({
  tone = "default",
  icon,
  trailing,
  children,
  onPress,
  title,
  className,
}: ChipProps) {
  const cls = clsx("chip", `chip-${tone}`, className);
  const content = (
    <>
      {icon}
      {children}
      {trailing}
    </>
  );
  if (onPress) {
    return (
      <ChipButton className={cls} title={title} onPress={onPress}>
        {content}
      </ChipButton>
    );
  }
  return (
    <span className={cls} title={title}>
      {content}
    </span>
  );
}
