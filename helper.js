"use strict";
const fs=require('node:fs');
const {execute}=require('./lib/install');
if(require.main===module){
  const arg=name=>{const index=process.argv.indexOf(name);if(index<0||!process.argv[index+1])throw Error('Missing '+name);return process.argv[index+1];};
  const request=JSON.parse(fs.readFileSync(arg('--request'),'utf8'));
  execute(request).catch(error=>({protocol:request.protocol,requestId:request.requestId,success:false,state:'failed',
    message:String(error.message).replace(/[\x00-\x20\x7f]+/g,' ').slice(0,4000),restartRequired:[],contributions:[],environment:{},arguments:[]}))
    .then(result=>{fs.writeFileSync(arg('--result'),JSON.stringify(result));if(!result.success)process.exitCode=1;});
}
module.exports={execute};
