import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen } from "@testing-library/react";
import {
  CODE_RUN_CONFIRM_ERROR,
  CODE_RUN_FALLBACK,
  CODE_RUN_HYDRATING,
  CODE_RUN_VENDOR,
} from "./codeRunProvenance";
import { CodeRunProvenanceChip } from "./CodeRunProvenanceChip";

afterEach(() => cleanup());

test("absent renders nothing", () => {
  const { container } = render(
    <CodeRunProvenanceChip projection={{ state: "absent" }} />,
  );
  assert.equal(container.textContent, "");
  assert.equal(screen.queryByText(CODE_RUN_VENDOR), null);
});

test("hydrating / vendor / fallback / confirm-error exact copy", () => {
  const { rerender, container } = render(
    <CodeRunProvenanceChip projection={{ state: "hydrating" }} />,
  );
  assert.ok(screen.getByText(CODE_RUN_HYDRATING));
  assert.ok(screen.getByRole("status"));
  assert.ok(container.querySelector(".code-run-provenance.is-pending.is-quiet"));
  rerender(<CodeRunProvenanceChip projection={{ state: "vendor" }} />);
  assert.ok(screen.getByText(CODE_RUN_VENDOR));
  assert.ok(container.querySelector(".code-run-provenance.is-vendor.is-quiet"));
  rerender(
    <CodeRunProvenanceChip
      projection={{ state: "fallback", reason: "cli_missing" }}
    />,
  );
  assert.match(screen.getByRole("status").textContent ?? "", /Mini-Grok · fallback/);
  assert.match(screen.getByRole("status").textContent ?? "", /Grok CLI not found/);
  assert.ok(container.querySelector(".is-fallback-warn"));
  assert.equal(screen.queryByText(CODE_RUN_VENDOR), null);
  rerender(<CodeRunProvenanceChip projection={{ state: "confirm_error" }} />);
  assert.ok(screen.getByText(CODE_RUN_CONFIRM_ERROR));
});

test("generic fallback does not invent a cause", () => {
  render(
    <CodeRunProvenanceChip projection={{ state: "fallback", reason: null }} />,
  );
  assert.equal(screen.getByRole("status").textContent, CODE_RUN_FALLBACK);
  assert.equal(screen.queryByText(/Grok CLI not found/), null);
  assert.equal(screen.queryByText(/Couldn't start Grok agent/), null);
});
