import { useEffect, useMemo, useState } from "react";
import { ComboBox, Input, ListBox, ListBoxItem } from "react-aria-components";
import { OverlayDialog } from "./ui/Dialog";

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  group?: string;
  run: () => void;
}

interface Props {
  open: boolean;
  actions: PaletteAction[];
  onClose: () => void;
}

export function CommandPalette({ open, actions, onClose }: Props) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return actions;
    return actions.filter(
      (a) =>
        a.label.toLowerCase().includes(needle) ||
        a.hint?.toLowerCase().includes(needle) ||
        a.id.toLowerCase().includes(needle),
    );
  }, [actions, q]);

  useEffect(() => {
    if (open) setQ("");
  }, [open]);

  const run = (a: PaletteAction) => {
    onClose();
    a.run();
  };

  return (
    <OverlayDialog
      isOpen={open}
      onClose={onClose}
      title="Command palette"
      overlayClassName="palette-overlay"
      modalClassName="palette"
    >
      <ComboBox
        aria-label="Command palette"
        menuTrigger="focus"
        inputValue={q}
        onInputChange={setQ}
        allowsCustomValue
        onSelectionChange={(key) => {
          const a = actions.find((x) => x.id === key);
          if (a) run(a);
        }}
      >
        <Input className="palette-input" placeholder="Type a command…" />
        <ListBox className="palette-list" aria-label="Commands">
          {filtered.length === 0 ? (
            <ListBoxItem id="__empty" isDisabled className="palette-empty">
              No matches
            </ListBoxItem>
          ) : (
            filtered.map((a) => (
              <ListBoxItem
                key={a.id}
                id={a.id}
                textValue={a.label}
                className="palette-option"
              >
                <span className="palette-label">{a.label}</span>
                {a.hint ? <span className="palette-hint">{a.hint}</span> : null}
              </ListBoxItem>
            ))
          )}
        </ListBox>
      </ComboBox>
      <div className="palette-footer" aria-hidden="true">
        <span>↑↓ navigate</span>
        <span>↵ run</span>
        <span>esc close</span>
        <span>Ctrl+L chat</span>
        <span>Ctrl+N new</span>
      </div>
    </OverlayDialog>
  );
}
