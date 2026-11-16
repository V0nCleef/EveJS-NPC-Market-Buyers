"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const delivery=require('../lib/loginDelivery');
const root=path.resolve(process.env.EVEJS_TEST_ROOT||path.join(__dirname,'../../EveJS-v0.12.9')),modRoot=path.resolve(__dirname,'..');
const autoRoot=path.resolve(process.env.EVEJS_AUTOMINING_ROOT||path.join(root,'mods/AutoMining-1.2.0'));
function envelope(expression){const bytes=Buffer.from(expression,'latin1'),header=Buffer.alloc(5);header[0]=0x74;header.writeUInt32LE(bytes.length,1);return Buffer.concat([header,bytes]);}
test('login attachment uses the available send method without source or version fingerprints',()=>{
 class Handshake{_sendPacket(packet){return packet;}}
 delivery.installHandshake(Handshake,{delivery:delivery.createDelivery(modRoot),codec:{}});
 const bytes=Buffer.from('unrelated');assert.equal(new Handshake()._sendPacket(bytes),bytes);
 class Missing{}
 assert.throws(()=>delivery.installHandshake(Missing,{codec:{}}),/login send seam/);
});
test('post-compile login payload composes after installed AutoMining and preserves original bytes',()=>{
  const auto=require(path.join(autoRoot,'lib/loginDelivery')).createDelivery(autoRoot);
  const own=delivery.createDelivery(modRoot),original=envelope("'\xff'");
  // AutoMining wraps the builder; NPC wraps the outgoing packet after the
  // builder has finished. This order holds for either loader registration
  // order. AutoMining's internal 256 KiB bound runs before the NPC attachment.
  const composed=own.compose(auto.compose(envelope('41')));
  assert.equal(composed.readUInt32LE(1),composed.length-5);assert.ok(composed.length<1024*1024);
  assert.ok(composed.toString('latin1',5).endsWith('(41))'));assert.ok(composed.includes(Buffer.from('_nmb_context')));
  assert.ok(own.compose(original).includes(Buffer.from([0xff])));
  assert.throws(()=>own.compose(Buffer.from('bad')),/Unsupported login envelope/);
});
test('current Launcher registry and AutoMining compose with Buyers in either attachment order',()=>{
  const file=path.join(root,'server/src/network/tcp/handshake.js'),baseline=fs.readFileSync(file,'utf8');
  const auto=require(path.join(autoRoot,'lib/loginDelivery'));
  const shared=path.join(process.env.EVEJS_LAUNCHER_ROOT||'../evejs-launcher','src/core/client/shared_menu_loader.cjs');
  const api=fs.readFileSync(path.join(path.dirname(shared),'login_delivery.cjs'),'utf8');
  const frozen={handshakeSha256:require('node:crypto').createHash('sha256').update(baseline).digest('hex'),bootstrap:'# shared menu fixture\n'};
  const codec=require(path.join(root,'server/src/network/tcp/utils/marshal.js'));
  for(const npcFirst of [true,false]){
    const Module={prototype:{_compile:source=>source}};
    const sandbox={require:name=>['module','node:module'].includes(name)?Module:require(name),
      __dirname:path.join(root,'server/src/network'),Buffer,process,setTimeout,clearTimeout,console:{log(){},error:message=>assert.fail(message)}};
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(shared,'utf8').replace('/*__FROZEN_PAYLOAD__*/',JSON.stringify(frozen)).replace('/*__LOGIN_DELIVERY_RUNTIME__*/',api),sandbox);
    const runtime=vm.runInContext('globalThis[Symbol.for("evejs.loginDelivery.v1")]',sandbox);assert.ok(runtime);
    runtime.register({id:'automining',source:auto.createDelivery(autoRoot).source});
    class Handshake{constructor(){this.userId=7;this.sent=[];} _sendPacket(packet){this.sent.push(packet);} _handleFuncResult(){return {done:true};}}
    const install=()=>delivery.installHandshake(Handshake,{root,delivery:delivery.createDelivery(modRoot)});
    if(npcFirst)install();runtime.attach(Handshake);if(!npcFirst)install();
    assert.equal(Module.prototype._compile.call({exports:Handshake},baseline,file),baseline,'no source rewriting');
    const h=new Handshake(),original=['',[envelope('41'),0],{type:'dict',entries:[]},{type:'dict',entries:[['challenge_responsehash','55087']]}];
    const packet=codec.encodePacket(original);h._sendPacket(packet);
    const value=codec.marshalDecodeExact(h.sent[0].subarray(4)),text=value[1][0].toString('latin1');
    assert.ok(text.includes('_nmb_context'));assert.ok(text.includes('<evejs-login-delivery-v1>'));
    value[1][0]=original[1][0];assert.deepEqual(value,codec.marshalDecodeExact(packet.subarray(4)));
    h._sendPacket(packet);assert.deepEqual(h.sent[1],packet);
  }
  new vm.Script(fs.readFileSync(path.join(modRoot,'loader.js.disabled'),'utf8'));
});
test('post-compile login attachment uses actual native codec and preserves metadata and unrelated packets',()=>{
  const codec=require(path.join(root,'server/src/network/tcp/utils/marshal.js'));
  class Handshake{constructor(){this.userId=7;this.sent=[];} _sendPacket(packet){this.sent.push(packet);return 'sent';}}
  const own=delivery.createDelivery(modRoot);
  delivery.installHandshake(Handshake,{root,delivery:own});delivery.installHandshake(Handshake,{root,delivery:own});
  const h=new Handshake(),original=['',[envelope('41'),false],{type:'dict',entries:[]},{type:'dict',entries:[['challenge_responsehash','55087'],['config_vals',{type:'dict',entries:[['example',42]]}]]}];
  const packet=codec.encodePacket(original),decodedOriginal=codec.marshalDecodeExact(packet.subarray(4)),other=codec.encodePacket(2);
  assert.equal(h._sendPacket(other),'sent');assert.deepEqual(h.sent[0],other);
  h._sendPacket(packet);const value=codec.marshalDecodeExact(h.sent[1].subarray(4));
  assert.ok(value[1][0].length>original[1][0].length);value[1][0]=original[1][0];assert.deepEqual(value,decodedOriginal);
  const encodedBuffer=codec.marshalEncode(original[1][0]).subarray(5),at=packet.indexOf(encodedBuffer);
  assert.deepEqual(h.sent[1].subarray(4,at),packet.subarray(4,at));
  assert.deepEqual(h.sent[1].subarray(h.sent[1].length-(packet.length-at-encodedBuffer.length)),packet.subarray(at+encodedBuffer.length));
  h._sendPacket(packet);assert.deepEqual(h.sent[2],packet);
});
test('actual release numeric-zero signed-function flag attaches exactly once without changing native metadata',()=>{
  const codec=require(path.join(root,'server/src/network/tcp/utils/marshal.js'));
  const source=fs.readFileSync(path.join(root,'server/src/network/tcp/handshake.js'),'utf8');
  assert.match(source,/\[buildTidiSignedFunc\(this\.clientId(?:, \{ accountRole: this\.accountRole \})?\),\s*0\]/,'Use the real release wire flag, including 261115.2 staff-health delivery');
  class Handshake{constructor(){this.userId=7;this.sent=[];} _sendPacket(packet){this.sent.push(packet);}}
  delivery.installHandshake(Handshake,{root,delivery:delivery.createDelivery(modRoot)});
  const original=['',[envelope('41'),0],{type:'dict',entries:[]},{type:'dict',entries:[['challenge_responsehash','55087']]}];
  const packet=codec.encodePacket(original),before=codec.marshalDecodeExact(packet.subarray(4)),h=new Handshake();
  h._sendPacket(packet);const after=codec.marshalDecodeExact(h.sent[0].subarray(4));
  assert.ok(after[1][0].length>before[1][0].length,'The actual numeric-zero wire packet must carry the companion');
  after[1][0]=before[1][0];assert.deepEqual(after,before);
  h._sendPacket(packet);assert.deepEqual(h.sent[1],packet,'Do not deliver twice on the same handshake');
});
test('unsupported signed-function flags remain untouched',()=>{
  const codec=require(path.join(root,'server/src/network/tcp/utils/marshal.js'));
  for(const flag of [true,1,null,'0']){
    class Handshake{constructor(){this.userId=7;this.sent=[];} _sendPacket(packet){this.sent.push(packet);}}
    delivery.installHandshake(Handshake,{root,delivery:delivery.createDelivery(modRoot)});
    const packet=codec.encodePacket(['',[envelope('41'),flag],{type:'dict',entries:[]},{type:'dict',entries:[['challenge_responsehash','55087']]}]),h=new Handshake();
    h._sendPacket(packet);assert.deepEqual(h.sent[0],packet,'Unexpected flag must remain native: '+String(flag));
  }
});
