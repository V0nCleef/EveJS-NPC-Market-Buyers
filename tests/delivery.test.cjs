"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const delivery=require('../lib/loginDelivery');
const root=path.resolve(process.env.EVEJS_TEST_ROOT||path.join(__dirname,'../../EveJS-v0.12.9')),modRoot=path.resolve(__dirname,'..');
function envelope(expression){const bytes=Buffer.from(expression,'latin1'),header=Buffer.alloc(5);header[0]=0x74;header.writeUInt32LE(bytes.length,1);return Buffer.concat([header,bytes]);}
test('login attachment uses the available send method without source or version fingerprints',()=>{
 class Handshake{_sendPacket(packet){return packet;}}
 delivery.installHandshake(Handshake,{delivery:delivery.createDelivery(modRoot),codec:{}});
 const bytes=Buffer.from('unrelated');assert.equal(new Handshake()._sendPacket(bytes),bytes);
 class Missing{}
 assert.throws(()=>delivery.installHandshake(Missing,{codec:{}}),/login send seam/);
});
test('post-compile login payload composes after installed AutoMining and preserves original bytes',()=>{
  const autoRoot=path.join(root,'mods/AutoMining-1.2.0');
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
test('actual Launcher shared-menu and AutoMining wrappers retain native source without NPC source mutation',()=>{
  const file=path.join(root,'server/src/network/tcp/handshake.js'),baseline=fs.readFileSync(file,'utf8');
  const auto=require(path.join(root,'mods/AutoMining-1.2.0/lib/loginDelivery'));
  const shared=path.join(process.env.EVEJS_LAUNCHER_ROOT||'../evejs-launcher','src/core/client/shared_menu_loader.cjs');
  const frozen={handshakeSha256:require('node:crypto').createHash('sha256').update(baseline).digest('hex'),framework:'IyBmaXh0dXJl',frameworkDigest:'fixture',entries:[]};
  for(const input of [auto.extendSource(baseline)]){
    const Module={prototype:{_compile:source=>source}};
    vm.runInNewContext(fs.readFileSync(shared,'utf8').replace('/*__FROZEN_PAYLOAD__*/',JSON.stringify(frozen)),{
      require:name=>name==='module'?Module:require(name),__dirname:path.join(root,'server/src/network'),Buffer,console:{log(){}}
    });
    const composed=Module.prototype._compile(input,file);assert.ok(composed.startsWith(baseline));new vm.Script(composed);
    assert.ok(composed.includes('_evejsSharedMenuPreviousBuilder'));assert.ok(composed.includes('__amPreviousLogin'));
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
