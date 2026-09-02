import { cva, type VariantProps } from "class-variance-authority";
import clsx from "clsx";
import {
  type ForwardedRef,
  forwardRef,
  type ReactNode,
  useLayoutEffect,
  useRef,
} from "react";
import type { AriaButtonProps } from "react-aria";
import { useButton } from "react-aria";

export const buttonVariants = cva("btn", {
  variants: {
    variant: {
      default: "",
      primary: "primary",
      ghost: "ghost",
      accent: "accent",
      danger: "danger",
    },
    size: {
      sm: "btn-sm",
      md: "",
      lg: "btn-lg",
    },
  },
  defaultVariants: { variant: "default", size: "md" },
});

export type ButtonVariant = NonNullable<
  VariantProps<typeof buttonVariants>["variant"]
>;
export type ButtonSize = NonNullable<
  VariantProps<typeof buttonVariants>["size"]
>;

export interface ButtonProps extends Omit<AriaButtonProps, "isDisabled"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children?: ReactNode;
  /** Native alias — React Aria uses onPress. */
  onClick?: () => void;
  disabled?: boolean;
  isDisabled?: boolean;
  title?: string;
  id?: string;
}

function assignRef<T>(ref: ForwardedRef<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

/** Voidglass `.btn` with React Aria press/focus. Native title/id stay on the button. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "default",
      size = "md",
      className,
      onClick,
      onPress,
      disabled,
      isDisabled,
      title,
      id,
      children,
      ...rest
    },
    forwardedRef,
  ) {
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
    useLayoutEffect(() => {
      assignRef(forwardedRef, ref.current);
      return () => assignRef(forwardedRef, null);
    }, [forwardedRef]);
    return (
      <button
        {...buttonProps}
        ref={ref}
        type="button"
        className={clsx(buttonVariants({ variant, size }), className)}
        title={title}
        id={id}
      >
        {children}
      </button>
    );
  },
);
