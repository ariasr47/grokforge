import { GrokAcpServer, type Session } from "../src/server.js";
import type { ToolCall } from "../src/xai.js";

const server = new GrokAcpServer();
const internals = server as unknown as { runPrompt(session: Session, prompt: string, opts?: {owner?: {sessionId:string;runId:string;connectionGeneration:number}}): Promise<void>; notify(method: string, params: unknown, owner?: {sessionId:string;runId:string;connectionGeneration:number}): void };
let sequence = 0;
function tool(name: string, args: Record<string, unknown>): ToolCall { sequence += 1; return { id: `fixture-${process.env.GROKFORGE_MODE ?? "unknown"}-${sequence}`, type:"function", function:{name, arguments:JSON.stringify(args)} }; }
function plan(prompt: string): ToolCall[] {
  switch (prompt) {
    case "fixture:structured": return [tool("list_dir",{path:"."}),tool("read_file",{path:"fixture.txt"}),tool("grep",{pattern:"needle",path:"."})];
    case "fixture:shell-compatible": return [tool("run_shell",{command:"echo __EXEC__:%CMDCMDLINE% & echo __CWD__:%CD%"})];
    case "fixture:shell-dialect": return [tool("run_shell",{command:"NAME=value echo should-not-run > dialect-spawned.txt"})];
    case "fixture:shell-unresolved": return [tool("run_shell",{command:"ls > unresolved-spawned.txt"})];
    case "fixture:shell-failure": return [tool("run_shell",{command:"echo before-failure & exit /b 7"})];
    case "fixture:trusted-edit": return [tool("write_file",{path:"trusted.txt",content:"trusted text"})];
    case "fixture:trusted-multi-edit": return [tool("write_file",{path:"a.txt",content:"A"}),tool("write_file",{path:"b.txt",content:"B"}),tool("write_file",{path:"c.txt",content:"C"})];
    case "fixture:review-pending-two": return [tool("write_file",{path:"r1.txt",content:"one"}),tool("write_file",{path:"r2.txt",content:"two"})];
    case "fixture:bypass-edit": return [tool("write_file",{path:"bypass.txt",content:"x"})];
    case "fixture:binary-edit": return [tool("write_file",{path:"binary.bin",content:"before\u0000after"})];
    case "fixture:protected-delete": return [tool("run_shell",{command:"rmdir /s /q ."})];
    case "fixture:symlink-escape": return [tool("read_file",{path:"link.txt"})];
    default: throw new Error(`Unknown deterministic tool fixture: ${prompt}`);
  }
}
internals.runPrompt = async (session, prompt, opts) => { try { const calls=plan(prompt); if(prompt==="fixture:review-pending-two") await Promise.all(calls.map((call)=>server.executeTool(session, call, opts?.owner))); else for (const call of calls) await server.executeTool(session, call, opts?.owner); internals.notify("done",{reason:"stop"},opts?.owner); } catch (error) { internals.notify("error",{code:"deterministic_fixture_error",message:error instanceof Error?error.message:String(error)},opts?.owner); internals.notify("done",{reason:"error"},opts?.owner); } };
server.start();
