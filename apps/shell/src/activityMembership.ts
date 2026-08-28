export type ActivityMembershipKey = { sessionId: string; runId: string };
export type IngressFence = { connectionGeneration: number };

export function membershipKey(sessionId: string, runId: string): string {
  return `${sessionId}\u0000${runId}`;
}

export function ownedRunKeys(
  runs: Array<{ sessionId: string; runId: string }>,
): Set<string> {
  return new Set(runs.map((r) => membershipKey(r.sessionId, r.runId)));
}

export function ownedRunKeysFromProjection(
  runs: Array<{ sessionId: string; runId: string } | null | undefined>,
  sessionId: string | null | undefined,
): Set<string> {
  if (!sessionId) return new Set();
  return ownedRunKeys(
    runs.filter((run): run is { sessionId: string; runId: string } =>
      Boolean(run && run.sessionId === sessionId),
    ),
  );
}

export function isOwnedMembership(
  owned: Set<string>,
  key: ActivityMembershipKey,
): boolean {
  return owned.has(membershipKey(key.sessionId, key.runId));
}

export function filterOwnedActivities<T extends ActivityMembershipKey>(
  owned: Set<string>,
  rows: T[],
): T[] {
  return rows.filter((row) => isOwnedMembership(owned, row));
}

/**
 * ACP-parent-global observe facts may paint only on owned runs of the
 * session that produced the current host roster. Foreign / unattributed
 * host rosters stay quiet. Terminal is not a withhold — live chips are a
 * separate voucher (`hasCurrentVoucher`).
 */
export function hostObserveRosterEligible(input: {
  owned: Set<string>;
  key: ActivityMembershipKey;
  runState: string;
  activeSessionId: string | null;
  hostOwnerSessionId: string | null;
}): boolean {
  if (!input.activeSessionId || !input.hostOwnerSessionId) return false;
  if (input.hostOwnerSessionId !== input.activeSessionId) return false;
  if (input.key.sessionId !== input.activeSessionId) return false;
  void input.runState;
  return isOwnedMembership(input.owned, input.key);
}

export function observeRosterFingerprint(input: {
  childIds?: Array<string | null | undefined>;
  mcpIds?: Array<string | null | undefined>;
  hookIds?: Array<string | null | undefined>;
  browserIds?: Array<string | null | undefined>;
}): string {
  const join = (ids?: Array<string | null | undefined>) =>
    (ids ?? []).filter((id): id is string => Boolean(id)).join("\u0001");
  return [join(input.childIds), join(input.mcpIds), join(input.hookIds), join(input.browserIds)].join("\u0002");
}
