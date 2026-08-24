import type { ReactNode } from "react";
import { Switch as AriaSwitch } from "react-aria-components";

export function Switch({
  isSelected,
  onChange,
  isDisabled,
  children,
}: {
  isSelected: boolean;
  onChange: (selected: boolean) => void;
  isDisabled?: boolean;
  children: ReactNode;
}) {
  return (
    <AriaSwitch
      className="check-row"
      isSelected={isSelected}
      onChange={onChange}
      isDisabled={isDisabled}
    >
      <span className="switch-track" aria-hidden>
        <span className="switch-thumb" />
      </span>
      <span className="switch-label">{children}</span>
    </AriaSwitch>
  );
}
