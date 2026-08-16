import type { ActivityRecord } from "./runReducer";
export function AutoEditRecovery({ activity, onRevert }: { activity: ActivityRecord; onRevert?: () => void }) {
  if (!activity.recovery?.available) return null;
  return <div className="edit-recovery"><span>Trusted workspace edit applied</span><button type="button" onClick={onRevert}>Revert edit</button>{activity.recovery.status === "conflict" && <span role="alert">Edit not reverted</span>}</div>;
}
import React from "react";
void React;
