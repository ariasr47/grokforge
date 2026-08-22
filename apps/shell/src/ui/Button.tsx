import { type ReactNode, useRef } from "react";
import type { AriaButtonProps } from "react-aria";
import { useButton } from "react-aria";

export type ButtonVariant = "default" | "primary" | "ghost";

export interface ButtonProps extends Omit<AriaButtonProps, "isDisabled"> {
  variant?: ButtonVariant;
  className?: string;
  children?: ReactNode;
  /** Native alias — React Aria uses onPress. */
  onClick?: () => void;
  disabled?: boolean;
  isDisabled?: boolean;
  title?: string;
  id?: string;
}

function buttonClass(variant: ButtonVariant, className?: string): string {
  const parts = new Set<string>(["btn"]);
  if (variant === "primary") parts.add("primary");
  if (variant === "ghost") parts.add("ghost");
  for (const token of className?.split(/\s+/) ?? []) {
    if (token) parts.add(token);
  }
  return [...parts].join(" ");
}

/** Voidglass `.btn` with React Aria press/focus. Native title/id stay on the button. */
export function Button({
  variant = "default",
  className,
  onClick,
  onPress,
  disabled,
  isDisabled,
  title,
  id,
  children,
  ...rest
}: ButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const { buttonProps } = useButton(
    {
      ...rest,
      isDisabled: isDisabled ?? disabled,
      onPress: (e) => {
        onPress?.(e);
        onClick?.();
      },
    },
    ref,
  );
  return (
    <button
      {...buttonProps}
      ref={ref}
      type="button"
      className={buttonClass(variant, className)}
      title={title}
      id={id}
    >
      {children}
    </button>
  );
}
