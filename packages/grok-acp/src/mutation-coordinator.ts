import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

type Lease={release:()=>void};
export class MutationCoordinator {
  private leases=new Map<string,string>();
  baseHash(content:string|null){return content===null?null:crypto.createHash("sha256").update(content).digest("hex");}
  async acquire(target:string,owner:string):Promise<Lease>{
    const key=process.platform==="win32"?target.toLowerCase():target;
    const prior=this.leases.get(key);
    if(prior&&prior!==owner) throw Object.assign(new Error("edit conflict"),{code:"edit_conflict"});
    const lockPath=path.join(path.dirname(target),`.grokforge-${crypto.createHash("sha256").update(target).digest("hex")}.lock`);
    let handle:fs.FileHandle|undefined;
    const deadline=Date.now()+5000;
    while(!handle){
      try { handle=await fs.open(lockPath,"wx"); await handle.writeFile(JSON.stringify({owner,pid:process.pid,createdAt:Date.now()})); }
      catch(error){
        if((error as NodeJS.ErrnoException).code!=="EEXIST"||Date.now()>=deadline) throw Object.assign(new Error("edit conflict"),{code:"edit_conflict"});
        await new Promise(r=>setTimeout(r,10));
      }
    }
    this.leases.set(key,owner); let released=false;
    return {release:()=>{if(released)return; released=true; if(this.leases.get(key)===owner)this.leases.delete(key); void handle?.close().catch(()=>{}); void fs.rm(lockPath,{force:true}).catch(()=>{});}};
  }
}
