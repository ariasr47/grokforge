import path from "node:path";
export type FixedInspection={executable:string;args:string[];label:"fixed_inspection"};
export function compileFixedInspection(input:string,platform:NodeJS.Platform=process.platform):FixedInspection|null {
  if(!input||/[&|<>$`()'"\\]|%[A-Za-z_][A-Za-z0-9_]*%/.test(input))return null;
  const t=input.trim().split(/\s+/);if(!t.length)return null;const [cmd,...a]=t;
  const absolute=(value:string)=>platform==="win32"?path.win32.isAbsolute(value):path.posix.isAbsolute(value);
  const relativePath=(value:string)=>value.length>0&&!value.startsWith("-")&&!absolute(value)&&!value.split(/[\\/]/).includes("..");
  if(cmd!=="git"&&cmd!=="rg")return null;
  if(a.some(x=>x.split(/[\\/]/).includes("..")))return null;
  if(cmd==="git"&&a[0]==="status"&&(a.length===1||(a.length===2&&a[1]==="--short")))return {executable:"git",args:a,label:"fixed_inspection"};
  if(cmd==="git"&&a[0]==="diff"){
    let i=1;if(a[i]==="--stat")i++;
    if(i===a.length)return {executable:"git",args:a,label:"fixed_inspection"};
    if(a[i]==="--"&&a.length===i+2&&relativePath(a[i+1]!))return {executable:"git",args:a,label:"fixed_inspection"};
    return null;
  }
  if(cmd==="git"&&a[0]==="log"){
    let i=1;if(a[i]==="-n"){if(!/^([1-9]|[1-9][0-9]|100)$/.test(a[i+1]??""))return null;i+=2;}
    if(a[i]==="--oneline")i++;
    return i===a.length?{executable:"git",args:a,label:"fixed_inspection"}:null;
  }
  if(cmd==="rg"&&a[0]==="--files"&&a.length===1)return {executable:"rg",args:a,label:"fixed_inspection"};
  if(cmd==="rg"&&a[0]==="-n"&&a.length>=2&&a.length<=3&&!a[1]!.startsWith("-")&&(a.length===2||relativePath(a[2]!)))return {executable:"rg",args:a,label:"fixed_inspection"};
  return null;
}
