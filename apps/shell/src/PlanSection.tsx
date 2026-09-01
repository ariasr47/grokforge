import React, { useEffect, useRef, useState } from "react";
void React;
import type { PlanProposedMember, PlanRecord } from "./runReducer";
import {
  PLAN_ACCEPTED_TITLE,
  PLAN_CANCELLED,
  PLAN_CHIP_PROPOSED,
  PLAN_CHIP_WOULD_CHANGE,
  PLAN_EMPTY,
  PLAN_EXPLORING,
  PLAN_FAILED,
  PLAN_HEADER,
  PLAN_KEPT_HELPER,
  PLAN_KEPT_TITLE,
  PLAN_LOAD_FAILURE,
  PLAN_OFFLINE_SECTION,
  PLAN_READY_ANNOUNCE,
  PLAN_READY_HELPER,
  PLAN_RESTORING,
  PLAN_SUPERSEDED,
  acceptedHelper,
  type PlanSectionProjection,
} from "./runPlanSection";

export {
  PLAN_ACCEPTED_TITLE,
  PLAN_CANCELLED,
  PLAN_CHIP_PROPOSED,
  PLAN_CHIP_WOULD_CHANGE,
  PLAN_EMPTY,
  PLAN_EXPLORING,
  PLAN_FAILED,
  PLAN_HEADER,
  PLAN_KEPT_HELPER,
  PLAN_KEPT_TITLE,
  PLAN_LOAD_FAILURE,
  PLAN_OFFLINE_SECTION,
  PLAN_READY_ANNOUNCE,
  PLAN_READY_HELPER,
  PLAN_RESTORING,
  PLAN_SUPERSEDED,
  acceptedHelper,
};

export type PlanSectionProps = {
  projection: PlanSectionProjection;
  preserved?: PlanRecord | null;
  offline?: boolean;
};

function MemberRow({ member }: { member: PlanProposedMember }) {
  return (
    <li className="plan-member">
      <span className="chip plan-chip">{PLAN_CHIP_PROPOSED}</span>
      {member.path ? (
        <span className="plan-member-path" title={member.path}>
          <span className="plan-would-change">{PLAN_CHIP_WOULD_CHANGE}</span>
          {member.path}
        </span>
      ) : null}
      <span className="plan-member-summary">{member.summary}</span>
    </li>
  );
}

function PlanHeader({ count }: { count?: number }) {
  return (
    <header className="plan-section-header">
      <h2>{PLAN_HEADER}</h2>
      {typeof count === "number" ? (
        <span className="chip plan-count" aria-label={`${count} proposed members`}>
          {count}
        </span>
      ) : null}
    </header>
  );
}

export function PlanSection({ projection, preserved = null, offline = false }: PlanSectionProps) {
  const [open, setOpen] = useState(true);
  const [announce, setAnnounce] = useState("");
  const prevReady = useRef(false);

  const ready = projection.state === "ready" && !projection.empty;
  useEffect(() => {
    if (ready && !prevReady.current) setAnnounce(PLAN_READY_ANNOUNCE);
    prevReady.current = ready;
  }, [ready]);

  if (projection.state === "absent") return null;

  if (projection.state === "loading") {
    return (
      <section className="plan-section plan-section-loading" aria-label={PLAN_HEADER}>
        <PlanHeader />
        <p className="plan-loading" role="status">{PLAN_RESTORING}</p>
      </section>
    );
  }

  if (projection.state === "error") {
    return (
      <section className="plan-section plan-section-error" aria-label={PLAN_HEADER}>
        <PlanHeader />
        <p className="plan-error" role="alert">{projection.message}</p>
      </section>
    );
  }

  if (projection.state === "exploring") {
    return (
      <section className="plan-section plan-section-exploring" aria-label={PLAN_HEADER}>
        <PlanHeader />
        <p className="plan-exploring" role="status">{PLAN_EXPLORING}</p>
      </section>
    );
  }

  if (projection.state === "offline") {
    const members = preserved?.proposedMembers ?? [];
    return (
      <section className="plan-section plan-section-offline" aria-label={PLAN_HEADER}>
        <PlanHeader count={members.length > 0 ? members.length : undefined} />
        <p className="plan-offline" role="status">{PLAN_OFFLINE_SECTION}</p>
        {preserved?.body ? <p className="plan-body">{preserved.body}</p> : null}
        {members.length > 0 ? (
          <ul className="plan-members">
            {members.map((member, i) => (
              <MemberRow key={`${member.path ?? member.summary}-${i}`} member={member} />
            ))}
          </ul>
        ) : null}
      </section>
    );
  }

  if (projection.state === "ready") {
    const showOffline = offline;
    return (
      <section className="plan-section plan-section-ready" aria-label={PLAN_HEADER}>
        <button
          type="button"
          className="plan-toggle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <PlanHeader count={projection.proposedMembers.length} />
        </button>
        {showOffline ? <p className="plan-offline" role="status">{PLAN_OFFLINE_SECTION}</p> : null}
        {projection.empty ? (
          <p className="plan-empty" role="status">{PLAN_EMPTY}</p>
        ) : (
          <>
            {open ? (
              <>
                <p className="plan-helper">{PLAN_READY_HELPER}</p>
                {projection.body ? <p className="plan-body">{projection.body}</p> : null}
                <ul className="plan-members">
                  {projection.proposedMembers.map((member, i) => (
                    <MemberRow key={`${member.path ?? member.summary}-${i}`} member={member} />
                  ))}
                </ul>
              </>
            ) : null}
          </>
        )}
        <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      </section>
    );
  }

  if (projection.state === "accepted") {
    return (
      <section className="plan-section plan-section-accepted" aria-label={PLAN_HEADER}>
        <PlanHeader />
        <p className="plan-accepted" role="status">
          <strong>{PLAN_ACCEPTED_TITLE}</strong>
          <span>{acceptedHelper(projection.policyLabel, projection.bypassActive)}</span>
        </p>
        {projection.body ? <p className="plan-body">{projection.body}</p> : null}
      </section>
    );
  }

  if (projection.state === "kept_planning") {
    return (
      <section className="plan-section plan-section-kept" aria-label={PLAN_HEADER}>
        <PlanHeader />
        <p className="plan-kept" role="status">
          <strong>{PLAN_KEPT_TITLE}</strong>
          <span>{PLAN_KEPT_HELPER}</span>
        </p>
      </section>
    );
  }

  if (projection.state === "cancelled") {
    return (
      <section className="plan-section plan-section-cancelled" aria-label={PLAN_HEADER}>
        <PlanHeader />
        <p className="plan-cancelled" role="status">{PLAN_CANCELLED}</p>
      </section>
    );
  }

  if (projection.state === "failed") {
    return (
      <section className="plan-section plan-section-failed" aria-label={PLAN_HEADER}>
        <PlanHeader />
        <p className="plan-failed" role="status">{PLAN_FAILED}</p>
      </section>
    );
  }

  return (
    <section className="plan-section plan-section-superseded" aria-label={PLAN_HEADER}>
      <PlanHeader />
      <p className="plan-superseded" role="status">{PLAN_SUPERSEDED}</p>
      {preserved?.body ? <p className="plan-body">{preserved.body}</p> : null}
    </section>
  );
}
