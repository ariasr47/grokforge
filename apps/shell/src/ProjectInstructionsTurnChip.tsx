import { memo } from "react";
import { recognizedProjectInstructionPath } from "./projectInstructionsComposer";
import {
  PI_TURN_CONFIRM_ERROR,
  PI_TURN_FAILED,
  PI_TURN_HYDRATING,
  PI_TURN_NOT_INCLUDED,
  piTurnIncluded,
  type ProjectInstructionsTurnProjection,
} from "./projectInstructionsTurn";

export {
  PI_TURN_CONFIRM_ERROR,
  PI_TURN_FAILED,
  PI_TURN_HYDRATING,
  PI_TURN_NOT_INCLUDED,
  piTurnIncluded,
};

export type ProjectInstructionsTurnChipProps = {
  projection: ProjectInstructionsTurnProjection;
};

function restoredCopy(projection: Extract<ProjectInstructionsTurnProjection, { state: "restored" }>): {
  text: string;
  tone: "included" | "empty" | "error";
} | null {
  if (projection.inclusion === "included") {
    const path = recognizedProjectInstructionPath(projection.path);
    if (!path) return null;
    return { text: piTurnIncluded(path), tone: "included" };
  }
  if (projection.inclusion === "failed") {
    return { text: PI_TURN_FAILED, tone: "error" };
  }
  return { text: PI_TURN_NOT_INCLUDED, tone: "empty" };
}

export const ProjectInstructionsTurnChip = memo(function ProjectInstructionsTurnChip({
  projection,
}: ProjectInstructionsTurnChipProps) {
  if (projection.state === "absent") return null;

  let text = "";
  let tone: "included" | "empty" | "error" | "pending" = "pending";
  let title: string | undefined;

  switch (projection.state) {
    case "hydrating":
      text = PI_TURN_HYDRATING;
      tone = "pending";
      break;
    case "included":
      text = piTurnIncluded(projection.path);
      tone = "included";
      title = projection.path;
      break;
    case "not_included":
      text = PI_TURN_NOT_INCLUDED;
      tone = "empty";
      break;
    case "failed":
      text = PI_TURN_FAILED;
      tone = "error";
      break;
    case "confirm_error":
      text = PI_TURN_CONFIRM_ERROR;
      tone = "error";
      break;
    case "restored": {
      const restored = restoredCopy(projection);
      if (!restored) return null;
      text = restored.text;
      tone = restored.tone;
      if (restored.tone === "included" && projection.path) title = projection.path;
      break;
    }
  }

  return (
    <span
      className={`project-instructions-turn is-${tone}`}
      data-project-instructions-turn={projection.state}
      role={tone === "error" ? "alert" : "status"}
      title={title}
    >
      {text}
    </span>
  );
});
