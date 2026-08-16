import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { randomUUID } from "node:crypto";
import type { PolicySnapshot, WorkspacePolicyMode, PolicyFallbackReason, WorkspacePolicyMode as Mode } from "./run-types.js";
export type { WorkspacePolicyMode, PolicyFallbackReason } from "./run-types.js";

export type WorkspacePolicyView={status:"confirmed";workspace:string;storedMode:WorkspacePolicyMode|null;effectiveMode:WorkspacePolicyMode;source:"default"|"saved"|"fallback";revision:string;fallbackReason:PolicyFallbackReason;savedForWorkspace:boolean};
type Stored={version:1;workspace:string;mode:Mode;revision:string;savedAt:string};
export class WorkspacePolicyStore {
  constructor(private readonly dataDir:string,private readonly revisionFactory:()=>string=randomUUID){}
  private canonical(p:string){if(!path.isAbsolute(p))throw new Error("invalid_workspace");return fs.realpath(p)}
  private file(workspace:string){const key=process.platform==="win32"?workspace.toLowerCase().replaceAll("\\","/"):workspace;return path.join(this.dataDir,"workspace-policies",crypto.createHash("sha256").update(key).digest("hex")+".json")}
  async read(workspace:string):Promise<WorkspacePolicyView>{let canonical:string;try{canonical=await this.canonical(workspace);const st=await fs.stat(canonical);if(!st.isDirectory())throw new Error("invalid")}catch{throw new Error("invalid_workspace")}
    const target=this.file(canonical);let fallback:PolicyFallbackReason=null;let record:Stored|null=null;try{record=JSON.parse(await fs.readFile(target,"utf8")) as Stored;if(record?.version!==1||record.workspace!==canonical||!(["review","trusted_workspace"] as string[]).includes(record.mode)||!record.revision)fallback="invalid"}catch(e){fallback=(e as NodeJS.ErrnoException)?.code==="ENOENT"?"missing":"unreadable"}
    if(fallback||!record)return {status:"confirmed",workspace:canonical,storedMode:null,effectiveMode:"review",source:"fallback",revision:"fallback",fallbackReason:fallback||"invalid",savedForWorkspace:false};
    return {status:"confirmed",workspace:canonical,storedMode:record.mode,effectiveMode:record.mode,source:"saved",revision:record.revision,fallbackReason:null,savedForWorkspace:true};}
  async save(workspace:string,mode:Mode,expectedRevision?:string):Promise<WorkspacePolicyView>{const current=await this.read(workspace);if(expectedRevision&&current.revision!==expectedRevision)throw new Error("policy_revision_conflict");const canonical=current.workspace;const record:Stored={version:1,workspace:canonical,mode,revision:this.revisionFactory(),savedAt:new Date().toISOString()};const target=this.file(canonical);const tmp=`${target}.${process.pid}.tmp`;await fs.mkdir(path.dirname(target),{recursive:true});try{await fs.writeFile(tmp,JSON.stringify(record),"utf8");await fs.rename(tmp,target)}catch(e){await fs.rm(tmp,{force:true}).catch(()=>{});throw e}return {status:"confirmed",workspace:canonical,storedMode:mode,effectiveMode:mode,source:"saved",revision:record.revision,fallbackReason:null,savedForWorkspace:true}}
  async snapshot(workspace:string,bypassActive=false):Promise<PolicySnapshot>{const p=await this.read(workspace);return {workspace:p.workspace,storedMode:p.storedMode,effectiveMode:bypassActive?"bypass_permissions":p.effectiveMode,source:bypassActive?"session_bypass":p.source,revision:p.revision,fallbackReason:p.fallbackReason,snapshottedAt:new Date().toISOString()}}
}
