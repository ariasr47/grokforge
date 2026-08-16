import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { terminateProcessTree, detachedSpawnOptions } from "./process-tree.js";

test("owned process tree cancellation terminates parent and descendants", async()=>{
  const childCode=`const {spawn}=require('node:child_process'); const g=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); console.log(g.pid); setInterval(()=>{},1000);`;
  const parent=spawn(process.execPath,["-e",`const {spawn}=require('node:child_process'); const c=spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:['ignore','pipe','ignore']}); c.stdout.on('data',d=>process.stdout.write(d)); setInterval(()=>{},1000);`],{...detachedSpawnOptions(),stdio:["ignore","pipe","ignore"]});
  const grandchild=await new Promise<number>((resolve,reject)=>{const t=setTimeout(()=>reject(new Error("grandchild pid timeout")),5000); parent.stdout!.on("data",d=>{const n=Number(String(d).trim());if(Number.isInteger(n)){clearTimeout(t);resolve(n);}});});
  const parentPid=parent.pid!; await terminateProcessTree(parentPid); await new Promise(r=>setTimeout(r,250));
  const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch{return false;}};
  assert.equal(alive(parentPid),false); assert.equal(alive(grandchild),false);
});
