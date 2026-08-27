import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { RunEventEnvelope, RunSnapshot } from "./run-types.js";

export class RunJournal {
  private locks = new Map<string, Promise<void>>();
  constructor(private readonly root: string) {}
  private dir(s:string,r:string){return path.join(this.root,"runs",s,r)}
  private async syncDir(dir:string){if(process.platform==="win32")return;try{const h=await fs.open(dir,"r");await h.sync();await h.close();}catch{/* Some filesystems do not expose directory handles. */}}
  private async serial<T>(key:string, fn:()=>Promise<T>):Promise<T>{const prior=this.locks.get(key)||Promise.resolve();let release!:()=>void;const next=new Promise<void>(r=>release=r);this.locks.set(key,next);await prior;try{return await fn()}finally{release();if(this.locks.get(key)===next)this.locks.delete(key)}}
  private async fileLock<T>(sessionId:string,runId:string,fn:()=>Promise<T>):Promise<T>{const lock=path.join(this.dir(sessionId,runId),"events.cas.lock");let handle:import("node:fs/promises").FileHandle|undefined;for(let i=0;i<500;i++){try{handle=await fs.open(lock,"wx");await handle.writeFile(`${process.pid}\n`);await handle.sync();break;}catch(error){if(handle){await handle.close().catch(()=>undefined);handle=undefined;}if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;let owner="";try{owner=(await fs.readFile(lock,"utf8")).trim();}catch{}const pid=Number(owner);if(Number.isInteger(pid)&&pid>0){try{process.kill(pid,0);}catch(e){if((e as NodeJS.ErrnoException).code==="ESRCH")await fs.rm(lock,{force:true});}}await new Promise(r=>setTimeout(r,2));}}if(!handle)throw new Error("journal CAS lock timeout");try{return await fn()}finally{await handle.close().catch(()=>undefined);await fs.rm(lock,{force:true});}}
  async admit(run:RunSnapshot):Promise<void>{await this.serial(`${run.sessionId}/${run.runId}`,async()=>{const d=this.dir(run.sessionId,run.runId);await fs.mkdir(d,{recursive:true});const events=path.join(d,"events.jsonl");const eh=await fs.open(events,"w");await eh.sync();await eh.close();const target=path.join(d,"meta.json"),tmp=`${target}.${process.pid}.tmp`;const mh=await fs.open(tmp,"w");await mh.writeFile(JSON.stringify(run),"utf8");await mh.sync();await mh.close();await fs.rename(tmp,target);await this.syncDir(d);})}
  private assertTypeKind(event:{type:string;payload:{kind:string}}):void{
    if(event.type!==event.payload.kind) throw Object.assign(new Error("journal_unavailable"),{code:"journal_unavailable"});
  }
  private async appendUnlocked(event:Omit<RunEventEnvelope,"eventSeq"|"occurredAt"> & Partial<Pick<RunEventEnvelope,"occurredAt">>):Promise<RunEventEnvelope>{this.assertTypeKind(event);const d=this.dir(event.sessionId,event.runId),file=path.join(d,"events.jsonl");let raw=await fs.readFile(file,"utf8").catch(()=>"");if(raw&&!raw.endsWith("\n")){const boundary=raw.lastIndexOf("\n")+1;await fs.truncate(file,boundary);raw=raw.slice(0,boundary);const h=await fs.open(file,"r+");await h.sync();await h.close();}const prior=await this.replay(event.sessionId,event.runId).catch(error=>{if((error as Error).message==="journal_corrupt")throw error;return [];});if(prior.some(e=>e.type==="run_terminal"))throw Object.assign(new Error("run terminal"),{code:"run_terminal"});const seq=prior.at(-1)?.eventSeq??0;const full={...event,eventSeq:seq+1,occurredAt:event.occurredAt||new Date().toISOString(),schemaVersion:1 as const};const fh=await fs.open(file,"a");try{await fh.writeFile(JSON.stringify(full)+"\n","utf8");await fh.sync();}finally{await fh.close();}return full}
  async append(event:Omit<RunEventEnvelope,"eventSeq"|"occurredAt"> & Partial<Pick<RunEventEnvelope,"occurredAt">>):Promise<RunEventEnvelope>{return this.serial(`${event.sessionId}/${event.runId}`,()=>this.fileLock(event.sessionId,event.runId,()=>this.appendUnlocked(event)))}
  async appendAfterTerminal(event:Omit<RunEventEnvelope,"eventSeq"|"occurredAt"> & Partial<Pick<RunEventEnvelope,"occurredAt">>):Promise<RunEventEnvelope>{
    if(!((event.type==="activity_update"&&event.payload.kind==="activity_update")||(event.type==="plan_record"&&event.payload.kind==="plan_record")||(event.type==="decision_request"&&event.payload.kind==="decision_request")||(event.type==="child_agent_update"&&event.payload.kind==="child_agent_update"))) throw Object.assign(new Error("only settlement activity may follow terminal"),{code:"run_terminal"});
    return this.serial(`${event.sessionId}/${event.runId}`,()=>this.fileLock(event.sessionId,event.runId,async()=>{
      const d=this.dir(event.sessionId,event.runId),file=path.join(d,"events.jsonl");
      let raw=await fs.readFile(file,"utf8").catch(()=>"");
      if(raw&&!raw.endsWith("\n")){const boundary=raw.lastIndexOf("\n")+1;await fs.truncate(file,boundary);raw=raw.slice(0,boundary);const h=await fs.open(file,"r+");await h.sync();await h.close();}
      const prior=await this.replay(event.sessionId,event.runId).catch(error=>{if((error as Error).message==="journal_corrupt")throw error;return [];});
      this.assertTypeKind(event);
      if(!prior.some(e=>e.type==="run_terminal")) throw Object.assign(new Error("run not terminal"),{code:"run_not_terminal"});
      const seq=prior.at(-1)?.eventSeq??0;
      const full={...event,eventSeq:seq+1,occurredAt:event.occurredAt||new Date().toISOString(),schemaVersion:1 as const};
      const fh=await fs.open(file,"a");
      try{await fh.writeFile(JSON.stringify(full)+"\n","utf8");await fh.sync();}finally{await fh.close();}
      return full;
    }));
  }
  async appendTerminal(event:Omit<RunEventEnvelope,"eventSeq"|"occurredAt"> & Partial<Pick<RunEventEnvelope,"occurredAt">>):Promise<RunEventEnvelope|null>{
    return this.serial(`${event.sessionId}/${event.runId}`,()=>this.fileLock(event.sessionId,event.runId,async()=>{const prior=await this.replay(event.sessionId,event.runId);if(prior.some(e=>e.type==="run_terminal"))return null;return await this.appendUnlocked(event);}));
  }
  async replay(sessionId:string,runId:string,after=0):Promise<RunEventEnvelope[]>{const raw=await fs.readFile(path.join(this.dir(sessionId,runId),"events.jsonl"),"utf8");const lines=raw.split("\n");if(lines.at(-1)==="")lines.pop();const out:RunEventEnvelope[]=[];let expected=1;for(let i=0;i<lines.length;i++){const line=lines[i];if(!line.trim())continue;try{const e=JSON.parse(line) as RunEventEnvelope;if(e.schemaVersion!==1||typeof e.eventSeq!=="number"||e.eventSeq!==expected)throw new Error("invalid journal sequence");expected++;if(e.eventSeq>after)out.push(e);}catch(error){if(i===lines.length-1&&!raw.endsWith("\n"))break;throw Object.assign(new Error("journal_corrupt"),{cause:error});}}return out}
  async snapshot(sessionId:string,runId:string):Promise<RunSnapshot>{return JSON.parse(await fs.readFile(path.join(this.dir(sessionId,runId),"meta.json"),"utf8")) as RunSnapshot}
  async update(snapshot:RunSnapshot):Promise<void>{await this.serial(`${snapshot.sessionId}/${snapshot.runId}`,async()=>{const d=this.dir(snapshot.sessionId,snapshot.runId),target=path.join(d,"meta.json"),tmp=`${target}.${process.pid}.${randomUUID()}.tmp`;const h=await fs.open(tmp,"w");await h.writeFile(JSON.stringify(snapshot),"utf8");await h.sync();await h.close();await fs.rename(tmp,target).catch(async e=>{await fs.rm(tmp,{force:true});throw e;});await this.syncDir(d);});}
  async listSnapshots():Promise<RunSnapshot[]>{const out:RunSnapshot[]=[];const root=path.join(this.root,"runs");let sessions:import("node:fs").Dirent[];try{sessions=await fs.readdir(root,{withFileTypes:true});}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return out;throw error;}for(const s of sessions){if(!s.isDirectory())continue;for(const r of await fs.readdir(path.join(root,s.name),{withFileTypes:true})){if(!r.isDirectory())continue;out.push(await this.snapshot(s.name,r.name));}}return out;}
}
