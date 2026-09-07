import { memo, useEffect, useRef, useState } from "react";
import {
  CODE_AGENT_OFFLINE,
  codeAgentIdentityKind,
  codeAgentPrimaryCopy,
  codeAgentTitle,
  type CodeAgentComposerProjection,
} from "../projections/codeAgentComposer";

export type CodeAgentStatusProps = {
  projection: CodeAgentComposerProjection;
};

function toneClass(projection: CodeAgentComposerProjection): string {
  const identity = projection.state === "offline_unconfirmed" ? projection.last : projection;
  // Happy-path vendor is inline meta, not a second pill next to grok-4.6.
  // Fallback / hard_fail / offline / checking keep chip chrome.
  if (identity.state === "vendor") {
    return projection.state === "offline_unconfirmed" ? "is-vendor" : "is-vendor is-quiet";
  }
  if (identity.state === "house") {
    return projection.state === "offline_unconfirmed" ? "is-vendor" : "is-vendor is-quiet";
  }
  if (identity.state === "fallback") return "is-fallback-warn";
  if (identity.state === "hard_fail") return "is-error";
  if (projection.state === "checking") return "is-pending";
  return "is-pending";
}

export const CodeAgentStatus = memo(function CodeAgentStatus({
  projection,
}: CodeAgentStatusProps) {
  const prevKindRef = useRef<"vendor" | "house" | "fallback" | "hard_fail" | null>(null);
  const [announce, setAnnounce] = useState("");

  useEffect(() => {
    const next = codeAgentIdentityKind(projection);
    const prev = prevKindRef.current;
    prevKindRef.current = next;
    if (!next || !prev || prev === next) return;
    const flipped =
      (prev === "vendor" && next === "fallback") ||
      (prev === "fallback" && next === "vendor") ||
      next === "hard_fail";
    if (!flipped) return;
    if (projection.state === "offline_unconfirmed") {
      setAnnounce(codeAgentPrimaryCopy(projection.last));
      return;
    }
    setAnnounce(codeAgentPrimaryCopy(projection));
  }, [projection.state, projection]);

  if (projection.state === "absent_chat") return null;

  const title = codeAgentTitle(projection);
  const lastText =
    projection.state === "offline_unconfirmed"
      ? codeAgentPrimaryCopy(projection.last)
      : null;
  const text =
    projection.state === "offline_unconfirmed"
      ? lastText ?? ""
      : codeAgentPrimaryCopy(projection);

  return (
    <div
      className={`code-agent-status ${toneClass(projection)}`}
      data-code-agent={projection.state}
    >
      <span
        className="code-agent-chip"
        role="status"
        title={title}
        aria-label={
          projection.state === "offline_unconfirmed"
            ? `${text}. ${CODE_AGENT_OFFLINE}`
            : text
        }
      >
        <span className="code-agent-label">{text}</span>
        {projection.state === "offline_unconfirmed" ? (
          <span className="code-agent-offline">{CODE_AGENT_OFFLINE}</span>
        ) : null}
      </span>
      {announce ? (
        <p className="sr-only" role="status" aria-live="polite">
          {announce}
        </p>
      ) : null}
    </div>
  );
});
