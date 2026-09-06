import { memo } from "react";
import {
  codeRunProvenanceCopy,
  type CodeRunProvenanceProjection,
} from "../projections/codeRunProvenance";

export type CodeRunProvenanceChipProps = {
  projection: CodeRunProvenanceProjection;
};

function toneClass(projection: CodeRunProvenanceProjection): string {
  if (projection.state === "vendor" || projection.state === "house") return "is-vendor is-quiet";
  if (projection.state === "hydrating") return "is-pending is-quiet";
  if (projection.state === "fallback") return "is-fallback-warn";
  if (projection.state === "confirm_error") return "is-error";
  return "is-pending";
}

export const CodeRunProvenanceChip = memo(function CodeRunProvenanceChip({
  projection,
}: CodeRunProvenanceChipProps) {
  if (projection.state === "absent") return null;
  const text = codeRunProvenanceCopy(projection);
  return (
    <span
      className={`code-run-provenance ${toneClass(projection)}`}
      data-code-run-provenance={projection.state}
      role={projection.state === "confirm_error" ? "alert" : "status"}
    >
      {text}
    </span>
  );
});
