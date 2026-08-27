import assert from "node:assert/strict";
import test from "node:test";
import { activityHumanLabel } from "./activityLabel.js";

test("present title wins", () => {
  assert.equal(activityHumanLabel({ title: "Reading notes.md", summary: "Read notes.md", name: "read_file" }), "Reading notes.md");
});
test("summary when title absent", () => {
  assert.equal(activityHumanLabel({ title: null, summary: "Read notes.md", name: "read_file" }), "Read notes.md");
});
test("name when title/summary absent", () => {
  assert.equal(activityHumanLabel({ title: null, summary: null, name: "read_file" }), "read_file");
});
test("all null → null (no invented headline)", () => {
  assert.equal(activityHumanLabel({ title: null, summary: null, name: null }), null);
});
test("whitespace-only title/summary/name is not a headline", () => {
  assert.equal(activityHumanLabel({ title: "  ", summary: "\n", name: "" }), null);
});
