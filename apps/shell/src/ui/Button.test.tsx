import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
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
});
