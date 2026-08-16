import crypto from "node:crypto";
type Lease={path:string;owner:string;release:()=>void};
export class MutationCoordinator { private leases=new Map<string,Lease>();
  async acquire(target:string,owner:string):Promise<Lease>{const key=process.platform==="win32"?target.toLowerCase():target;const prior=this.leases.get(key);if(prior&&prior.owner!==owner)throw Object.assign(new Error("edit conflict"),{code:"edit_conflict"});let released=false;const lease={path:target,owner,release:()=>{if(!released){released=true;if(this.leases.get(key)===lease)this.leases.delete(key)}}};this.leases.set(key,lease);return lease}
  baseHash(content:string|null){return content===null?null:crypto.createHash("sha256").update(content).digest("hex")}
}
