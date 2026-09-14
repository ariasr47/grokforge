import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { api, type GrokConnectorsView } from "../lib/api";
import { ConnectorsPanel } from "./ConnectorsPanel";

afterEach(() => cleanup());

const VIEW: GrokConnectorsView = {
  linkedStatus: "unknown",
  manageUrl: "https://grok.com/connectors",
  chatUsesGrokConnectors: false,
  catalogDocs: ["Gmail", "Google Drive", "Custom MCP"],
};

describe("ConnectorsPanel honesty", () => {
  it("signed-in: unknown status, grok.com door, no paste catalog", async () => {
    const orig = api.grokConnectors;
    api.grokConnectors = async () => VIEW;
    try {
      render(<ConnectorsPanel signedIn />);
      assert.ok(await screen.findByRole("heading", { name: "Grok connectors" }));
      assert.ok(screen.getByText(/Linked status: unknown/));
      assert.ok(screen.getByText(/Forge Chat does not use them yet/));
      const door = screen.getByRole("link", { name: "Open grok.com/connectors" });
      assert.equal(door.getAttribute("href"), "https://grok.com/connectors");
      assert.equal(screen.queryByText(/Paste workflow/i), null);
      assert.equal(screen.queryByRole("button", { name: "Try in Chat" }), null);
      assert.equal(screen.queryByRole("button", { name: "Test" }), null);
      assert.ok(
        await screen.findByText((_content, node) =>
          Boolean(
            node?.classList.contains("connectors-catalog-note") &&
              /documentation, not your account/.test(node.textContent ?? ""),
          ),
        ),
      );
    } finally {
      api.grokConnectors = orig;
    }
  });

  it("signed-out: does not invent connected badges", async () => {
    const orig = api.grokConnectors;
    api.grokConnectors = async () => VIEW;
    try {
      render(<ConnectorsPanel signedIn={false} />);
      await waitFor(() => {
        assert.ok(screen.getByText(/Linked status: unknown/));
      });
      assert.ok(screen.getByText(/Signing into Forge does not reveal them/));
      assert.equal(screen.queryByText(/Connected/i), null);
      assert.equal(
        screen.queryByText(/this list is documentation, not your account/),
        null,
      );
    } finally {
      api.grokConnectors = orig;
    }
  });
});
