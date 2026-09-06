import { describe, expect, it } from "vitest";
import { buttonVariants } from "./Button";

describe("buttonVariants", () => {
  it("keeps Voidglass class tokens", () => {
    expect(buttonVariants({ variant: "primary" })).toContain("btn");
    expect(buttonVariants({ variant: "primary" })).toContain("primary");
    expect(buttonVariants({ variant: "ghost" })).toContain("ghost");
  });

  it("gains accent and danger variants", () => {
    expect(buttonVariants({ variant: "accent" })).toContain("accent");
    expect(buttonVariants({ variant: "danger" })).toContain("danger");
  });

  it("gains sm/md/lg size variants with md as the default (no suffix class)", () => {
    expect(buttonVariants({ size: "sm" })).toContain("btn-sm");
    expect(buttonVariants({ size: "lg" })).toContain("btn-lg");
    expect(buttonVariants({ size: "md" })).toContain("btn");
    expect(buttonVariants({ size: "md" })).not.toContain("btn-sm");
    expect(buttonVariants({ size: "md" })).not.toContain("btn-lg");
    // default (no size passed) behaves the same as an explicit "md"
    expect(buttonVariants({})).not.toContain("btn-sm");
    expect(buttonVariants({})).not.toContain("btn-lg");
  });
});
