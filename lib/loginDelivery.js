"use strict";
const fs=require("node:fs"),path=require("node:path"),zlib=require("node:zlib");
const KEY="evejs.npc-market-buyers.loader.v1";
function createDelivery(modRoot){
  const sources=["i18n.py","sell_advisor.py","hud.py","wallet_summary.py","companion.py"].map(name=>fs.readFileSync(path.join(modRoot,"client",name),"utf8"));
  const source="# coding: utf-8\n"+sources.join("\n\n"),data=zlib.deflateSync(Buffer.from(source),{level:9}).toString("base64");
  if(data.length>200*1024)throw Error("NPC market client companion exceeds the reviewed payload bound");
  const execution=`try:\n eval(compile(__import__('zlib').decompress(__import__('base64').b64decode('${data}')), '<npc-market-buyers>', 'exec'), {'__builtins__': __builtins__, '_nmb_context': _nmb_context})\nexcept Exception:\n print('NPC_MARKET_BUYERS:CLIENT_FAILED')\n`;
  const expression=`eval(compile(${JSON.stringify(execution)}, '<npc-market-delivery>', 'exec'), {'__builtins__': __builtins__, '_nmb_context': globals()})`;
  return {compose(original){
    if(!Buffer.isBuffer(original)||original.length<5||original[0]!==0x74||original.readUInt32LE(1)!==original.length-5)throw Error("Unsupported login envelope");
    const previous=original.subarray(5).toString("latin1"),wrapped=`(lambda _nm_result: (${expression}, _nm_result)[1])(${previous})`,bytes=Buffer.from(wrapped,"latin1");
    if(bytes.length>1024*1024)throw Error("Combined login payload exceeds one MiB");
    const header=Buffer.alloc(5);header[0]=0x74;header.writeUInt32LE(bytes.length,1);return Buffer.concat([header,bytes]);
  }};
}
function installHandshake(Service,{root,delivery,active=()=>true,codec}={}){
  const installed=Symbol.for(KEY+'.handshake');
  if(Service.prototype[installed])return;
  if(typeof Service.prototype._sendPacket!=='function')throw Error('NPC market login send seam changed');
  codec=codec||require(path.join(root,'server/src/network/tcp/utils/marshal.js'));
  const previous=Service.prototype._sendPacket,delivered=Symbol.for(KEY+'.delivered');
  // Attach after compilation. Older AutoMining preloads accept only an exact
  // source baseline, so appending another builder wrapper would suppress them.
  // The native codec unwraps just the reviewed outgoing login function, before
  // the original sender performs its existing encryption and socket write.
  Service.prototype._sendPacket=function(packet){
    if(active()&&!this[delivered]&&Number(this.userId)>0&&Buffer.isBuffer(packet)&&packet.length>=5&&packet.length<=1024*1024&&packet.readUInt32LE(0)===packet.length-4){
      try{
        const value=codec.marshalDecodeExact(packet.subarray(4));
        if(Array.isArray(value)&&value.length===4&&codec.strVal(value[0])===''&&Array.isArray(value[1])&&value[1].length===2&&Buffer.isBuffer(value[1][0])&&value[1][1]===false&&value[2]?.type==='dict'&&codec.strVal(codec.dictGet(value[3],'challenge_responsehash'))==='55087'){
          const before=codec.marshalEncode(value[1][0]),after=codec.marshalEncode(delivery.compose(value[1][0]));
          if(before[0]!==codec.MARSHAL_HEADER||after[0]!==codec.MARSHAL_HEADER)throw Error('Native codec header changed');
          // Replace only the native-encoded buffer value. Re-encoding the
          // entire decoded packet could change native string opcode choices.
          const oldValue=before.subarray(5),newValue=after.subarray(5),at=packet.indexOf(oldValue,9);
          if(at<0||packet.indexOf(oldValue,at+oldValue.length)>=0)throw Error('Login function is not uniquely encoded');
          packet=codec.wrapPacket(Buffer.concat([packet.subarray(4,at),newValue,packet.subarray(at+oldValue.length)]));this[delivered]=true;
        }
      }catch(error){console.error('[NPC Market Buyers] Client delivery failed; original login preserved: '+error.message);}
    }
    return previous.call(this,packet);
  };
  Object.defineProperty(Service.prototype,installed,{value:true});
}
module.exports={KEY,createDelivery,installHandshake};
