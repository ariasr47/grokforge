import { ChevronDown, Shield } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./ui/Icon";

export type EffectivePolicyKind = "review" | "trusted_workspace" | "bypass";

/** Bypass wins (it is a session override on top of whichever workspace
 *  policy is saved); otherwise the saved/confirmed workspace mode. */
export function effectivePolicyKind(input: {
  effectiveMode?: "review" | "trusted_workspace" | null;
  bypassActive?: boolean;
}): EffectivePolicyKind {
  if (input.bypassActive) return "bypass";
  if (input.effectiveMode === "trusted_workspace") return "trusted_workspace";
  return "review";
}

export const POLICY_CHIP_LABEL: Record<EffectivePolicyKind, string> = {
  review: "Review",
  trusted_workspace: "Trusted workspace",
  bypass: "Bypass",
};

/** The composer meta line's left-most fact. Plain descriptive copy, not a
 *  fabricated number or state — each sentence names what the active mode
 *  actually does, mirroring the fuller copy in PermissionPolicyControl /
 *  BypassPermissionsControl.
 *
 *  W3-1: verified against the actual gate — packages/grok-acp/src/
 *  authorization-broker.ts's AuthorizationBroker.authorize(). In "review"
 *  mode, text_edit only auto-applies when mode === "trusted_workspace", and
 *  shell only auto-applies for bypass or a matched trusted command class in
 *  trusted_workspace — so review always falls through to `decision: "decision"`
 *  (asks) for BOTH edits and shell, never auto-writing to disk. Independently
 *  confirmed by TrustedCommandClassesControl.tsx's own shipped copy ("Review
 *  still asks" / "it does not skip approvals while Policy is Review"). */
export const POLICY_SENTENCE: Record<EffectivePolicyKind, string> = {
  review: "Review asks before edits and shell",
  trusted_workspace: "Trusted workspace auto-applies eligible edits and asks before shell",
  bypass:
    "Bypass runs edits and shell without asking — OS permissions and destructive-operation circuit breakers still apply",
};

/**
 * The `Review ⌄` composer chip. Its trigger names the effective policy
 * (Review / Trusted workspace / Bypass); the popover it opens is whatever
 * `content` App.tsx hands it — the existing PermissionPolicyControl and (when
 * available) BypassPermissionsControl, unchanged, so their save flow and
 * Bypass's own confirmation gate keep doing the real work. This chip only
 * owns the open/close chrome, the same Escape/outside-click convention as
 * ThreadHeader's Overview popover.
 */
export function PolicyChip({
  kind,
  disabled,
  content,
}: {
  kind: EffectivePolicyKind;
  disabled?: boolean;
  content: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  // A11Y-3: focus the menu on open; return focus to the trigger on close —
  // but only when focus fell out to <body> (an outside click already sent
  // it somewhere real, so don't fight that).
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      menuRef.current?.focus({ preventScroll: true });
    } else if (!open && wasOpenRef.current) {
      if (!document.activeElement || document.activeElement === document.body) {
        triggerRef.current?.focus({ preventScroll: true });
      }
    }
    wasOpenRef.current = open;
  }, [open]);

  return (
    <div className="policy-chip-wrap" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="chip policy-trigger"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={POLICY_SENTENCE[kind]}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon icon={Shield} size={12} className="chip-ic" />
        <span>{POLICY_CHIP_LABEL[kind]}</span>
        <Icon icon={ChevronDown} size={11} className="chip-ch" />
      </button>
      {open ? (
        <div className="menu policy-menu" role="dialog" aria-label="Permission policy" ref={menuRef} tabIndex={-1}>
          {content}
        </div>
      ) : null}
    </div>
  );
}
