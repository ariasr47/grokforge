import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
export class EditJournal {
  constructor(private readonly root:string) {}
  private file(id:string){return path.join(this.root,"edit-recovery",`${id}.json`)}
  async prepare(entry:Record<string,unknown>){const full={...entry,status:"prepared"};await fs.mkdir(path.dirname(this.file(String(entry.editId))),{recursive:true});await fs.writeFile(this.file(String(entry.editId)),JSON.stringify(full),"utf8");return full}
  async markApplied(id:string){const f=this.file(id);const e=JSON.parse(await fs.readFile(f,"utf8"));e.status="applied";await fs.writeFile(f,JSON.stringify(e),"utf8");return e}
  async revert(id:string){const f=this.file(id);const e=JSON.parse(await fs.readFile(f,"utf8"));const current=await fs.readFile(e.target,"utf8").catch(()=>null);const hash=current===null?null:crypto.createHash("sha256").update(current).digest("hex");if(hash!==e.afterHash){e.status="conflict";await fs.writeFile(f,JSON.stringify(e));return {ok:false,entry:e};}if(e.before===null)await fs.rm(e.target,{force:true});else await fs.writeFile(e.target,e.before,"utf8");e.status="reverted";await fs.writeFile(f,JSON.stringify(e));return {ok:true,entry:e};}
}
