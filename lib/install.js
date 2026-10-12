"use strict";
// The Launcher owns the lifecycle lease. This helper replaces only five
// native files, with a recoverable receipt outside the replaceable mod folder.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),net=require('node:net');
const {execFileSync}=require('node:child_process');
const {createDelivery}=require('./loginDelivery');
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
  return {root,manifest,modRoot,folder:path.dirname(state),receiptFile:state,pendingFile:path.join(path.dirname(state),'pending.json')};
}
function validateReceipt(ctx,receipt){
  if(!receipt||![1,2].includes(receipt.schema)||!['active','restored'].includes(receipt.state)||receipt.files?.length!==ALLOWED.length)throw Error('Unrecognized native installation receipt');
  const legacy=receipt.schema===1;
  for(const [i,file] of receipt.files.entries()){
    if(file.target!==ALLOWED[i]||file.backup!==`backup/${i}.bin`||(!legacy&&typeof file.existed!=='boolean'))throw Error('Invalid native receipt file');
    if(legacy)file.existed=true;
    const backup=contained(ctx.folder,file.backup);
    if(file.existed&&!fs.existsSync(backup))throw Error('Native rollback backup is missing: '+file.target);
    delete file.baseSHA;delete file.installedSHA;delete file.payload;
  }
  receipt.schema=2;receipt.root=ctx.root;
}
function verifyFiles(ctx,receipt,state=receipt.state){
  if(state==='active')for(const file of receipt.files)if(!fs.existsSync(contained(ctx.root,file.target)))throw Error('Native market file is missing; enable the mod again to reinstall it: '+file.target);
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
  for(const {target,bytes} of writes){
    if(bytes===null){if(fs.existsSync(target))fs.unlinkSync(target);}
    else atomic(target,bytes);
  }
  receipt.state=pending.desired;receipt.updatedAt=new Date().toISOString();json(ctx.receiptFile,receipt);
  verifyFiles(ctx,receipt);fs.unlinkSync(ctx.pendingFile);return receipt;
}
async function execute(request,{modRoot=path.resolve(__dirname,'..'),inactive=assertInactive}={}){
  const action=request.action;
  if(!['install','verify','prepare_profile','prepare_disable','prepare_remove','recover'].includes(action))throw Error('Unsupported NPC Market Buyers lifecycle action');
  const ctx=context(request,modRoot),pending=read(ctx.pendingFile);
  const result={protocol:request.protocol,requestId:request.requestId,success:true,state:'ready',
    message:'NPC market support is installed. Client advice attaches after character login.',restartRequired:[],contributions:[],environment:{},arguments:[]};
  if(pending){if(['verify','prepare_profile'].includes(action))throw Error('Native installation needs recovery before launch');await inactive(ctx.root);if(pending.desired==='restored')assertNoPending(ctx.root);finish(ctx,pending);}
  let receipt=read(ctx.receiptFile);
  if(receipt)validateReceipt(ctx,receipt);
  if(action==='recover'){
    if(receipt)verifyFiles(ctx,receipt);
    result.message=receipt?.state==='active'?'Native installation recovered.':'Native files restored. Enable the mod to install NPC market support.';
    return result;
  }
  if(['prepare_disable','prepare_remove'].includes(action)){
    if(receipt){if(receipt.state==='active'){
      await inactive(ctx.root);assertNoPending(ctx.root);const transaction={desired:'restored',receipt};json(ctx.pendingFile,transaction);receipt=finish(ctx,transaction);
    }}
    result.message='Native market files restored. NPC purchase records and settings retained.';return result;
  }
  if(receipt?.state==='active'&&['verify','prepare_profile'].includes(action)){
    verifyFiles(ctx,receipt);
    return result;
  }
  if(['verify','prepare_profile'].includes(action))throw Error('Enable NPC Market Buyers in Mods to install its market support');
  await inactive(ctx.root);
  fs.mkdirSync(ctx.folder,{recursive:true});
  if(receipt?.state!=='active'){
    const files=ctx.manifest.files.map((file,i)=>({target:file.target,backup:`backup/${i}.bin`,existed:fs.existsSync(contained(ctx.root,file.target))}));
    const snapshots=files.map(file=>file.existed?fs.readFileSync(contained(ctx.root,file.target)):null);
    for(const [i,file] of files.entries())if(file.existed)atomic(contained(ctx.folder,file.backup),snapshots[i]);
    receipt={schema:2,root:ctx.root,state:'restored',files,createdAt:new Date().toISOString()};
  }
  receipt.version=require('../package.json').version;
  const transaction={desired:'active',receipt};json(ctx.pendingFile,transaction);finish(ctx,transaction);
  result.message='NPC market support installed. Original files backed up. Restart the game server and reconnect clients.';return result;
}
module.exports={ALLOWED,atomic,contained,execute,assertInactive,assertNoPending};
