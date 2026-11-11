"use strict";
// Canonical server-helper transport for these isolated mod candidates. Each
// package carries the same file; neither imports another installed mod.
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const PROTOCOL="evejs_launcher_mod_v1";
function readJSON(file,limit=1024*1024){
  if(!fs.existsSync(file))return null;
  const info=fs.lstatSync(file);
  if(!info.isFile()||info.isSymbolicLink()||info.size>limit)throw Error("Helper JSON is not a bounded regular file");
  return JSON.parse(fs.readFileSync(file,"utf8"));
}
function contained(base,relative){
  if(typeof relative!=="string"||!relative||relative.includes("\\")||relative.includes(":")||relative.split("/").some(p=>!p||p==="."||p===".."))throw Error("Unsafe persistent relative path");
  const target=path.resolve(base,...relative.split("/"));
  if(!target.startsWith(path.resolve(base)+path.sep))throw Error("Persistent path escaped selected data root");
  let cursor=path.resolve(base);
  for(const part of relative.split("/")){
    cursor=path.join(cursor,part);
    if(fs.existsSync(cursor)&&fs.lstatSync(cursor).isSymbolicLink())throw Error("Persistent path contains a link");
  }
  return target;
}
function atomic(file,bytes){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temporary=file+"."+crypto.randomUUID()+".tmp";
  let fd;
  try{fd=fs.openSync(temporary,"wx");fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=null;fs.renameSync(temporary,file);}
  finally{if(fd!==null&&fd!==undefined)fs.closeSync(fd);if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
}
const writeJSON=(file,value)=>atomic(file,Buffer.from(JSON.stringify(value,null,2)+"\n"));
function settings(request){
  const value=request.settings;
  if(value===undefined)return {};
  const object=value=>value!==null&&typeof value==="object"&&!Array.isArray(value);
  if(!object(value))throw Error("Helper settings must be an object");
  if(Object.hasOwn(value,"global")||Object.hasOwn(value,"profile")){
    if(Object.keys(value).some(key=>!["global","profile"].includes(key))||!object(value.global||{})||!object(value.profile||{}))throw Error("Invalid global/profile helper settings envelope");
    if(Object.keys(value.profile||{}).length)throw Error("These server preferences do not accept client-profile settings");
    return {...value.global};
  }
  if(Object.keys(value).length)throw Error("Use the public settings.global/settings.profile envelope");
  return {};
}
function context(request,modRoot,actions){
  if(!request||request.protocol!==PROTOCOL||typeof request.requestId!=="string"||!request.requestId||request.requestId.length>128||!actions.includes(request.action))throw Error("Unsupported helper request or action");
  const runtime=request.runtime;
  if(process.platform!=="linux"||runtime?.backend!=="docker"||runtime.platform!=="linux"||runtime.role!=="server")throw Error("This helper requires the selected Linux Docker server context");
  for(const key of ["evejsRoot","modRoot","dataRoot"]){if(typeof runtime[key]!=="string"||!path.isAbsolute(runtime[key]))throw Error("Missing captured container "+key);}
  modRoot=fs.realpathSync(modRoot);
  if(fs.realpathSync(runtime.modRoot)!==modRoot)throw Error("Captured package root differs from this helper");
  const root=fs.realpathSync(runtime.evejsRoot),dataRoot=fs.realpathSync(runtime.dataRoot);
  if(!fs.existsSync(path.join(root,"server/package.json")))throw Error("Captured EveJS server source is unavailable");
  if(typeof runtime.targetIdentity!=="string"||!runtime.targetIdentity||runtime.targetIdentity.length>1024)throw Error("Captured target identity is required");
  if(typeof runtime.installationIdentity!=="string"||!runtime.installationIdentity||runtime.installationIdentity.length>1024)throw Error("Stable captured installation identity is required");
  const descriptor=readJSON(path.join(modRoot,"evejs-launcher.mod.json"));
  if(descriptor?.docker?.schemaVersion!==1||request.mod?.id!==descriptor.id||request.mod?.version!==descriptor.version)throw Error("Docker mod identity differs from captured package");
  const base=path.join(dataRoot,"mods");
  if(process.env.EVEJS_MOD_DATA_ROOT&&path.resolve(process.env.EVEJS_MOD_DATA_ROOT)!==base)throw Error("EVEJS_MOD_DATA_ROOT differs from the captured selected data root");
  const stateRoot=contained(base,descriptor.docker.dataDirectory);
  if(fs.existsSync(base)&&fs.lstatSync(base).isSymbolicLink())throw Error("Mod data root cannot be a symlink");
  return {root,modRoot,dataRoot,base,stateRoot,descriptor,targetIdentity:runtime.targetIdentity,installationIdentity:runtime.installationIdentity,market:runtime.market};
}
function result(request,message,extra={}){return {protocol:request.protocol,requestId:request.requestId,success:true,state:"ready",message,restartRequired:[],contributions:[],environment:{},arguments:[],...extra};}
function run(execute){
  let bytes=0,parts=[];
  process.stdin.on("data",chunk=>{bytes+=chunk.length;if(bytes>1024*1024){process.stdin.destroy(Error("Helper request exceeds one MiB"));return;}parts.push(chunk);});
  let request={protocol:PROTOCOL,requestId:"invalid"},written=false;
  const finish=value=>{if(written)return;written=true;process.stdout.write("EVEJS_MOD_HELPER_RESULT="+JSON.stringify(value)+"\n");if(!value.success)process.exitCode=1;};
  const fail=error=>finish(result(request,String(error.message||error).replace(/[\x00-\x20\x7f]+/g," ").slice(0,4000),{success:false,state:"failed"}));
  process.stdin.on("error",fail);
  process.stdin.on("end",()=>Promise.resolve().then(()=>{request=JSON.parse(Buffer.concat(parts).toString("utf8"));return execute(request);}).then(finish,fail));
}
module.exports={PROTOCOL,readJSON,contained,atomic,writeJSON,settings,context,result,run};
