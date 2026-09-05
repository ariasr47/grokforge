import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import type { RefObject } from "react";
import { useSkillsPalette } from "./useSkillsPalette";
import type { CodeAgentFact, ProductMode, SkillsCatalogFact } from "./api";

const VENDOR: CodeAgentFact = {
  resolveStatus: "ready",
  identity: "vendor",
  fallbackReason: null,
};
const FALLBACK: CodeAgentFact = {
  resolveStatus: "ready",
  identity: "fallback",
  fallbackReason: "cli_missing",
};
const READY_CATALOG: SkillsCatalogFact = {
  disposition: "ready",
  commands: [{ name: "/skill", description: "a skill" }],
};

// Mirrors how App.tsx actually calls the hook: draft is real useState (so
// armSkill's setDraft(...) call is observable), composerRef a real ref
// (never attached to a DOM node here, matching useArtifactBinding.test.ts's
// ref() helper idiom for an untouched ref).
function useHarness(props: {
  productMode: ProductMode;
  codeAgent: CodeAgentFact | null;
  skillsCatalog: SkillsCatalogFact | undefined;
  sessionId: string | null;
}) {
  const [draft, setDraft] = useState("");
  const composerRef = useRef<HTMLTextAreaElement | null>(null) as RefObject<HTMLTextAreaElement | null>;
  const hook = useSkillsPalette({
    productMode: props.productMode,
    codeAgent: props.codeAgent,
    skillsCatalog: props.skillsCatalog,
    draft,
    composerRef,
    sessionId: props.sessionId,
    setDraft,
  });
  return { ...hook, draft, setDraft };
}

describe("useSkillsPalette", () => {
  it("only opens in Code mode with a vendor agent", async () => {
    const { result, rerender } = renderHook(useHarness, {
      initialProps: {
        productMode: "chat" as ProductMode,
        codeAgent: null as CodeAgentFact | null,
        skillsCatalog: undefined as SkillsCatalogFact | undefined,
        sessionId: "s1",
      },
    });

    act(() => {
      result.current.setDraft("/skill");
    });
    assert.equal(result.current.skillsPalette.state, "absent");
    await waitFor(() => {
      assert.equal(result.current.skillsOpen, false);
    });

    // Same slash draft, still absent: code mode but a non-vendor agent.
    rerender({
      productMode: "code",
      codeAgent: FALLBACK,
      skillsCatalog: READY_CATALOG,
      sessionId: "s1",
    });
    assert.equal(result.current.skillsPalette.state, "absent");
    await waitFor(() => {
      assert.equal(result.current.skillsOpen, false);
    });

    // Same slash draft, now code mode + vendor agent: the palette opens.
    rerender({
      productMode: "code",
      codeAgent: VENDOR,
      skillsCatalog: READY_CATALOG,
      sessionId: "s1",
    });
    await waitFor(() => {
      assert.equal(result.current.skillsOpen, true);
    });
  });

  it("a session change clears the armed skill", async () => {
    const { result, rerender } = renderHook(useHarness, {
      initialProps: {
        productMode: "code" as ProductMode,
        codeAgent: VENDOR as CodeAgentFact | null,
        skillsCatalog: READY_CATALOG as SkillsCatalogFact | undefined,
        sessionId: "s1",
      },
    });

    act(() => {
      result.current.armSkill("/skill");
    });
    assert.equal(result.current.armedSkillName, "/skill");
    assert.equal(result.current.effectiveArmedName, "/skill");

    // Palette stays "ready" across this rerender (mode/codeAgent/catalog
    // unchanged) so only the sessionId-keyed clearing effect can fire —
    // isolating this assertion from the separate not-ready clearing effect.
    rerender({
      productMode: "code",
      codeAgent: VENDOR,
      skillsCatalog: READY_CATALOG,
      sessionId: "s2",
    });

    await waitFor(() => {
      assert.equal(result.current.armedSkillName, null);
    });
    assert.equal(result.current.effectiveArmedName, null);
  });

  it("arming fills the composer per today's behavior", () => {
    const { result } = renderHook(useHarness, {
      initialProps: {
        productMode: "code" as ProductMode,
        codeAgent: VENDOR as CodeAgentFact | null,
        skillsCatalog: READY_CATALOG as SkillsCatalogFact | undefined,
        sessionId: "s1",
      },
    });

    act(() => {
      result.current.setDraft("/skill");
    });
    assert.equal(result.current.skillsOpen, true, "precondition: palette open on a slash draft");

    act(() => {
      result.current.armSkill("/skill");
    });

    // stripLeadingSlashToken("/skill", 6) removes the whole token, matching
    // today's behavior: arming never inserts the skill name into the draft
    // (composeArmedPromptText does that later, only at send time).
    assert.equal(result.current.draft, "");
    assert.equal(result.current.armedSkillName, "/skill");
    assert.equal(result.current.effectiveArmedName, "/skill");
    assert.equal(result.current.skillsOpen, false);
  });
});
