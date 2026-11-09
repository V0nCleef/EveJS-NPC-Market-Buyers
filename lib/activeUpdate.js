'use strict';
// This is an enabled -> enabled file transaction, never financial recovery.
// The Launcher owns its lease, package journal and final commit decision.
const fs=require('node:fs'),path=require('node:path');
const PROTOCOL='evejs-mod-enabled-update-v1';
const COMPATIBILITY='npc-market-buyers-native-settlement-v1';
const FROM=['0.1.20','0.1.21','0.1.22'];
const ACTIONS=['prepare_update','apply_update','commit_update','rollback_update'];
const FINANCIAL=['engine.js','settlement.js','marketAdapter.js','statistics.js','store.js','walletBatching.js'];
const financialABI=require('./financialAbiIdentities.json');
const COLUMNS={
  nm_operations:'operation_key cycle_id group_key day seller_id type_id quantity cost_cents state order_json result_json created_at updated_at activity_at offline_purchase',
  nm_native_ops:'operation_key fingerprint state order_json quantity saga_json result_json updated_at',
  nm_native_outbox:'operation_key payload state',nm_funding:'operation_key day amount_cents state',
  nm_wallet_intents:'operation_key owner_id is_corp state',
  nm_orphan_recovery:'operation_key schema plan_json plan_sha progress_json state updated_at',
};
const INTEGERS=new Set('seller_id type_id quantity cost_cents created_at updated_at activity_at offline_purchase amount_cents owner_id is_corp schema'.split(' '));
const validSHA=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  return value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
}
function same(a,b){return JSON.stringify(canonical(a))===JSON.stringify(canonical(b));}
function checkSchema(root,contained,{Database}={}){
  const filename=contained(root,'_local/npc-market-buyers/state.sqlite');if(!fs.existsSync(filename))return;
  Database=Database||require(path.join(root,'server/node_modules/better-sqlite3'));
  const db=new Database(filename,{readonly:true,fileMustExist:true});
  try{
    db.pragma('query_only=ON');
    if(db.pragma('user_version',{simple:true})!==0)throw Error('Unrecognized NPC settlement schema version; use normal recovery before updating');
    for(const [table,columns] of Object.entries(COLUMNS)){
      if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))continue;
      const info=db.prepare(`PRAGMA table_info(${table})`).all();
      const actual=info.map(row=>row.name).sort();
      if(!same(actual,columns.split(' ').sort()))throw Error('Incompatible NPC settlement columns: '+table);
      if(info.some(row=>row.type.toUpperCase()!==(INTEGERS.has(row.name)?'INTEGER':'TEXT')))throw Error('Incompatible NPC settlement column types: '+table);
    }
  }finally{db.close();}
}
async function executeUpdate(request,ctx,result,s){
  const {ALLOWED,read,json,atomic,contained,fileSHA,validateReceipt,verifyFiles,inspect,installNative,finish,inactive}=s;
  const update=request.update,own=read(path.join(ctx.modRoot,'evejs-launcher.mod.json'));
  if(!update||update.protocol!==PROTOCOL||!FROM.includes(update.fromVersion)||update.toVersion!==own?.version||
    own?.id!=='npc-market-buyers'||own.version!==require('../package.json').version||
    own.launcherApi?.enabledUpdate?.protocol!==PROTOCOL||own.launcherApi.enabledUpdate.compatibility!==COMPATIBILITY||
    !own.launcherApi.enabledUpdate.fromVersions?.includes(update.fromVersion)||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(update.transactionId||'')||
    typeof update.fromModRoot!=='string')throw Error('Invalid enabled NPC update contract');
  await inactive(ctx.root);
  const journalFile=contained(ctx.folder,'active-update.json');
  const backupDir='update-backup/'+update.transactionId;
  const expectedContext={protocol:PROTOCOL,transactionId:update.transactionId,root:ctx.root,
    fromVersion:update.fromVersion,toVersion:update.toVersion,fromModRoot:path.resolve(update.fromModRoot)};
  const load=()=>{
    const journal=read(journalFile);
    if(!journal||journal.schema!==1||!same(journal.context,expectedContext)||
      !['prepared','applying','applied','committed','rolled_back'].includes(journal.state)||journal.files?.length!==ALLOWED.length||
      journal.receiptBackup!==backupDir+'/receipt.bin'||!validSHA(journal.receiptSHA)||journal.originalBackupPaths?.length!==ALLOWED.length||
      (['applied','committed'].includes(journal.state)&&!validSHA(journal.appliedReceiptSHA)))throw Error('Missing or incompatible enabled NPC update journal');
    for(const [i,file]of journal.files.entries())if(file.target!==ALLOWED[i]||file.backup!==backupDir+`/${i}.bin`||typeof file.existed!=='boolean'||(file.existed?!validSHA(file.sha256):i!==0||file.sha256!==null))throw Error('Invalid enabled NPC update backup path');
    if(!['committed','rolled_back'].includes(journal.state)){
      if(fileSHA(contained(ctx.folder,journal.receiptBackup))!==journal.receiptSHA)throw Error('Enabled NPC update receipt backup changed');
      for(const file of journal.files)if(fileSHA(contained(ctx.folder,file.backup))!==file.sha256)throw Error('Enabled NPC update native backup changed');
    }
    return journal;
  };
  const save=journal=>json(journalFile,journal);
  const normalizedReceipt=receipt=>{
    receipt=JSON.parse(JSON.stringify(receipt));validateReceipt(ctx,receipt);
    receipt.schema=3;receipt.version=own.version;receipt.state='active';delete receipt.updatedAt;
    receipt.files.forEach((file,i)=>file.installedSHA=ctx.payloadSHA[i]);return receipt;
  };
  const beforeReceipt=journal=>JSON.parse(fs.readFileSync(contained(ctx.folder,journal.receiptBackup),'utf8'));
  function ownedReceipt(journal,receipt){return same(normalizedReceipt(journal.plannedReceipt||beforeReceipt(journal)),normalizedReceipt(receipt));}
  function ownedPending(journal){
    const pending=read(ctx.pendingFile);if(!pending)return null;
    if(pending.desired!=='active'||!ownedReceipt(journal,pending.receipt)||pending.beforeSHA?.length!==ALLOWED.length||
      pending.beforeSHA.some((value,i)=>![journal.files[i].sha256,ctx.payloadSHA[i]].includes(value)))throw Error('Unrelated native installation intent blocks enabled NPC update recovery');
    return pending;
  }
  function checkCurrent(journal){
    for(const [i,file]of journal.files.entries())if(![file.sha256,ctx.payloadSHA[i]].includes(fileSHA(contained(ctx.root,file.target))))throw Error('Native file changed during enabled NPC update: '+file.target);
    const receipt=read(ctx.receiptFile);
    if(fileSHA(ctx.receiptFile)!==journal.receiptSHA&&(!receipt||!ownedReceipt(journal,receipt)||receipt.version!==own.version||receipt.state!=='active'))throw Error('Native receipt changed during enabled NPC update');
    if(journal.state==='applied'&&fileSHA(ctx.receiptFile)!==journal.appliedReceiptSHA)throw Error('Applied native receipt changed during enabled NPC update');
    ownedPending(journal);
  }
  function terminalExpected(journal){
    if(!['committed','rolled_back'].includes(journal.state))throw Error('Enabled NPC update is not terminal');
    const receiptSHA=journal.state==='committed'?journal.appliedReceiptSHA:journal.receiptSHA;
    const files=ALLOWED.map((target,i)=>({target,sha256:journal.state==='committed'?ctx.payloadSHA[i]:journal.files[i].sha256}));
    if(!validSHA(receiptSHA)||files.some((file,i)=>!validSHA(file.sha256)&&!(i===0&&file.sha256===null))||
      receiptSHA!==fileSHA(ctx.receiptFile)||files.some(file=>file.sha256!==fileSHA(contained(ctx.root,file.target)))||fs.existsSync(ctx.pendingFile))throw Error('Terminal enabled NPC update files or receipt changed; preserve changes before recovery');
    return {receiptSHA,files};
  }
  function cleanup(journal){
    // Exact files only; do not recurse through an update folder or touch the
    // native uninstall originals, any financial journal, or any other UUID.
    const expected=terminalExpected(journal);
    const unused=[];
    if(journal.state==='rolled_back'&&journal.plannedReceipt){
      const oldBackups=journal.originalBackupPaths;
      for(const [i,file]of journal.plannedReceipt.files.entries()){
        if(file.target!==ALLOWED[i]||!new RegExp(`^backup/[a-f0-9-]{36}/${i}\\.bin$`).test(file.backup)||oldBackups.includes(file.backup))throw Error('Invalid unused rebase backup path');
        const target=contained(ctx.folder,file.backup),actual=fileSHA(target);
        if(actual!==null&&actual!==file.baseSHA)throw Error('Unused native rebase backup changed; preserve it before cleanup');
        if(actual!==null)unused.push(target);
      }
    }
    json(contained(ctx.folder,'last-update.json'),{schema:1,context:expectedContext,state:journal.state,upstreamId:journal.upstreamId||null,...expected});
    for(const file of unused)fs.unlinkSync(file);
    if(journal.state==='rolled_back'&&journal.plannedReceipt){
      const directory=path.dirname(contained(ctx.folder,journal.plannedReceipt.files[0].backup));if(fs.existsSync(directory))fs.rmdirSync(directory);
    }
    for(const relative of [...journal.files.map(file=>file.backup),journal.receiptBackup]){
      const file=contained(ctx.folder,relative);if(fs.existsSync(file))fs.unlinkSync(file);
    }
    const directory=path.join(ctx.folder,backupDir);if(fs.existsSync(directory))fs.rmdirSync(directory);
    fs.unlinkSync(journalFile);
  }
  if(request.action==='prepare_update'){
    if(fs.existsSync(journalFile)){const journal=load();if(['committed','rolled_back'].includes(journal.state))throw Error('Finish the completed enabled NPC update before another preparation');checkCurrent(journal);return result;}
    if(fs.existsSync(ctx.pendingFile))throw Error('Recover the native installation transaction before an enabled NPC update');
    const oldRoot=fs.realpathSync(update.fromModRoot),modsRoot=fs.realpathSync(path.join(ctx.root,'mods'));
    if(!oldRoot.toLowerCase().startsWith((modsRoot+path.sep).toLowerCase())||oldRoot.toLowerCase()!==path.resolve(update.fromModRoot).toLowerCase())throw Error('Previous NPC package is outside the selected mod directory or follows a junction');
    const old=read(contained(oldRoot,'evejs-launcher.mod.json')),pkg=read(contained(oldRoot,'package.json'));
    if(old?.id!==own.id||old.version!==update.fromVersion||pkg?.version!==old.version||
      old.kind!=='loader'||old.activation?.strategy!=='loader_rename'||
      old.updates?.repository!=='V0nCleef/EveJS-NPC-Market-Buyers'||
      !fs.existsSync(contained(oldRoot,'loader.js'))||fs.existsSync(contained(oldRoot,'loader.js.disabled')))throw Error('Previous enabled NPC package provenance does not match the update');
    const predecessor=financialABI.schema===1&&financialABI.protocol===COMPATIBILITY&&financialABI.predecessors.find(entry=>entry.versions.includes(update.fromVersion));
    if(!predecessor)throw Error('NPC financial protocol changed; no reviewed predecessor ABI');
    for(const file of FINANCIAL)if(fileSHA(contained(oldRoot,'lib/'+file))!==predecessor.files[file])throw Error('NPC financial protocol changed; unrecognized predecessor source: '+file);
    const receipt=read(ctx.receiptFile);if(receipt?.state!=='active')throw Error('An enabled NPC update requires active native support');
    validateReceipt(ctx,receipt);const status=inspect(ctx,receipt);
    const oldPayload=read(contained(oldRoot,'payload/native.json'));
    if(oldPayload?.files?.length!==ALLOWED.length)throw Error('Previous native payload manifest is missing');
    for(const [i,file]of oldPayload.files.entries())if(file.target!==ALLOWED[i]||file.payload!==`native/${i}.bin`)throw Error('Previous native payload paths are unrecognized');
    const oldHashes=oldPayload.files.map(file=>fileSHA(contained(oldRoot,'payload/'+file.payload)));
    const known=[ctx.payloadSHA,...s.identities.legacyPayloads.map(entry=>entry.sha256)];
    if(!known.some(hashes=>same(hashes,oldHashes)))throw Error('Previous package native payload is not recognized');
    if(status.upstream){
      if(![null,oldHashes[0],status.upstream.sha256[0]].includes(status.current[0]))throw Error('Unrecognized executable beside the official upstream native sources');
    }else if(!same(oldHashes,status.current))throw Error('Previous enabled native payload does not match the installed files');
    checkSchema(ctx.root,contained,s);
    const files=ALLOWED.map((target,i)=>({target,backup:backupDir+`/${i}.bin`,existed:status.current[i]!==null,sha256:status.current[i]}));
    const rawReceipt=fs.readFileSync(ctx.receiptFile),bytes=files.map(file=>file.existed?fs.readFileSync(contained(ctx.root,file.target)):null);
    // Durable snapshots precede the journal. An incomplete preparation cannot
    // have changed any native file and can be retried with the same UUID.
    for(const [i,file]of files.entries())if(file.existed)atomic(contained(ctx.folder,file.backup),bytes[i]);
    atomic(contained(ctx.folder,backupDir+'/receipt.bin'),rawReceipt);
    save({schema:1,context:expectedContext,state:'prepared',upstreamId:status.upstream?.id||null,originalBackupPaths:receipt.files.map(file=>file.backup),files,receiptBackup:backupDir+'/receipt.bin',receiptSHA:fileSHA(ctx.receiptFile)});
    result.message='Enabled NPC update prepared; pending settlements and native support retained.';return result;
  }
  if(!fs.existsSync(journalFile)&&['commit_update','rollback_update'].includes(request.action)){
    const terminal=read(contained(ctx.folder,'last-update.json')),wanted=request.action==='commit_update'?'committed':'rolled_back';
    const known=[ctx.payloadSHA,...s.identities.legacyPayloads.map(entry=>entry.sha256)],hashes=terminal?.files?.map(file=>file.sha256);
    const upstream=s.identities.baselines.find(item=>item.id===terminal?.upstreamId);
    const recognized=known.some(values=>same(values,hashes))||(upstream&&upstream.sha256.slice(1).every((value,i)=>value===hashes?.[i+1])&&
      [null,upstream.sha256[0],...known.map(values=>values[0])].includes(hashes?.[0]));
    const receipt=read(ctx.receiptFile);
    if(terminal?.schema!==1||!same(terminal.context,expectedContext)||terminal.state!==wanted||
      !validSHA(terminal.receiptSHA)||!recognized||
      (wanted==='committed'&&!same(ctx.payloadSHA,terminal.files?.map(file=>file.sha256)))||
      receipt?.state!=='active'||(wanted==='committed'?receipt.version!==own.version:receipt.version===own.version)||
      terminal.receiptSHA!==fileSHA(ctx.receiptFile)||terminal.files?.length!==ALLOWED.length||
      terminal.files.some((file,i)=>file.target!==ALLOWED[i]||file.sha256!==fileSHA(contained(ctx.root,file.target)))||
      fs.existsSync(ctx.pendingFile))throw Error('No matching completed enabled NPC update receipt');
    validateReceipt(ctx,receipt);
    return result;
  }
  const journal=load();
  if(request.action==='rollback_update'){
    if(journal.state==='committed')throw Error('Enabled NPC update is durably committed; finish commit recovery');
    if(journal.state==='rolled_back'){cleanup(journal);return result;}
    checkCurrent(journal);
    const originals=journal.files.map(file=>file.existed?fs.readFileSync(contained(ctx.folder,file.backup)):null),rawReceipt=fs.readFileSync(contained(ctx.folder,journal.receiptBackup));
    for(const [i,file]of journal.files.entries()){
      const target=contained(ctx.root,file.target);
      if(file.existed)atomic(target,originals[i]);else if(fs.existsSync(target))fs.unlinkSync(target);
    }
    atomic(ctx.receiptFile,rawReceipt);
    if(fs.existsSync(ctx.pendingFile))fs.unlinkSync(ctx.pendingFile); // Only ownedPending validated native-file intent.
    journal.state='rolled_back';save(journal);
    cleanup(journal);result.message='Previous enabled NPC native support restored; financial state untouched.';return result;
  }
  if(request.action==='commit_update'){
    if(journal.state==='rolled_back')throw Error('Enabled NPC update was rolled back; restore the old package');
    if(journal.state!=='committed'){
      if(journal.state!=='applied')throw Error('Apply the enabled NPC update before committing it');
      if(fs.existsSync(ctx.pendingFile))throw Error('Native installation intent is still unfinished');
      const receipt=read(ctx.receiptFile);validateReceipt(ctx,receipt);verifyFiles(ctx,receipt);
      if(receipt.state!=='active'||receipt.version!==own.version||!ownedReceipt(journal,receipt)||fileSHA(ctx.receiptFile)!==journal.appliedReceiptSHA)throw Error('Enabled NPC update receipt is not ready to commit');
      // Launcher must durably decide commit before this call. Lost output is
      // recovered by retrying commit, never by reverting to the old package.
      journal.state='committed';save(journal);
    }
    cleanup(journal);result.message='Enabled NPC update committed; original uninstall backups retained.';return result;
  }
  if(['committed','rolled_back'].includes(journal.state))throw Error('Finish completed enabled NPC update recovery');
  checkCurrent(journal);checkSchema(ctx.root,contained,s);
  if(journal.state==='applied'){verifyFiles(ctx,read(ctx.receiptFile));return result;}
  journal.state='applying';save(journal);
  const pending=ownedPending(journal);
  if(pending)finish(ctx,pending);
  else{
    const receipt=read(ctx.receiptFile);validateReceipt(ctx,receipt);
    const current=ALLOWED.map(target=>fileSHA(contained(ctx.root,target)));
    const alreadyApplied=same(current,ctx.payloadSHA)&&receipt.version===own.version&&ownedReceipt(journal,receipt);
    if(!alreadyApplied){
      if(!same(current,journal.files.map(file=>file.sha256))||fileSHA(ctx.receiptFile)!==journal.receiptSHA)throw Error('Enabled NPC update lost its native installation intent');
      const upstream=journal.upstreamId?s.identities.baselines.find(item=>item.id===journal.upstreamId):null;
      if(journal.upstreamId&&!upstream)throw Error('The recorded upstream baseline is no longer recognized');
      installNative(ctx,receipt,{current,upstream},{plan:journal.plannedReceipt,onPlanned:plan=>{
        journal.plannedReceipt=JSON.parse(JSON.stringify(plan));save(journal);
      }});
    }
  }
  const applied=read(ctx.receiptFile);validateReceipt(ctx,applied);verifyFiles(ctx,applied);
  journal.state='applied';journal.appliedReceiptSHA=fileSHA(ctx.receiptFile);save(journal);
  result.message='Enabled NPC update applied; pending settlements preserved for normal native recovery.';return result;
}
module.exports={PROTOCOL,COMPATIBILITY,FROM,ACTIONS,FINANCIAL,COLUMNS,checkSchema,executeUpdate};
