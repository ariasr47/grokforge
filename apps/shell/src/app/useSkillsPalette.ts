import { useEffect, useMemo, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { CodeAgentFact, ProductMode, SkillsCatalogFact } from "../lib/api";
import {
  filterSkillCommands,
  mayOpenSkillsPalette,
  projectSkillsPalette,
  shouldClearArmedInvocation,
  slashTokenFilter,
  stripLeadingSlashToken,
  type SkillsPaletteProjection,
} from "../projections/skillsCatalogComposer";

export interface UseSkillsPaletteParams {
  productMode: ProductMode;
  codeAgent: CodeAgentFact | null;
  skillsCatalog: SkillsCatalogFact | undefined;
  draft: string;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  sessionId: string | null;
  /**
   * App.tsx's own `setDraft`. Not part of the brief's literal input list —
   * required because `armSkill` (moved into this hook per the brief) strips
   * the leading slash token from the draft via
   * `setDraft(stripLeadingSlashToken(draft, caret))`, the same as it always
   * has. Without threading the real setter through, armSkill could not
   * preserve that behavior (see task-8-report.md).
   */
  setDraft: Dispatch<SetStateAction<string>>;
}

export interface UseSkillsPaletteResult {
  skillsPalette: SkillsPaletteProjection;
  skillsOpen: boolean;
  /**
   * The raw setter, exposed alongside `skillsOpen`. Three App.tsx sites
   * outside this hook close the palette directly with
   * `setSkillsOpen(false)` — onComposerKeyDown's Escape branch, the global
   * tinykeys Escape handler, and the ChatView `setSkillsOpen` prop — none of
   * which are part of this task's move. Keeping the same setter identity
   * available here (rather than only inside a same-named local `useState`
   * in App.tsx) is what lets those call sites keep working unchanged.
   */
  setSkillsOpen: Dispatch<SetStateAction<boolean>>;
  skillsRows: Array<{ name: string; description: string | null }>;
  skillsIndex: number;
  effectiveArmedName: string | null;
  /**
   * The raw armed-skill state, not just `effectiveArmedName`. `sendText`
   * (App.tsx, outside this move) reads `armedSkillName` directly and lists
   * it — not `effectiveArmedName` — in its own `useCallback` dependency
   * array. Substituting `effectiveArmedName` there would silently change
   * `sendText`'s memoization identity on renders where the palette is not
   * "ready" (armedSkillName can change while effectiveArmedName stays null
   * both times), which the Global Constraints forbid introducing as a side
   * effect of a move — see task-8-report.md. Exposing the same state value
   * under its original name touches zero of sendText's code.
   */
  armedSkillName: string | null;
  /**
   * The raw setter. `sendText` calls `setArmedSkillName(null)` directly in
   * two places (after a successful admit; on skill_handoff_unavailable),
   * and the ChatView JSX prop passes it straight through — none of which
   * are part of this move.
   */
  setArmedSkillName: Dispatch<SetStateAction<string | null>>;
  armSkill: (name: string) => void;
  setSkillsActiveIndex: Dispatch<SetStateAction<number>>;
}

/**
 * Skills-palette state, its projection memo, four effects, and armSkill —
 * moved verbatim out of App.tsx (Task 8). `skillsFilter` deliberately stays
 * out of both the params and the return: it is a pure, stateless function of
 * `draft`/`composerRef` alone (no timing hazard from being computed twice in
 * the same synchronous render — see task-8-report.md), App.tsx still needs
 * its own copy for a ChatView prop, and the brief's return list omits it, so
 * it is recomputed here privately, unexported, only to derive `skillsRows`.
 */
export function useSkillsPalette({
  productMode,
  codeAgent,
  skillsCatalog,
  draft,
  composerRef,
  sessionId,
  setDraft,
}: UseSkillsPaletteParams): UseSkillsPaletteResult {
  const [armedSkillName, setArmedSkillName] = useState<string | null>(null);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [skillsActiveIndex, setSkillsActiveIndex] = useState(0);

  const skillsPalette = useMemo(
    () =>
      projectSkillsPalette({
        mode: productMode,
        codeAgent,
        skillsCatalog,
      }),
    [
      productMode,
      codeAgent?.identity,
      codeAgent?.resolveStatus,
      codeAgent?.fallbackReason,
      skillsCatalog?.disposition,
      skillsCatalog?.commands,
    ],
  );
  const skillsFilter = slashTokenFilter(
    draft,
    composerRef.current?.selectionStart ?? draft.length,
  );
  const skillsRows =
    skillsPalette.state === "ready"
      ? filterSkillCommands(skillsPalette.commands, skillsFilter)
      : [];
  const skillsIndex =
    skillsRows.length === 0
      ? 0
      : Math.min(skillsActiveIndex, skillsRows.length - 1);
  const effectiveArmedName = shouldClearArmedInvocation(skillsPalette)
    ? null
    : armedSkillName;
  useEffect(() => {
    const caret = composerRef.current?.selectionStart ?? draft.length;
    const next = mayOpenSkillsPalette(skillsPalette, draft, caret);
    setSkillsOpen((open) => (open === next ? open : next));
  }, [skillsPalette.state, draft]);
  useEffect(() => {
    if (shouldClearArmedInvocation(skillsPalette)) setArmedSkillName(null);
  }, [skillsPalette.state]);
  useEffect(() => {
    setArmedSkillName(null);
  }, [sessionId]);
  useEffect(() => {
    setSkillsActiveIndex((i) => (i === 0 ? i : 0));
  }, [draft, skillsPalette.state]);

  // Kept as a plain function, not a useCallback — it already had no
  // memoization before the move (a fresh closure every App() render); see
  // task-8-report.md for why wrapping it now would be an unrequested
  // identity/timing change rather than a preserved one.
  const armSkill = (name: string) => {
    const caret = composerRef.current?.selectionStart ?? draft.length;
    setDraft(stripLeadingSlashToken(draft, caret));
    setArmedSkillName(name);
    setSkillsOpen(false);
    composerRef.current?.focus();
  };

  return {
    skillsPalette,
    skillsOpen,
    setSkillsOpen,
    skillsRows,
    skillsIndex,
    effectiveArmedName,
    armedSkillName,
    setArmedSkillName,
    armSkill,
    setSkillsActiveIndex,
  };
}
