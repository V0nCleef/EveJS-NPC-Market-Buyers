'use strict';
// TEST ONLY. Not included by pack-release.py. Authenticated to the named
// GridCheck character, and refuses every tree except the disposable copy.
const Module=require('node:module'),path=require('node:path');
const tree='G:\\Eve Local\\Codex playground\\EveJS-v0.12.9';
const original=Module.prototype._compile;
Module.prototype._compile=function(source,filename){
 const result=original.call(this,source,filename);
 if(path.resolve(filename)===path.join(tree,'server/src/services/market/marketProxyService.js')){
  const Service=this.exports;
  Service.prototype.Handle_NpcMarketTestSeed=async function(args,session){
   const file=require.resolve('./gridcheck-fixture-seed.cjs');
   delete require.cache[file];
   return require(file).call(this,args,session);
  };
 }
 return result;
};
