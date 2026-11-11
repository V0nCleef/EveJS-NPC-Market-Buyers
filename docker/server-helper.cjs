"use strict";
const path=require("node:path"),h=require("./helper-v1.cjs");
const {execute,ACTIONS}=require("./server-lifecycle.cjs");
if(require.main===module)h.run(request=>execute(request,{modRoot:path.resolve(__dirname,"..")}));
module.exports={execute,ACTIONS};
