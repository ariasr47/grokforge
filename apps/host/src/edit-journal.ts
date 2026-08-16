import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export type EditJournalEntry={editId:string;workspace:string;target:string;before:string|null;beforeHash:string|null;afterHash:string;diff:string;runId:string;invocationId:string;policy:unknown;status:"prepared"|"applied"|"reverted"|"conflict"};
export class EditJournal {
  constructor(private readonly root:string){}
  private file(id:string){return path.join(this.root,"edit-recovery",`${id}.json`)}
  async prepare(entry:Omit<EditJournalEntry,"status">){const full={...entry,status:"prepared" as const};await fs.mkdir(path.dirname(this.file(entry.editId)),{recursive:true});await fs.writeFile(this.file(entry.editId),JSON.stringify(full),"utf8");return full}
  async markApplied(id:string){const e=await this.get(id);e.status="applied";await fs.writeFile(this.file(id),JSON.stringify(e),"utf8");return e}
  async get(id:string){return JSON.parse(await fs.readFile(this.file(id),"utf8")) as EditJournalEntry}
  async revert(id:string, ownership?:{runId:string}){
    const e=await this.get(id);
    // Ownership is checked from the durable record before even reading the
    // target.  The caller's run/session validation belongs to the HTTP layer,
    // while this guard keeps a mismatched edit from reaching any filesystem
    // effect if the journal is used through another path.
    if (ownership && e.runId !== ownership.runId) {
      throw Object.assign(new Error("edit is owned by another run"), { code:"recovery_not_owned", entry:e });
    }
    const current=await fs.readFile(e.target,"utf8").catch(()=>null);const hash=current===null?null:crypto.createHash("sha256").update(current).digest("hex");if(hash!==e.afterHash){e.status="conflict";await fs.writeFile(this.file(id),JSON.stringify(e),"utf8");return {ok:false,entry:e}}if(e.before===null)await fs.rm(e.target,{force:true});else await fs.writeFile(e.target,e.before,"utf8");e.status="reverted";await fs.writeFile(this.file(id),JSON.stringify(e),"utf8");return {ok:true,entry:e}}
}
