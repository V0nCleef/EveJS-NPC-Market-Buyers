"use strict";
const fs=require('node:fs'),path=require('node:path');
const {ALLOWED,hash}=require('./lib/install');
const base=path.resolve(process.argv[2]||path.join(__dirname,'../EveJS-v0.12.9')),native=path.join(__dirname,'native/market-server');
const output=path.join(__dirname,'payload');fs.mkdirSync(path.join(output,'native'),{recursive:true});
const files=ALLOWED.map((target,i)=>{
  const relative=target.replace('externalservices/market-server/','');
  const source=path.join(native,relative),payload=`native/${i}.bin`;
  fs.copyFileSync(source,path.join(output,payload));
  return {target,payload,baseSHA:hash(path.join(base,target)),installedSHA:hash(source)};
});
fs.writeFileSync(path.join(output,'native.json'),JSON.stringify({schema:1,reviewedEveJS:'0.12.9',clientBuild:3396210,files},null,2)+'\n');
console.log('Prepared native payload: '+files.length+' reviewed files');
