import test from "node:test"; import assert from "node:assert/strict";
test("current tool run tuple closes only known execution combinations",()=>{
  const pending={schemaVersion:2,type:"tool_run",activityId:"a",toolCallId:"c",lifecycle:"pending",execution:null,status:"running"};
  const rejected={...pending,lifecycle:"terminal",execution:"not_executed",status:"rejected",command:"ls",reasonCode:"leading_command_unresolved",reason:"missing"};
  assert.equal(pending.execution,null); assert.equal(rejected.status,"rejected"); assert.equal(rejected.execution,"not_executed");
});
