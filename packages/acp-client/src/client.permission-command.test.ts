import test from "node:test";
// live 2026-09-10: host loads dist.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StdioAcpClient } from "./client.js";
import type { AcpUiEvent, HostExecutionProfile } from "./types.js";

const profile: HostExecutionProfile = {
  status: "available",
  platform: "win32",
  osFamily: "windows",
  executable: "C:\\Windows\\System32\\cmd.exe",
  argvPrefix: ["/d", "/s", "/c"],
  displayName: "Command Prompt (cmd.exe)",
  dialect: "cmd",
  pathSeparator: "\\",
  syntax: { quoting: "", chaining: "", redirection: "" },
};

const child = `
const r=require('readline').createInterface({input:process.stdin});
r.on('line',l=>{
  let m; try { m=JSON.parse(l); } catch { return; }
  if(m.method==='initialize'){
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{protocolVersion:1}})+'\\n');
    return;
  }
  if(m.method==='permission/respond'){
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{ok:true}})+'\\n');
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'agent_log',params:{level:'info',message:'PERM '+JSON.stringify(m.params)}})+'\\n');
  }
});
`;

function waitFor(events: AcpUiEvent[], pred: (e: AcpUiEvent) => boolean, label: string, ms = 2000): Promise<AcpUiEvent> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const hit = events.find(pred);
      if (hit) return resolve(hit);
      if (Date.now() - start > ms) return reject(new Error(`timeout waiting for ${label}`));
      setTimeout(tick, 10);
    };
    tick();
  });
}

test("respondPermission forwards command on permission/respond (YOU 04:15 stdout miss)", async () => {
  const client = new StdioAcpClient({
    workspaceRoot: process.cwd(),
    command: process.execPath,
    args: ["-e", child],
    env: Object.freeze({}),
    executionProfile: profile,
  });
  const events: AcpUiEvent[] = [];
  client.onEvent((e) => events.push(e));
  try {
    await client.initialize();
    await client.respondPermission(
      "call-edit",
      "allow_once",
      undefined,
      `node -e "console.log('forge-edit-right')"`,
    );
    const log = await waitFor(
      events,
      (e) => e.type === "agent_log" && e.message.startsWith("PERM "),
      "permission/respond params",
    );
    assert.equal(log.type, "agent_log");
    const params = JSON.parse(log.message.slice("PERM ".length)) as { command?: string; decision?: string; id?: string };
    assert.equal(params.id, "call-edit");
    assert.equal(params.decision, "allow_once");
    assert.equal(params.command, `node -e "console.log('forge-edit-right')"`);
  } finally {
    await client.dispose();
  }
});

test("dist client.js permission/respond includes command (stale dist ran forge-edit-wrong)", () => {
  const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "client.js");
  const js = fs.readFileSync(dist, "utf8");
  assert.match(
    js,
    /permission\/respond[\s\S]{0,400}command/,
    "host loads acp-client dist — source-only command override never reaches grok-acp",
  );
});
