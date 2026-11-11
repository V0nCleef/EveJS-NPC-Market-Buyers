"use strict";
const path=require("node:path");
function stateRoot(root,environment=process.env){
  const base=environment.EVEJS_MOD_DATA_ROOT;
  if(!base)return path.join(root,"_local/npc-market-buyers");
  if(!path.isAbsolute(base))throw Error("EVEJS_MOD_DATA_ROOT must be absolute");
  return path.join(path.resolve(base),"npc-market-buyers");
}
module.exports={stateRoot};
