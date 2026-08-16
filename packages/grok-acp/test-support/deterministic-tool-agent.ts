import { GrokAcpServer, type Session } from "../src/server.js";
import type { ToolCall } from "../src/xai.js";

const server = new GrokAcpServer();
const internals = server as unknown as { runPrompt(session: Session, prompt: string): Promise<void>; notify(method: string, params: unknown): void };
let sequence = 0;
function tool(name: string, args: Record<string, unknown>): ToolCall { sequence += 1; return { id: `fixture-${process.env.GROKFORGE_MODE ?? "unknown"}-${sequence}`, type:"function", function:{name, arguments:JSON.stringify(args)} }; }
function plan(prompt: string): ToolCall[] {
  switch (prompt) {
    case "fixture:structured": return [tool("list_dir",{path:"."}),tool("read_file",{path:"fixture.txt"}),tool("grep",{pattern:"needle",path:"."})];
    case "fixture:shell-compatible": return [tool("run_shell",{command:"echo __EXEC__:%CMDCMDLINE% & echo __CWD__:%CD%"})];
    case "fixture:shell-dialect": return [tool("run_shell",{command:"NAME=value echo should-not-run > dialect-spawned.txt"})];
    case "fixture:shell-unresolved": return [tool("run_shell",{command:"ls > unresolved-spawned.txt"})];
    case "fixture:shell-failure": return [tool("run_shell",{command:"echo before-failure & exit /b 7"})];
    default: throw new Error(`Unknown deterministic tool fixture: ${prompt}`);
  }
}
internals.runPrompt = async (session, prompt) => { try { for (const call of plan(prompt)) await server.executeTool(session, call); internals.notify("done",{reason:"stop"}); } catch (error) { internals.notify("error",{code:"deterministic_fixture_error",message:error instanceof Error?error.message:String(error)}); internals.notify("done",{reason:"error"}); } };
server.start();
