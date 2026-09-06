import { memo, useEffect, useRef, useState } from "react";
import {
  PI_COMPOSER_EMPTY,
  PI_COMPOSER_ERROR,
  PI_COMPOSER_LOADED_LABEL,
  PI_COMPOSER_LOADING,
  PI_COMPOSER_OFFLINE,
  piComposerLoadedTitle,
  type ProjectInstructionsComposerProjection,
} from "../projections/projectInstructionsComposer";

export {
  PI_COMPOSER_EMPTY,
  PI_COMPOSER_ERROR,
  PI_COMPOSER_LOADED_LABEL,
  PI_COMPOSER_LOADING,
  PI_COMPOSER_OFFLINE,
  piComposerLoadedTitle,
};

export type ProjectInstructionsStatusProps = {
  projection: ProjectInstructionsComposerProjection;
};

function loadedAccessibleName(path: string): string {
  return `${PI_COMPOSER_LOADED_LABEL} · ${path}`;
}

export const ProjectInstructionsStatus = memo(function ProjectInstructionsStatus({
  projection,
}: ProjectInstructionsStatusProps) {
  const prevRef = useRef(projection.state);
  const [announce, setAnnounce] = useState("");

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = projection.state;
    const flipped =
      (prev === "empty" && projection.state === "loaded") ||
      (prev === "loaded" && projection.state === "empty");
    if (!flipped) return;
    if (projection.state === "loaded") {
      setAnnounce(loadedAccessibleName(projection.path));
      return;
    }
    if (projection.state === "empty") {
      setAnnounce(PI_COMPOSER_EMPTY);
    }
  }, [projection.state]);

  if (projection.state === "absent_chat" || projection.state === "disabled_no_workspace") {
    return null;
  }

  if (projection.state === "loaded") {
    const title = piComposerLoadedTitle(projection.path);
    return (
      <div
        className="project-instructions-status is-loaded"
        data-project-instructions="loaded"
      >
        <span
          className="project-instructions-chip"
          role="status"
          title={title}
          aria-label={loadedAccessibleName(projection.path)}
        >
          <span className="project-instructions-label">{PI_COMPOSER_LOADED_LABEL}</span>
          <span className="project-instructions-dot" aria-hidden="true">
            ·
          </span>
          <span className="project-instructions-path" title={title}>
            {projection.path}
          </span>
        </span>
        {announce ? (
          <p className="sr-only" role="status" aria-live="polite">
            {announce}
          </p>
        ) : null}
      </div>
    );
  }

  if (projection.state === "empty") {
    return (
      <div
        className="project-instructions-status is-empty"
        data-project-instructions="empty"
      >
        <span className="project-instructions-chip" role="status">
          {PI_COMPOSER_EMPTY}
        </span>
        {announce ? (
          <p className="sr-only" role="status" aria-live="polite">
            {announce}
          </p>
        ) : null}
      </div>
    );
  }

  if (projection.state === "error") {
    return (
      <div
        className="project-instructions-status is-error"
        data-project-instructions="error"
      >
        <span className="project-instructions-chip" role="alert">
          {PI_COMPOSER_ERROR}
        </span>
      </div>
    );
  }

  if (projection.state === "loading") {
    return (
      <div
        className="project-instructions-status is-loading"
        data-project-instructions="loading"
      >
        <span className="project-instructions-chip" role="status">
          {PI_COMPOSER_LOADING}
        </span>
      </div>
    );
  }

  return (
    <div
      className="project-instructions-status is-offline"
      data-project-instructions="offline"
    >
      <span className="project-instructions-chip" role="status">
        {PI_COMPOSER_OFFLINE}
      </span>
    </div>
  );
});
