import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement, createRef } from "react";
import { Button } from "./Button";

afterEach(() => cleanup());

describe("Button", () => {
  it("keeps Voidglass .btn.primary so slot-weight tests still hold", () => {
    render(createElement(Button, { variant: "primary" }, "Allow once"));
    const el = screen.getByRole("button", { name: "Allow once" });
    assert.ok(el.classList.contains("btn"));
    assert.ok(el.classList.contains("primary"));
  });

  it("ghost variant is .btn.ghost", () => {
    render(createElement(Button, { variant: "ghost" }, "Deny"));
    const el = screen.getByRole("button", { name: "Deny" });
    assert.ok(el.classList.contains("btn"));
    assert.ok(el.classList.contains("ghost"));
  });

  it("disabled maps to a disabled button", () => {
    render(createElement(Button, { disabled: true }, "Send"));
    assert.equal(
      screen.getByRole("button", { name: "Send" }).hasAttribute("disabled"),
      true,
    );
  });

  it("forwards a ref onto the native button", () => {
    const ref = createRef<HTMLButtonElement>();
    render(createElement(Button, { ref }, "Send"));
    assert.equal(ref.current?.tagName, "BUTTON");
    assert.equal(
      ref.current === screen.getByRole("button", { name: "Send" }),
      true,
    );
  });

  it("cva extra className still keeps Voidglass .btn", () => {
    render(createElement(Button, { className: "msg-action" }, "Copy"));
    const el = screen.getByRole("button", { name: "Copy" });
    assert.ok(el.classList.contains("btn"));
    assert.ok(el.classList.contains("msg-action"));
  });

  it("default size renders plain .btn with no size suffix class", () => {
    render(createElement(Button, {}, "Send"));
    const el = screen.getByRole("button", { name: "Send" });
    assert.ok(el.classList.contains("btn"));
    assert.ok(!el.classList.contains("btn-sm"));
    assert.ok(!el.classList.contains("btn-lg"));
  });

  it("size sm maps to .btn-sm", () => {
    render(createElement(Button, { size: "sm" }, "Peek path"));
    const el = screen.getByRole("button", { name: "Peek path" });
    assert.ok(el.classList.contains("btn"));
    assert.ok(el.classList.contains("btn-sm"));
  });

  it("size lg maps to .btn-lg", () => {
    render(createElement(Button, { size: "lg" }, "Continue"));
    const el = screen.getByRole("button", { name: "Continue" });
    assert.ok(el.classList.contains("btn"));
    assert.ok(el.classList.contains("btn-lg"));
  });

  it("accent variant is .btn.accent", () => {
    render(createElement(Button, { variant: "accent" }, "Allow"));
    const el = screen.getByRole("button", { name: "Allow" });
    assert.ok(el.classList.contains("btn"));
    assert.ok(el.classList.contains("accent"));
  });

  it("danger variant is .btn.danger", () => {
    render(createElement(Button, { variant: "danger" }, "Delete"));
    const el = screen.getByRole("button", { name: "Delete" });
    assert.ok(el.classList.contains("btn"));
    assert.ok(el.classList.contains("danger"));
  });
});
