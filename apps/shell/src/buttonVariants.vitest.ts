import { describe, expect, it } from "vitest";
import { buttonVariants } from "./ui/Button";

describe("buttonVariants", () => {
  it("keeps Voidglass class tokens", () => {
    expect(buttonVariants({ variant: "primary" })).toContain("btn");
    expect(buttonVariants({ variant: "primary" })).toContain("primary");
    expect(buttonVariants({ variant: "ghost" })).toContain("ghost");
  });
});
