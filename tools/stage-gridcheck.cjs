'use strict';
// This harness is deliberately locked to the disposable playground. Never
// stage a test mod, fixtures or alternate startup into Josh's live play tree.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execute,ALLOWED,assertInactive}=require('../lib/install');
const source=path.resolve(__dirname,'..'),tree='G:\\Eve Local\\Codex playground\\EveJS-v0.12.9';
const live='G:\\Eve Local\\EveJS versions\\New\\EveJS-v0.12.9';
const evidence=path.join(source,'evidence','statistics-gridcheck');
const stage=path.join(tree,'mods','NPC-Market-Buyers-statistics-test');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
async function main(){
 if(fs.realpathSync(tree)!==tree||tree===live)throw Error('Isolated tree identity mismatch');
 await assertInactive(tree);
 fs.mkdirSync(evidence,{recursive:true});
 const protectedFiles=['config/server.json','server/src/network/tcp/handshake.js','gridcheck.config.json',...ALLOWED];
 const manifest=[];
 for(const name of protectedFiles){
  const file=path.join(tree,name),backup=path.join(evidence,'backup',name);
  fs.mkdirSync(path.dirname(backup),{recursive:true});
  if(!fs.existsSync(backup))fs.copyFileSync(file,backup);
  manifest.push({name,sha256:hash(file),backup});
 }
 const liveMod=fs.readdirSync(path.join(live,'mods')).find(name=>name.startsWith('NPC-Market-Buyers-')&&fs.existsSync(path.join(live,'mods',name,'loader.js')));
 const liveFiles=['config/server.json','server/src/network/tcp/handshake.js',...ALLOWED,
  ...(liveMod?[`mods/${liveMod}/client/hud.py`,`mods/${liveMod}/lib/store.js`]:[])];
 const liveBefore=liveFiles.map(name=>({name,sha256:hash(path.join(live,name))}));
 if(!fs.existsSync(path.join(evidence,'preflight.json')))fs.writeFileSync(path.join(evidence,'preflight.json'),JSON.stringify({tree,stage,live,manifest,liveBefore},null,2));
 fs.mkdirSync(stage,{recursive:true});
 for(const name of ['lib','client','payload'])fs.cpSync(path.join(source,name),path.join(stage,name),{recursive:true});
 for(const name of ['package.json','evejs-launcher.mod.json','helper.js'])fs.copyFileSync(path.join(source,name),path.join(stage,name));
 fs.copyFileSync(path.join(source,'loader.js.disabled'),path.join(stage,'loader.js'));
 const result=await execute({action:'install',protocol:1,requestId:'gridcheck-statistics',runtime:{backend:'native',evejsRoot:tree}},{modRoot:stage});
 fs.writeFileSync(path.join(evidence,'install.json'),JSON.stringify(result,null,2));
 const configFile=path.join(tree,'gridcheck.config.json'),config=JSON.parse(fs.readFileSync(configFile));
 if(!config.start.includes(path.join(stage,'loader.js'))){config.start.splice(config.start.length-1,0,'--require',path.join(stage,'loader.js'));}
 fs.writeFileSync(configFile,JSON.stringify(config,null,2)+'\n');
 console.log(JSON.stringify({tree,stage,nativeInstall:result.success,protectedLiveFiles:liveBefore.length}));
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
