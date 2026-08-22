import type { ActivityRecord } from "./runReducer";
import { Button } from "./ui/Button";
export function AutoEditRecovery({ activity, onRevert }: { activity: ActivityRecord; onRevert?: () => void }) {
  if (!activity.recovery?.available) return null;
  return <div className="edit-recovery"><span>Trusted workspace edit applied</span><Button variant="ghost" onClick={onRevert}>Revert edit</Button>{activity.recovery.status === "conflict" && <span role="alert">Edit not reverted</span>}</div>;
}
import React from "react";
void React;
