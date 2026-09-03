import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ThreadHeader } from "./ThreadHeader";

afterEach(() => cleanup());

function baseProps() {
  return {
    title: "Fix typecheck in apps/shell",
    onExport: () => undefined,
    changesOpen: true,
    onToggleChanges: () => undefined,
    changesAvailable: false,
    overview: <div data-testid="overview-content">overview</div>,
  };
}

describe("ThreadHeader — title and meta", () => {
  it("shows the session title", () => {
    render(<ThreadHeader {...baseProps()} />);
    assert.ok(screen.getByText("Fix typecheck in apps/shell"));
  });

  it("joins model, effort, and elapsed minutes with a middot, omitting parts that are not real", () => {
    const { container } = render(
      <ThreadHeader {...baseProps()} model="grok-4.6" effortLabel="Expert" elapsedMinutes={14} />,
    );
    const meta = container.querySelector(".meta");
    assert.equal(meta?.textContent, "grok-4.6 · Expert · 14 min");
  });

  it("never fabricates effort or elapsed when they are not provided", () => {
    const { container } = render(<ThreadHeader {...baseProps()} model="grok-4.6" />);
    const meta = container.querySelector(".meta");
    assert.equal(meta?.textContent, "grok-4.6");
  });

  it("renders no meta element at all when nothing real is known", () => {
    const { container } = render(<ThreadHeader {...baseProps()} />);
    assert.equal(container.querySelector(".meta"), null);
  });
});

describe("ThreadHeader — live status", () => {
  it("shows amber Waiting for you when a decision is pending, overriding any phase text", () => {
    const { container } = render(
      <ThreadHeader {...baseProps()} decisionPending liveStatusText="Thinking…" elapsedSeconds={41} />,
    );
    const hstat = container.querySelector(".hstat");
    assert.match(hstat?.textContent ?? "", /Waiting for you/);
    assert.match(hstat?.textContent ?? "", /41s/);
    assert.equal(hstat?.querySelector(".dot")?.classList.contains("needs"), true);
  });

  it("shows the real live phase text in cyan when nothing is pending", () => {
    const { container } = render(<ThreadHeader {...baseProps()} liveStatusText="Using tools…" elapsedSeconds={7} />);
    const hstat = container.querySelector(".hstat");
    assert.match(hstat?.textContent ?? "", /Using tools…/);
    assert.match(hstat?.textContent ?? "", /7s/);
    assert.equal(hstat?.querySelector(".dot")?.classList.contains("live"), true);
  });

  it("renders no live-status element when there is nothing live and no decision pending", () => {
    const { container } = render(<ThreadHeader {...baseProps()} />);
    assert.equal(container.querySelector(".hstat"), null);
  });

  it("shows a ghost Cancel run button only while a run is cancellable, and it calls onCancel", () => {
    const calls: number[] = [];
    const { rerender } = render(
      <ThreadHeader {...baseProps()} liveStatusText="Thinking…" cancellable onCancel={() => calls.push(1)} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel run" }));
    assert.deepEqual(calls, [1]);
    rerender(<ThreadHeader {...baseProps()} liveStatusText="Thinking…" cancellable={false} />);
    assert.equal(screen.queryByRole("button", { name: "Cancel run" }), null);
  });
});

describe("ThreadHeader — Overview popover", () => {
  it("Overview button opens the overview content and Escape closes it", () => {
    render(<ThreadHeader {...baseProps()} />);
    assert.equal(screen.queryByTestId("overview-content"), null);
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    assert.ok(screen.getByTestId("overview-content"));
    fireEvent.keyDown(document, { key: "Escape" });
    assert.equal(screen.queryByTestId("overview-content"), null);
  });

  it("clicking Overview again toggles it closed", () => {
    render(<ThreadHeader {...baseProps()} />);
    const btn = screen.getByRole("button", { name: "Overview" });
    fireEvent.click(btn);
    assert.ok(screen.getByTestId("overview-content"));
    fireEvent.click(btn);
    assert.equal(screen.queryByTestId("overview-content"), null);
  });
});

describe("ThreadHeader — Export", () => {
  it("Export calls onExport and is disabled when there is nothing to export", () => {
    const calls: number[] = [];
    const { rerender } = render(<ThreadHeader {...baseProps()} onExport={() => calls.push(1)} />);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    assert.deepEqual(calls, [1]);
    rerender(<ThreadHeader {...baseProps()} onExport={() => calls.push(1)} exportDisabled />);
    assert.equal(screen.getByRole("button", { name: "Export" }).hasAttribute("disabled"), true);
  });
});

describe("ThreadHeader — Changes chip", () => {
  it("is absent when nothing is available for the dock", () => {
    render(<ThreadHeader {...baseProps()} changesAvailable={false} />);
    assert.equal(screen.queryByRole("button", { name: /Changes/ }), null);
  });

  it("shows the count and calls onToggleChanges when available", () => {
    const calls: number[] = [];
    render(
      <ThreadHeader
        {...baseProps()}
        changesAvailable
        changesCount={2}
        onToggleChanges={() => calls.push(1)}
      />,
    );
    const chip = screen.getByRole("button", { name: /Changes/ });
    assert.match(chip.textContent ?? "", /2/);
    fireEvent.click(chip);
    assert.deepEqual(calls, [1]);
  });
});
