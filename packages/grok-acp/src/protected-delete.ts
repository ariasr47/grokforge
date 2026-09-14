import path from "node:path";
// Root/home/workspace deletes stay blocked even when recursive flags are present.
export function isProtectedDelete(target:string,workspace:string,home=process.env.USERPROFILE||process.env.HOME||""){const n=(p:string)=>path.resolve(p).toLowerCase();const t=n(target);return [workspace,home,path.parse(t).root].filter(Boolean).some(x=>t===n(x))}
export function parseProtectedDelete(command:string,workspace:string){
  const tokens=[...command.trim().matchAll(/"((?:\\.|[^"])*)"|'([^']*)'|(\S+)/g)].map(m=>(m[1]??m[2]??m[3]).replace(/\\"/g,'"'));
  if(!tokens.length)return false;
  const cmd=tokens.shift()!.toLowerCase().split(/[\\/]/).pop();
  const powershell=cmd==='remove-item', unix=cmd==='rm', win=cmd==='rmdir'||cmd==='rd';
  if(!powershell&&!unix&&!win)return false;
  const flags=powershell?new Set(['-recurse','-force','-literalpath']):win?new Set(['/s','/q']):new Set(['-r','-rf','-fr','--recursive']);
  let recursive=false,target:string|undefined;
  for(let i=0;i<tokens.length;i++){const t=tokens[i], lower=t.toLowerCase();if(flags.has(lower)){if(lower==='-recurse'||lower==='/s'||lower==='-r'||lower==='-rf'||lower==='-fr'||lower==='--recursive')recursive=true;if(lower==='-literalpath'){target=tokens[++i];}continue;}if(t.startsWith('-')||t.startsWith('/'))continue;if(target!==undefined)return false;target=t;}
  return !!recursive&&!!target&&isProtectedDelete(target,workspace);
}
