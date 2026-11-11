"use strict";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),h=require("./helper-v1.cjs");
const ACTIONS=["install","verify","prepare_profile","prepare_server_start","prepare_disable","prepare_remove","recover","prepare_update","apply_update","commit_update","rollback_update"];
const sha=bytes=>crypto.createHash("sha256").update(bytes).digest("hex");
const hashFile=file=>fs.existsSync(file)?sha(fs.readFileSync(file)):null;
const ABI="npc-market-buyers-native-settlement-v1";
const financial=require("./financial-identity.cjs");
function sourceIdentity(modRoot){
  const identity=h.readJSON(path.join(modRoot,"docker/linux-source-identity.json"));
  if(identity?.schemaVersion!==1||identity.settlementABI!==ABI||identity.targetOS!=="linux"||identity.targetArchitecture!=="amd64")throw Error("Unsupported Linux market source/ABI contract");
  const hashes={};
  const sourceRoot=path.join(modRoot,"native/market-server"),actual=[];
  const walk=directory=>{for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
    const file=path.join(directory,entry.name);
    if(entry.isSymbolicLink())throw Error("Linux source contribution contains a link");
    if(entry.isDirectory())walk(file);else if(entry.isFile())actual.push(path.relative(sourceRoot,file).split(path.sep).join("/"));
    else throw Error("Linux source contribution contains a nonregular file");
  }};
  walk(sourceRoot);
  if(JSON.stringify(actual.sort())!==JSON.stringify(Object.keys(identity.files).sort()))throw Error("Linux market source inventory changed");
  for(const file of Object.keys(identity.files).sort()){
    hashes[file]=hashFile(h.contained(path.join(modRoot,"native/market-server"),file));
    if(hashes[file]!==identity.files[file])throw Error("Linux market source changed: "+file);
  }
  if(sha(JSON.stringify(hashes))!==identity.sourceSHA256)throw Error("Linux source identity manifest differs");
  return identity;
}
function inspectDatabase(ctx,{blockPending=false}={}){
  const file=h.contained(ctx.stateRoot,"state.sqlite");
  if(!fs.existsSync(file))return;
  require("../lib/activeUpdate").checkSchema(ctx.root,(_root,relative)=>{
    if(relative!=="_local/npc-market-buyers/state.sqlite")throw Error("Unexpected settlement validator path");
    return file;
  });
  const Database=require(path.join(ctx.root,"server/node_modules/better-sqlite3"));
  const db=new Database(file,{readonly:true,fileMustExist:true});
  try{
    db.pragma("query_only=ON");
    if(db.pragma("user_version",{simple:true})!==0)throw Error("Unsupported NPC settlement schema version");
    for(const table of ["nm_operations","nm_native_ops","nm_native_outbox","nm_orphan_recovery","nm_wallet_intents"]){
      if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))continue;
      if(!db.prepare(`PRAGMA table_info(${table})`).all().some(row=>row.name==="state"))throw Error("Unsupported NPC settlement table: "+table);
      if(blockPending&&db.prepare(`SELECT 1 FROM ${table} WHERE state='pending' LIMIT 1`).get())throw Error("NPC market settlement needs recovery before disabling. Start the enabled mod and finish recovery first.");
    }
  }finally{db.close();}
}
function stateFingerprint(ctx){
  const file=h.contained(ctx.stateRoot,"state.sqlite");
  return sha(JSON.stringify([hashFile(file),hashFile(file+"-wal")]));
}
function checkReceipt(receipt,ctx){
  if(!receipt||receipt.schemaVersion!==1||receipt.modId!==ctx.descriptor.id||receipt.installationIdentity!==ctx.installationIdentity||receipt.settlementABI!==ABI||!financial.knownFingerprints().includes(receipt.financialSourceSHA256)||!["enabled","disabled"].includes(receipt.state))throw Error("Unknown Docker installation receipt, financial ABI or selected installation");
}
function receiptFor(ctx,identity,state="enabled"){return {schemaVersion:1,modId:ctx.descriptor.id,version:ctx.descriptor.version,installationIdentity:ctx.installationIdentity,
  state,settlementABI:ABI,sourceSHA256:identity.sourceSHA256,financialSourceSHA256:financial.identity(ctx.modRoot,{currentPackage:true})};}
async function execute(request,{modRoot=path.resolve(__dirname,"..")}={}){
  const ctx=h.context(request,modRoot,ACTIONS),identity=sourceIdentity(modRoot);
  financial.identity(modRoot,{currentPackage:true});
  const version=h.readJSON(path.join(ctx.root,"server/package.json"))?.version;
  if(version!=="261108.1")throw Error("This Docker port is qualified only for EveJS 261108.1; Native compatibility is unchanged");
  if(process.arch!=="x64")throw Error("This Linux market source contribution is qualified only for amd64");
  require("../lib/loginDelivery").createDelivery(modRoot);
  inspectDatabase(ctx);
  const receiptFile=h.contained(ctx.stateRoot,"install/docker-receipt.json"),journalFile=h.contained(ctx.stateRoot,"install/docker-update.json");
  const receipt=h.readJSON(receiptFile);let journal=h.readJSON(journalFile);
  if(receipt)checkReceipt(receipt,ctx);
  const updateAction=request.action.endsWith("_update");
  if(updateAction){
    const update=request.update;
    if(!update||update.protocol!=="evejs-mod-enabled-update-v1"||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(update.transactionId||"")||update.toVersion!==ctx.descriptor.version||typeof update.fromVersion!=="string")throw Error("Invalid Docker enabled-update context");
    const expected={transactionId:update.transactionId,installationIdentity:ctx.installationIdentity,fromVersion:update.fromVersion,toVersion:update.toVersion};
    const validateJournal=()=>{
      if(!journal||journal.schemaVersion!==1||JSON.stringify(journal.context)!==JSON.stringify(expected)||!["prepared","applied","committed","rolled_back"].includes(journal.state)||sha(Buffer.from(journal.beforeReceipt,"base64"))!==journal.beforeSHA||sha(Buffer.from(journal.afterReceipt,"base64"))!==journal.afterSHA)throw Error("Missing or incompatible Docker update journal");
      checkReceipt(JSON.parse(Buffer.from(journal.beforeReceipt,"base64").toString()),ctx);
      const after=JSON.parse(Buffer.from(journal.afterReceipt,"base64").toString());
      if(JSON.stringify(after)!==JSON.stringify(receiptFor(ctx,identity)))throw Error("Docker update planned receipt differs from package");
      if(stateFingerprint(ctx)!==journal.stateFingerprint)throw Error("NPC settlement data changed during stopped Docker update");
    };
    if(request.action==="prepare_update"){
      if(typeof update.fromModRoot!=="string"||!path.isAbsolute(update.fromModRoot))throw Error("Captured predecessor package root is required");
      const oldRoot=fs.realpathSync(update.fromModRoot),modsRoot=path.join(ctx.root,"mods"),relative=path.relative(modsRoot,oldRoot);
      if(!relative||relative.startsWith("..")||path.isAbsolute(relative)||relative.split(path.sep).length!==1)throw Error("Predecessor package is outside the captured direct mods root");
      const old=h.readJSON(path.join(oldRoot,"evejs-launcher.mod.json")),pkg=h.readJSON(path.join(oldRoot,"package.json"));
      if(old?.id!==ctx.descriptor.id||old.version!==update.fromVersion||pkg?.version!==old.version||old.kind!=="loader"||old.activation?.strategy!=="loader_rename"||!fs.existsSync(path.join(oldRoot,"loader.js"))||fs.existsSync(path.join(oldRoot,"loader.js.disabled")))throw Error("Previous enabled Docker package provenance differs from captured update");
      const predecessor=financial.identity(oldRoot,{version:update.fromVersion});
      if(receipt?.financialSourceSHA256!==predecessor)throw Error("Predecessor financial ABI differs from installed Docker receipt");
      if(journal&&["committed","rolled_back"].includes(journal.state)&&journal.context?.transactionId!==update.transactionId){
        if(journal.context?.installationIdentity!==ctx.installationIdentity)throw Error("Previous Docker update belongs to another installation");
        h.writeJSON(h.contained(ctx.stateRoot,"install/docker-update.previous.json"),journal);journal=null;
      }
      if(journal){validateJournal();return h.result(request,"Existing Docker update intent retained; pending settlement data untouched.");}
      if(!receipt||receipt.state!=="enabled"||receipt.version!==update.fromVersion)throw Error("Enabled source receipt does not match Docker update");
      const before=fs.readFileSync(receiptFile),after=Buffer.from(JSON.stringify(receiptFor(ctx,identity),null,2)+"\n");
      h.writeJSON(journalFile,{schemaVersion:1,context:expected,state:"prepared",beforeReceipt:before.toString("base64"),beforeSHA:sha(before),afterReceipt:after.toString("base64"),afterSHA:sha(after),stateFingerprint:stateFingerprint(ctx)});
      return h.result(request,"Docker update prepared; pending financial state retained exactly.");
    }
    validateJournal();
    const current=hashFile(receiptFile);
    if(![journal.beforeSHA,journal.afterSHA].includes(current))throw Error("Docker receipt changed outside this update");
    if(request.action==="apply_update"){
      if(journal.state==="rolled_back")throw Error("Docker update was rolled back");
      if(journal.state==="committed")return h.result(request,"Docker update already committed.");
      h.atomic(receiptFile,Buffer.from(journal.afterReceipt,"base64"));journal.state="applied";
    }else if(request.action==="commit_update"){
      if(!["applied","committed"].includes(journal.state)||current!==journal.afterSHA)throw Error("Apply the Docker update before commit");
      journal.state="committed";
    }else{
      if(journal.state==="committed")throw Error("Committed Docker update cannot be rolled back by an unrelated phase");
      h.atomic(receiptFile,Buffer.from(journal.beforeReceipt,"base64"));journal.state="rolled_back";
    }
    h.writeJSON(journalFile,journal);
    return h.result(request,"Docker update "+journal.state+"; financial database bytes preserved.");
  }
  if(journal&&!["committed","rolled_back"].includes(journal.state))return h.result(request,"Resume the captured Launcher image/update transaction before another lifecycle action.",{success:false,state:"recovery-required"});
  if(["prepare_disable","prepare_remove"].includes(request.action)){
    inspectDatabase(ctx,{blockPending:true});
    if(receipt)h.writeJSON(receiptFile,{...receipt,state:"disabled"});
    return h.result(request,"Docker buying disabled; settings, history and all recovery receipts retained. Launcher owns image removal.");
  }
  if(request.action==="verify"){
    if(!receipt||receipt.state!=="enabled"||receipt.sourceSHA256!==identity.sourceSHA256||receipt.version!==ctx.descriptor.version)throw Error("Install or recover the matching Docker market contribution first");
    return h.result(request,"Docker package/source and persistent receipts verified. Launcher image attestation and live daemon readiness are separate checks.");
  }
  if(request.action==="recover"&&receipt?.state==="disabled")return h.result(request,"Docker contribution is disabled. Enable it explicitly; persistent records are retained.");
  if(request.action==="prepare_server_start"&&(!receipt||receipt.state!=="enabled"))throw Error("Install and enable the Docker contribution before starting the server");
  const supplied=h.settings(request);
  if(Object.keys(supplied).length){
    const {createStore}=require("../lib/store"),store=createStore(h.contained(ctx.stateRoot,"state.sqlite"),{root:ctx.root});
    try{store.saveConfig({...store.getConfig(),...supplied},store.getRevision());}finally{store.db.close();}
  }
  if(request.action==="prepare_server_start")await require("./market-authority.cjs").prepare(ctx,identity);
  h.writeJSON(receiptFile,receiptFor(ctx,identity));
  return h.result(request,"Docker NPC market package and persistent state prepared; no financial rows were cleared. Launcher owns the captured image transaction.");
}
module.exports={execute,ACTIONS,sourceIdentity,inspectDatabase,stateFingerprint};
