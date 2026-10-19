"use strict";
// The Launcher owns the lifecycle lease. This helper replaces only five
// native files, with a recoverable receipt outside the replaceable mod folder.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),net=require('node:net');
const {execFileSync}=require('node:child_process');
const {createDelivery}=require('./loginDelivery');
const identities=require('./nativeIdentities.json');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const fileSHA=file=>fs.existsSync(file)?sha(fs.readFileSync(file)):null;
const validSHA=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const repairMessage='Native market support was replaced by the EveJS updater. Stop EveJS and the native market, then use NPC Market Buyers Actions > Install / Update or Recover.';
const ALLOWED=[
  'externalservices/market-server/target/release/market-server.exe',
  'externalservices/market-server/crates/market-common/src/lib.rs',
  'externalservices/market-server/src/main.rs',
  'externalservices/market-server/src/rpc.rs',
  'externalservices/market-server/src/state.rs',
];
function contained(root,relative){
  const target=path.resolve(root,relative),prefix=root+path.sep;
  if(!target.startsWith(prefix))throw Error('Native install path escaped selected EveJS root');
  let parent=path.dirname(target);while(!fs.existsSync(parent))parent=path.dirname(parent);
  const real=fs.realpathSync(parent);
  if(real!==root&&!real.startsWith(prefix))throw Error('Native install path follows an external junction');
  if(fs.existsSync(target)&&(!fs.lstatSync(target).isFile()||fs.lstatSync(target).isSymbolicLink()))throw Error('Native install target is not a regular file');
  return target;
}
function atomic(file,bytes){
  fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.npc-market-'+crypto.randomUUID()+'.tmp';
  let fd;
  try{fd=fs.openSync(tmp,'wx');fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=null;fs.renameSync(tmp,file);}
  finally{if(fd!==null&&fd!==undefined)fs.closeSync(fd);if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
}
const json=(file,value)=>atomic(file,Buffer.from(JSON.stringify(value,null,2)+'\n'));
const read=file=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
async function portBusy(port){return new Promise((resolve,reject)=>{const socket=net.connect({host:'127.0.0.1',port});
  const done=value=>{socket.destroy();resolve(value);};
  const unknown=error=>{socket.destroy();reject(Error('Cannot verify inactive local server: '+String(error.code||error.message||error)));};
  socket.setTimeout(500,()=>unknown(Error('loopback probe timed out')));socket.once('connect',()=>done(true));
  socket.once('error',error=>error.code==='ECONNREFUSED'?done(false):unknown(error));});}
async function assertInactive(root){
  // Catch the normal Native listeners even when Windows denies process details.
  const serverConfig=read(path.join(root,'config/server.json'));
  const ports=[serverConfig?.network?.serverPort||26000];
  if(process.env.EVEJS_SERVER_PORT)ports.push(Number(process.env.EVEJS_SERVER_PORT));
  const config=path.join(root,'externalservices/market-server/config/market-server.local.toml');
  const marketPorts=fs.existsSync(config)?[...fs.readFileSync(config,'utf8').matchAll(/^\s*port\s*=\s*(\d+)\s*$/gm)].map(match=>Number(match[1])):[];
  ports.push(...(marketPorts.length?marketPorts:[40110,40111]));
  if(ports.some(port=>!Number.isInteger(port)||port<1||port>65535))throw Error('Cannot verify inactive server: invalid configured local port');
  const busy=await Promise.all([...new Set(ports)].map(async port=>await portBusy(port)?port:null));
  if(busy.some(Boolean))throw Error('Stop this EveJS server and native market before changing the mod; active local listener detected');
  if(process.platform==='win32'){
    const exe=contained(root,ALLOWED[0]).toLowerCase();
    const script="@(Get-Process -Name market-server -ErrorAction SilentlyContinue | ForEach-Object { $_.Path }) | ConvertTo-Json -Compress";
    const output=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,encoding:'utf8'}).trim();
    const paths=output?JSON.parse(output):[];
    if([].concat(paths||[]).some(p=>String(p).toLowerCase()===exe))throw Error('Stop the native market process before changing the mod');
  }
}
function context(request,modRoot){
  if(request.runtime?.backend!=='native')throw Error('NPC Market Buyers currently supports the Native backend');
  const root=fs.realpathSync(request.runtime.evejsRoot),manifest=read(path.join(modRoot,'payload/native.json'));
  if(!manifest||![1,2].includes(manifest.schema)||manifest.files?.length!==ALLOWED.length)throw Error('Native payload manifest is missing');
  if(!fs.existsSync(path.join(root,'server/package.json')))throw Error('Select an EveJS installation');
  createDelivery(modRoot);
  for(const [i,file] of manifest.files.entries()){
    if(file.target!==ALLOWED[i]||file.payload!==`native/${i}.bin`)throw Error('Unrecognized native payload entry');
    if(!fs.existsSync(contained(path.join(modRoot,'payload'),file.payload)))throw Error('Bundled native file is missing: '+file.payload);
    contained(root,file.target);
  }
  const state=contained(root,'_local/npc-market-buyers/install/receipt.json');
  const payloadSHA=manifest.files.map(file=>fileSHA(contained(path.join(modRoot,'payload'),file.payload)));
  return {root,manifest,modRoot,payloadSHA,folder:path.dirname(state),receiptFile:state,pendingFile:path.join(path.dirname(state),'pending.json')};
}
function validateReceipt(ctx,receipt){
  if(!receipt||![1,2,3].includes(receipt.schema)||!['active','restored'].includes(receipt.state)||receipt.files?.length!==ALLOWED.length)throw Error('Unrecognized native installation receipt');
  const legacy=receipt.schema===1;
  for(const [i,file] of receipt.files.entries()){
    const backupOK=file.backup===`backup/${i}.bin`||(receipt.schema===3&&new RegExp(`^backup/[a-f0-9-]{36}/${i}\\.bin$`).test(file.backup));
    if(file.target!==ALLOWED[i]||!backupOK||(!legacy&&typeof file.existed!=='boolean'))throw Error('Invalid native receipt file');
    if(legacy)file.existed=true;
    const backup=contained(ctx.folder,file.backup);
    if(file.existed&&!fs.existsSync(backup))throw Error('Native rollback backup is missing: '+file.target);
    const actualBase=file.existed?fileSHA(backup):null;
    if(receipt.schema===3&&((file.existed?!validSHA(file.baseSHA):file.baseSHA!==null)||file.baseSHA!==actualBase||!validSHA(file.installedSHA)))throw Error('Native rollback backup identity changed: '+file.target);
    if(receipt.schema!==3){file.baseSHA=actualBase;delete file.installedSHA;}
  }
  receipt.root=ctx.root;
}
function verifyFiles(ctx,receipt,state=receipt.state){
  if(state!=='active')return;
  const status=inspect(ctx,receipt);
  if(status.upstream||status.current.some((value,i)=>value!==ctx.payloadSHA[i]))throw Error(repairMessage);
}
function baseline(hashes){return identities.baselines.find(item=>item.sha256.slice(1).every((value,i)=>value===hashes[i+1]));}
function inspect(ctx,receipt){
  const current=receipt.files.map(file=>fileSHA(contained(ctx.root,file.target)));
  const upstream=baseline(current);
  // A coherent, exact upstream source set is the official updater boundary.
  // Partial or unrecognized source replacements must never be overwritten.
  for(const [i,file] of receipt.files.entries()){
    const owned=current[i]===ctx.payloadSHA[i]||current[i]===file.installedSHA||identities.legacyPayloads.some(item=>current[i]===item.sha256[i]);
    const upstreamOwned=upstream&&(i>0||current[i]===upstream.sha256[0]);
    if(!owned&&!upstreamOwned&&!(i===0&&current[i]===null))throw Error('Native market file has unrecognized changes; preserve and merge it before changing NPC Market Buyers: '+file.target);
  }
  return {current,upstream};
}
function snapshot(ctx,receipt,status){
  const generation=crypto.randomUUID(),previous=receipt&&baseline(receipt.files.map(file=>file.baseSHA));
  const retainExe=Boolean(status.upstream&&receipt&&previous?.id===status.upstream.id&&status.current[0]!==status.upstream.sha256[0]);
  const staleExe=Boolean(status.upstream&&receipt&&previous?.id!==status.upstream.id&&status.current[0]!==status.upstream.sha256[0]);
  const files=ctx.manifest.files.map((file,i)=>{
    // Updater preserves target/release. An old-version backup executable cannot
    // be restored beside new source; absence requests a normal native rebuild.
    const existed=i===0&&retainExe?receipt.files[0].existed:i===0&&staleExe?false:status.current[i]!==null;
    return {target:file.target,backup:`backup/${generation}/${i}.bin`,existed,baseSHA:existed?(i===0&&retainExe?receipt.files[0].baseSHA:status.current[i]):null,installedSHA:ctx.payloadSHA[i]};
  });
  const bytes=files.map((file,i)=>file.existed?fs.readFileSync(i===0&&retainExe?contained(ctx.folder,receipt.files[0].backup):contained(ctx.root,file.target)):null);
  // New generations preserve the old receipt and its backups until intent is durable.
  for(const [i,file] of files.entries())if(file.existed)atomic(contained(ctx.folder,file.backup),bytes[i]);
  return {schema:3,root:ctx.root,state:'restored',files,createdAt:receipt?.createdAt||new Date().toISOString(),rebasedAt:receipt?new Date().toISOString():undefined};
}
function assertNoPending(root,{Database}={}){
  const file=contained(root,'_local/npc-market-buyers/state.sqlite');if(!fs.existsSync(file))return;
  Database=Database||require(path.join(root,'server/node_modules/better-sqlite3'));
  const db=new Database(file,{readonly:true,fileMustExist:true});
  try{
    for(const table of ['nm_operations','nm_native_ops','nm_native_outbox']){
      if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))continue;
      if(db.prepare(`SELECT 1 FROM ${table} WHERE state='pending' LIMIT 1`).get())throw Error('NPC market settlement needs recovery before disabling. Start the enabled mod, let recovery complete, then stop and disable it.');
    }
  }finally{db.close();}
}
function finish(ctx,pending){
  const receipt=pending.receipt;validateReceipt(ctx,receipt);
  if(!['active','restored'].includes(pending.desired))throw Error('Invalid pending native transaction');
  // Read every source before replacing anything, then retain intent until done.
  const writes=receipt.files.map((file,i)=>({target:contained(ctx.root,file.target),bytes:pending.desired==='active'
    ?fs.readFileSync(contained(path.join(ctx.modRoot,'payload'),`native/${i}.bin`))
    :file.existed?fs.readFileSync(contained(ctx.folder,file.backup)):null}));
  if(pending.beforeSHA){
    if(pending.beforeSHA.length!==ALLOWED.length||pending.beforeSHA.some(value=>value!==null&&!validSHA(value)))throw Error('Invalid pending native source identities');
    for(const [i,write] of writes.entries()){
      const current=fileSHA(write.target),desired=write.bytes===null?null:sha(write.bytes);
      if(current!==pending.beforeSHA[i]&&current!==desired)throw Error('Native file changed during installation; preserve it before recovery: '+receipt.files[i].target);
    }
  }else{
    // Legacy durable intent may contain a half-completed swap. Only its saved
    // originals and recognized mod bytes are valid recovery inputs.
    for(const [i,write] of writes.entries()){
      const current=fileSHA(write.target),desired=write.bytes===null?null:sha(write.bytes);
      if(current!==desired&&current!==receipt.files[i].baseSHA&&current!==ctx.payloadSHA[i]&&current!==receipt.files[i].installedSHA&&!identities.legacyPayloads.some(item=>current===item.sha256[i]))throw Error('Native file changed during installation; preserve it before recovery: '+receipt.files[i].target);
    }
  }
  receipt.schema=3;for(const [i,file] of receipt.files.entries())file.installedSHA=ctx.payloadSHA[i];
  for(const {target,bytes} of writes){
    if(bytes===null){if(fs.existsSync(target))fs.unlinkSync(target);}
    else atomic(target,bytes);
  }
  receipt.state=pending.desired;receipt.updatedAt=new Date().toISOString();json(ctx.receiptFile,receipt);
  verifyFiles(ctx,receipt);fs.unlinkSync(ctx.pendingFile);return receipt;
}
function installNative(ctx,receipt,status){
  fs.mkdirSync(ctx.folder,{recursive:true});
  if(receipt?.state!=='active'||status.upstream)receipt=snapshot(ctx,receipt,status);
  else{
    receipt.schema=3;
    for(const [i,file] of receipt.files.entries())file.installedSHA=ctx.payloadSHA[i];
  }
  receipt.version=require('../package.json').version;
  const transaction={desired:'active',receipt,beforeSHA:status.current};json(ctx.pendingFile,transaction);finish(ctx,transaction);
}
async function prepareServerStart(ctx,pending,result,inactive){
  const receipt=read(ctx.receiptFile);
  if(!receipt||receipt.state!=='active')throw Error('Enable NPC Market Buyers in Mods to install its market support before starting the server');
  validateReceipt(ctx,receipt);
  if(pending){
    // A user-requested disable must never turn into an automatic enable.
    if(pending.desired!=='active'||!Array.isArray(pending.beforeSHA))throw Error('Native installation needs manual recovery before launch; use NPC Market Buyers Actions > Recover');
    await inactive(ctx.root);finish(ctx,pending);
    result.message='NPC market support recovered before server startup.';return result;
  }
  const status=inspect(ctx,receipt);
  // This is the normal path, including when the market is already running.
  // Receipt, backups, executable and settings/history remain byte-for-byte intact.
  if(status.current.every((value,i)=>value===ctx.payloadSHA[i]))return result;
  if(!status.upstream)throw Error(repairMessage);
  await inactive(ctx.root);installNative(ctx,receipt,status);
  result.message='NPC market support repaired after the EveJS update before server startup.';return result;
}
async function execute(request,{modRoot=path.resolve(__dirname,'..'),inactive=assertInactive}={}){
  const action=request.action;
  if(!['install','verify','prepare_profile','prepare_server_start','prepare_disable','prepare_remove','recover'].includes(action))throw Error('Unsupported NPC Market Buyers lifecycle action');
  const ctx=context(request,modRoot),pending=read(ctx.pendingFile);
  const result={protocol:request.protocol,requestId:request.requestId,success:true,state:'ready',
    message:'NPC market support is installed. Client advice attaches after character login.',restartRequired:[],contributions:[],environment:{},arguments:[]};
  if(action==='prepare_server_start')return prepareServerStart(ctx,pending,result,inactive);
  if(pending){if(['verify','prepare_profile'].includes(action))throw Error('Native installation needs recovery before launch');await inactive(ctx.root);if(pending.desired==='restored')assertNoPending(ctx.root);finish(ctx,pending);}
  let receipt=read(ctx.receiptFile);
  if(receipt)validateReceipt(ctx,receipt);
  if(action==='recover'){
    if(receipt?.state!=='active'){
      result.message='Native files restored. Enable the mod to install NPC market support.';return result;
    }
    // Explicit Recover shares the same guarded repair path as Install / Update.
  }
  if(['prepare_disable','prepare_remove'].includes(action)){
    if(receipt){if(receipt.state==='active'){
      const status=inspect(ctx,receipt);await inactive(ctx.root);assertNoPending(ctx.root);
      if(status.upstream)receipt=snapshot(ctx,receipt,status);
      const transaction={desired:'restored',receipt,beforeSHA:status.current};json(ctx.pendingFile,transaction);receipt=finish(ctx,transaction);
    }}
    result.message='Native market files restored. NPC purchase records and settings retained.';return result;
  }
  if(receipt?.state==='active'&&['verify','prepare_profile'].includes(action)){
    verifyFiles(ctx,receipt);
    return result;
  }
  if(['verify','prepare_profile'].includes(action))throw Error('Enable NPC Market Buyers in Mods to install its market support');
  const status=receipt?.state==='active'?inspect(ctx,receipt):{current:ctx.manifest.files.map(file=>fileSHA(contained(ctx.root,file.target))),upstream:null};
  await inactive(ctx.root);
  installNative(ctx,receipt,status);
  result.message='NPC market support installed. Original files backed up. Restart the game server and reconnect clients.';return result;
}
module.exports={ALLOWED,atomic,contained,execute,assertInactive,assertNoPending};
