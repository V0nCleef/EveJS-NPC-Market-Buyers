"use strict";
const fs=require("node:fs"),path=require("node:path"),net=require("node:net"),crypto=require("node:crypto"),dns=require("node:dns/promises");
const h=require("./helper-v1.cjs");
function endpoint(){
  const host=String(process.env.EVEJS_MARKET_DAEMON_HOST||"market"),port=Number(process.env.EVEJS_MARKET_DAEMON_PORT||40111);
  if(!/^[a-zA-Z0-9_.:-]{1,253}$/.test(host)||["0.0.0.0","::","::0"].includes(host)||!Number.isInteger(port)||port<1||port>65535)throw Error("Invalid selected Docker market endpoint");
  return {host,port};
}
function health(endpoint){return new Promise((resolve,reject)=>{
  const id=crypto.randomUUID(),socket=net.connect(endpoint),chunks=[];let bytes=0,done=false;
  const finish=(error,value)=>{if(done)return;done=true;socket.destroy();error?reject(error):resolve(value);};
  socket.setTimeout(3000,()=>finish(Error("Selected Docker market readiness timed out")));
  socket.once("error",error=>finish(error));socket.once("end",()=>finish(Error("Selected Docker market closed before its health reply")));
  socket.once("connect",()=>socket.write(JSON.stringify({id,method:"Health",params:{}})+"\n"));
  socket.on("data",chunk=>{bytes+=chunk.length;if(bytes>65536)return finish(Error("Docker market health reply exceeds limit"));chunks.push(chunk);
    const data=Buffer.concat(chunks),end=data.indexOf(10);if(end<0)return;
    try{const response=JSON.parse(data.subarray(0,end).toString());if(response.id!==id||response.ok!==true)throw Error("Docker market health ownership failed");finish(null,{health:response.result,remoteAddress:socket.remoteAddress});}catch(error){finish(error);}
  });
});}
function physicalDatabase(dataRoot,health){
  if(health?.status!=="ok"||!["idempotent-fill-v1","conditional-fill-v1"].every(value=>health.capabilities?.includes(value)))throw Error("Matching conditional/idempotent market capability is unavailable");
  if(typeof health.database_path!=="string"||health.database_path.length>4096||!path.isAbsolute(health.database_path))throw Error("Docker market must advertise its absolute mounted database path");
  const root=fs.realpathSync(dataRoot),file=fs.realpathSync(health.database_path);
  if(!file.startsWith(root+path.sep)||!fs.statSync(file).isFile())throw Error("Docker market database is outside selected mounted data root");
  return file;
}
async function prepare(ctx,identity){
  const market=ctx.market;
  if(!market||!/^sha256:[a-f0-9]{64}$/.test(market.imageId||"")||market.imageId!==market.expectedImageId)throw Error("Captured selected market image attestation is missing or mismatched");
  h.writeJSON(h.contained(ctx.stateRoot,"install/docker-runtime-intent.json"),{schemaVersion:1,preparationId:crypto.randomUUID(),targetIdentity:ctx.targetIdentity,installationIdentity:ctx.installationIdentity,marketImageId:market.imageId,root:ctx.root,modRoot:ctx.modRoot,
    dataRoot:ctx.dataRoot,stateRoot:fs.realpathSync(ctx.stateRoot),sourceSHA256:identity.sourceSHA256,endpoint:endpoint()});
}
function prepared(root,modRoot){
  const stateRoot=require("../lib/statePaths").stateRoot(root),intent=h.readJSON(h.contained(stateRoot,"install/docker-runtime-intent.json"));
  const identity=require("./server-lifecycle.cjs").sourceIdentity(modRoot),receipt=h.readJSON(h.contained(stateRoot,"install/docker-receipt.json"));
  if(intent?.schemaVersion!==1||typeof intent.preparationId!=="string"||!intent.preparationId||typeof intent.targetIdentity!=="string"||!intent.targetIdentity||!/^sha256:[a-f0-9]{64}$/.test(intent.marketImageId||"")||intent.root!==fs.realpathSync(root)||intent.modRoot!==fs.realpathSync(modRoot)||intent.stateRoot!==fs.realpathSync(stateRoot)||intent.sourceSHA256!==identity.sourceSHA256||receipt?.installationIdentity!==intent.installationIdentity||receipt?.state!=="enabled"||receipt?.sourceSHA256!==identity.sourceSHA256||JSON.stringify(intent.endpoint)!==JSON.stringify(endpoint()))throw Error("Fresh selected-target Docker runtime preparation is unavailable");
  return {stateRoot,intent,identity};
}
async function activate(root,modRoot){
  const {stateRoot,intent}=prepared(root,modRoot),response=await health(intent.endpoint),databasePath=physicalDatabase(intent.dataRoot,response.health);
  h.writeJSON(h.contained(stateRoot,"install/docker-runtime.json"),{...intent,databasePath});
  return true;
}
async function validate({root,status,health,remoteAddress,modRoot}){
  const {stateRoot,intent,identity}=prepared(root,modRoot),proof=h.readJSON(h.contained(stateRoot,"install/docker-runtime.json"));
  const receipt=h.readJSON(h.contained(stateRoot,"install/docker-receipt.json"));
  if(receipt?.installationIdentity!==proof?.installationIdentity||receipt?.state!=="enabled"||receipt?.sourceSHA256!==identity.sourceSHA256)throw Error("Docker authority proof does not match the enabled installation receipt");
  if(proof?.schemaVersion!==1||proof.preparationId!==intent.preparationId||proof.targetIdentity!==intent.targetIdentity||proof.installationIdentity!==intent.installationIdentity||proof.marketImageId!==intent.marketImageId||proof.dataRoot!==intent.dataRoot||proof.root!==fs.realpathSync(root)||proof.modRoot!==fs.realpathSync(modRoot)||proof.stateRoot!==fs.realpathSync(stateRoot)||proof.sourceSHA256!==identity.sourceSHA256)throw Error("Fresh selected-target Docker market authority proof is missing");
  if(proof.endpoint?.host!==status.host||proof.endpoint?.port!==status.port||JSON.stringify(endpoint())!==JSON.stringify(proof.endpoint))throw Error("Docker market endpoint differs from prepared selected target");
  const file=physicalDatabase(proof.dataRoot,health);
  if(file!==proof.databasePath)throw Error("Docker market database differs from prepared selected target");
  if(!remoteAddress)throw Error("Docker market socket peer is unavailable");
  const addresses=(await dns.lookup(proof.endpoint.host,{all:true})).map(row=>row.address.replace(/^::ffff:/,""));
  if(!addresses.includes(remoteAddress.replace(/^::ffff:/,"")))throw Error("Docker market socket is not the prepared service peer");
  return file;
}
module.exports={endpoint,health,physicalDatabase,prepare,activate,validate};
