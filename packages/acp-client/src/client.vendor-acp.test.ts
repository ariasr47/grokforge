import test from "node:test";
import assert from "node:assert/strict";
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

const vendorChild = `
const r=require('readline').createInterface({input:process.stdin});
r.on('line',l=>{
  let m; try { m=JSON.parse(l); } catch { return; }
  if(m.method==='initialize'){
    process.stderr.write('INIT_PARAMS '+JSON.stringify(m.params)+'\\n');
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{protocolVersion:1}})+'\\n');
    return;
  }
  if(m.method==='session/new'){
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{sessionId:'v1'}})+'\\n');
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'session/update',params:{sessionId:'v1',update:{sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'thinking'}}}})+'\\n');
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'session/update',params:{sessionId:'v1',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'hello'}}}})+'\\n');
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'session/update',params:{sessionId:'v1',update:{sessionUpdate:'tool_call',toolCallId:'t1',title:'Read notes',kind:'read',status:'pending'}}})+'\\n');
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'session/update',params:{sessionId:'v1',update:{sessionUpdate:'tool_call_update',toolCallId:'t1',status:'completed'}}})+'\\n');
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:7,method:'session/request_permission',params:{sessionId:'v1',options:[{optionId:'allow_once',name:'Allow once',kind:'allow_once'}],toolCall:{toolCallId:'t1',title:'Write file',kind:'edit'}}})+'\\n');
    return;
  }
  if(m.method==='permission/respond'){
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'agent_log',params:{level:'warn',message:'GOT_PERMISSION_RESPOND'}})+'\\n');
    return;
  }
  if(m.id===7 && !m.method && ('result' in m || 'error' in m)){
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'agent_log',params:{level:'info',message:'ACP_RESULT '+JSON.stringify(m)}})+'\\n');
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

test("vendor initialize permissionMode default, session/update remap, ACP result settle", async () => {
  const client = new StdioAcpClient({
    workspaceRoot: process.cwd(),
    command: process.execPath,
    args: ["-e", vendorChild],
    env: Object.freeze({}),
    executionProfile: profile,
    initializePermissionMode: "default",
  });
  const events: AcpUiEvent[] = [];
  client.onEvent((e) => events.push(e));
  try {
    await client.initialize();
    const initLog = await waitFor(
      events,
      (e) => e.type === "agent_log" && e.message.startsWith("INIT_PARAMS "),
      "initialize params",
    );
    assert.equal(initLog.type, "agent_log");
    const initParams = JSON.parse(initLog.message.slice("INIT_PARAMS ".length)) as Record<string, unknown>;
    assert.equal(initParams.permissionMode, "default");
    assert.notEqual(initParams.permissionMode, "always-approve");
    assert.notEqual(initParams.permissionMode, "auto-allow-all");
    assert.notEqual(initParams.permissionMode, "bypassPermissions");
    assert.notEqual(initParams.permissionMode, "yolo");

    const sid = await client.newSession();
    assert.equal(sid, "v1");

    await waitFor(events, (e) => e.type === "thinking_delta" && e.text === "thinking", "thought");
    await waitFor(events, (e) => e.type === "text_delta" && e.text === "hello", "message");
    await waitFor(
      events,
      (e) => e.type === "tool_run" && e.lifecycle === "pending" && e.toolCallId === "t1",
      "tool pending",
    );
    await waitFor(
      events,
      (e) => e.type === "tool_run" && e.lifecycle === "terminal" && e.toolCallId === "t1",
      "tool terminal",
    );
    await waitFor(events, (e) => e.type === "permission_request" && e.id === "7", "permission request");

    assert.equal(events.some((e) => (e as { type: string }).type === "session/update"), false);
    assert.equal(events.some((e) => (e as { type: string }).type === "answer_delta"), false);

    await client.respondPermission("7", "allow_once");
    const resultLog = await waitFor(
      events,
      (e) => e.type === "agent_log" && e.message.startsWith("ACP_RESULT "),
      "acp result",
    );
    assert.equal(resultLog.type, "agent_log");
    const resultMsg = JSON.parse(resultLog.message.slice("ACP_RESULT ".length)) as {
      id: unknown;
      result?: { outcome?: { outcome?: string; optionId?: string } };
      method?: string;
    };
    assert.equal(resultMsg.id, 7);
    assert.equal(resultMsg.method, undefined);
    assert.equal(resultMsg.result?.outcome?.outcome, "selected");
    assert.equal(resultMsg.result?.outcome?.optionId, "allow_once");
    assert.equal(events.some((e) => e.type === "agent_log" && e.message.includes("GOT_PERMISSION_RESPOND")), false);
  } finally {
    await client.dispose();
  }
});

test("vendor session/new authenticates with cached_token when configured", async () => {
  const script = `const r=require('readline').createInterface({input:process.stdin}); r.on('line',l=>{const m=JSON.parse(l); if(m.method==='initialize') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{protocolVersion:1}})+'\\n'); if(m.method==='session/new') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{sessionId:'v1'}})+'\\n'); if(m.method==='authenticate'){ process.stderr.write('AUTH '+JSON.stringify(m.params)+'\\n'); process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{ok:true}})+'\\n'); }});`;
  const client = new StdioAcpClient({
    workspaceRoot: process.cwd(),
    command: process.execPath,
    args: ["-e", script],
    env: Object.freeze({}),
    executionProfile: profile,
    initializePermissionMode: "default",
    authenticateMethod: "cached_token",
  });
  const events: AcpUiEvent[] = [];
  client.onEvent((e) => events.push(e));
  try {
    await client.initialize();
    const sid = await client.newSession();
    assert.equal(sid, "v1");
    const logEv = await waitFor(
      events,
      (e) => e.type === "agent_log" && e.message.startsWith("AUTH "),
      "authenticate params",
    );
    assert.equal(logEv.type, "agent_log");
    const params = JSON.parse(logEv.message.slice("AUTH ".length)) as Record<string, unknown>;
    assert.equal(params.methodId, "cached_token");
  } finally {
    await client.dispose();
  }
});

test("vendor session/prompt sends prompt as a text content sequence", async () => {
  const script = `const r=require('readline').createInterface({input:process.stdin}); r.on('line',l=>{const m=JSON.parse(l); if(m.method==='initialize') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{protocolVersion:1}})+'\\n'); if(m.method==='session/new') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{sessionId:'v1'}})+'\\n'); if(m.method==='session/prompt'){ process.stderr.write('PROMPT '+JSON.stringify(m.params.prompt)+'\\n'); process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{ok:true}})+'\\n'); }});`;
  const client = new StdioAcpClient({
    workspaceRoot: process.cwd(),
    command: process.execPath,
    args: ["-e", script],
    env: Object.freeze({}),
    executionProfile: profile,
    initializePermissionMode: "default",
  });
  const events: AcpUiEvent[] = [];
  client.onEvent((e) => events.push(e));
  try {
    await client.initialize();
    await client.newSession();
    await client.prompt("v1", "hello vendor", { runId: "run-1", connectionGeneration: 1 });
    const logEv = await waitFor(
      events,
      (e) => e.type === "agent_log" && e.message.startsWith("PROMPT "),
      "prompt payload",
    );
    assert.equal(logEv.type, "agent_log");
    const prompt = JSON.parse(logEv.message.slice("PROMPT ".length));
    assert.equal(Array.isArray(prompt), true);
    assert.deepEqual(prompt, [{ type: "text", text: "hello vendor" }]);
  } finally {
    await client.dispose();
  }
});

test("session/new always sends mcpServers array (vendor grok agent requires the field)", async () => {
  const script = `const r=require('readline').createInterface({input:process.stdin}); r.on('line',l=>{const m=JSON.parse(l); if(m.method==='initialize') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{protocolVersion:1}})+'\\n'); if(m.method==='session/new'){ process.stderr.write('SESSION_NEW '+JSON.stringify(m.params)+'\\n'); process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{sessionId:'v1'}})+'\\n'); }});`;
  const client = new StdioAcpClient({
    workspaceRoot: process.cwd(),
    command: process.execPath,
    args: ["-e", script],
    env: Object.freeze({}),
    executionProfile: profile,
    initializePermissionMode: "default",
  });
  const events: AcpUiEvent[] = [];
  client.onEvent((e) => events.push(e));
  try {
    await client.initialize();
    const sid = await client.newSession();
    assert.equal(sid, "v1");
    const logEv = await waitFor(
      events,
      (e) => e.type === "agent_log" && e.message.startsWith("SESSION_NEW "),
      "session/new params",
    );
    assert.equal(logEv.type, "agent_log");
    const params = JSON.parse(logEv.message.slice("SESSION_NEW ".length)) as Record<string, unknown>;
    assert.equal(Array.isArray(params.mcpServers), true);
    assert.deepEqual(params.mcpServers, []);
    assert.equal(typeof params.cwd, "string");
    assert.ok(params.executionProfile);
  } finally {
    await client.dispose();
  }
});

test("grok-acp initialize omits permissionMode when not requested", async () => {
  const script = `const r=require('readline').createInterface({input:process.stdin}); r.on('line',l=>{const m=JSON.parse(l); if(m.method==='initialize'){ process.stderr.write('INIT_PARAMS '+JSON.stringify(m.params)+'\\n'); process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{}})+'\\n'); } if(m.method==='session/new') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{sessionId:'c1'}})+'\\n');});`;
  const client = new StdioAcpClient({
    workspaceRoot: process.cwd(),
    command: process.execPath,
    args: ["-e", script],
    env: Object.freeze({}),
    executionProfile: profile,
  });
  const events: AcpUiEvent[] = [];
  client.onEvent((e) => events.push(e));
  try {
    await client.initialize();
    const initLog = await waitFor(
      events,
      (e) => e.type === "agent_log" && e.message.startsWith("INIT_PARAMS "),
      "chat initialize params",
    );
    assert.equal(initLog.type, "agent_log");
    const initParams = JSON.parse(initLog.message.slice("INIT_PARAMS ".length)) as Record<string, unknown>;
    assert.equal("permissionMode" in initParams, false);
    await client.newSession();
  } finally {
    await client.dispose();
  }
});
