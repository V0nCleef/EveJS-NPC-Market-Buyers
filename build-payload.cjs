"use strict";
const fs=require('node:fs'),path=require('node:path');
const {ALLOWED}=require('./lib/install');
const native=path.join(__dirname,'native/market-server');
const output=path.join(__dirname,'payload');fs.mkdirSync(path.join(output,'native'),{recursive:true});
const files=ALLOWED.map((target,i)=>{
  const relative=target.replace('externalservices/market-server/','');
  const source=path.join(native,relative),payload=`native/${i}.bin`;
  fs.copyFileSync(source,path.join(output,payload));
  return {target,payload};
});
fs.writeFileSync(path.join(output,'native.json'),JSON.stringify({schema:2,files},null,2)+'\n');
console.log('Prepared native payload: '+files.length+' files');
