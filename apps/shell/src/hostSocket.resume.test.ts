import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { HostSocket } from "./api";
import { FakeWebSocket } from "./testFakeHost";

const originalWebSocket = globalThis.WebSocket;

function resumePayloads(ws: FakeWebSocket): unknown[] {
  return ws.sent.filter((msg) => (msg as { type?: string } | null)?.type === "resume_runs");
}

describe("HostSocket resume + FakeWebSocket abort guards", () => {
  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    FakeWebSocket.reset();
  });

  it("does not reopen a socket that closed before the open microtask", async () => {
    const ws = new FakeWebSocket("ws://localhost/ws");
    let opened = 0;
    ws.onopen = () => {
      opened += 1;
    };
    ws.close();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    assert.equal(ws.readyState, FakeWebSocket.CLOSED);
    assert.equal(opened, 0);
  });

  it("does not resend identical resume cursors", async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    const sock = new HostSocket();
    sock.connect();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    const ws = FakeWebSocket.latest();
    assert.ok(ws);
    assert.equal(ws.readyState, FakeWebSocket.OPEN);

    const cursors = [{ sessionId: "s1", runId: "r1", afterEventSeq: 4 }];
    sock.resume(cursors);
    sock.resume(cursors);
    sock.resume([{ sessionId: "s1", runId: "r1", afterEventSeq: 4 }]);
    assert.equal(resumePayloads(ws).length, 1);

    sock.resume([{ sessionId: "s1", runId: "r1", afterEventSeq: 5 }]);
    assert.equal(resumePayloads(ws).length, 2);
    sock.close();
  });
});
