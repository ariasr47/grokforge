import { cva, type VariantProps } from "class-variance-authority";
import clsx from "clsx";
import { type ReactNode, useRef } from "react";
import type { AriaButtonProps } from "react-aria";
import { useButton } from "react-aria";

export const buttonVariants = cva("btn", {
  variants: {
    variant: {
      default: "",
      primary: "primary",
      ghost: "ghost",
    },
  },
  defaultVariants: { variant: "default" },
});

export type ButtonVariant = NonNullable<
  VariantProps<typeof buttonVariants>["variant"]
>;

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
      className={clsx(buttonVariants({ variant }), className)}
      title={title}
      id={id}
    >
      {children}
    </button>
  );
}
