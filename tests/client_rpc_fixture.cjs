"use strict";
// Actual RPC handler/policy response contract, isolated in-memory dependencies.
const fs = require('node:fs');
const {installService} = require('../lib/service');
const {DEFAULTS, validateConfig} = require('../lib/config');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
let config = {...DEFAULTS}, revision = 7;
const now = 1791565200000;
const quote = {typeID:34, referencePrice:100, dailyVolume:100000, orders:20,
  confidence:'high', updatedAt:now, source:'esi'};
const store = {
  getConfig:()=>config, getRevision:()=>revision,
  saveConfig(value, expected) {
    if (expected !== revision) throw Error('Policy changed in another window');
    config = validateConfig(value); return {config, revision:++revision};
  },
  recordActivity:()=>{},
  listActivity:()=>[{kind:'purchase', timestamp:now, characterID:42,
    message:'NPC bought 2 units for 220.00 ISK.',
    details:{quantity:2,grossISK:220,taxISK:17.6,orderID:9,typeID:34}}],
};
class Service {}
installService(Service, {store,
  quotes:{get:async()=>quote,peek:()=>quote},
  engine:{status:()=>({running:true,nextDueAt:now+900000}),
    previewAllowance:()=>({availableISK:25000000,remainingDemand:100})},
  adapter:{ready:async()=>{if(input.blocked)throw Error('Market worker is unavailable');},
    listOrders:async()=>[{orderID:9,sellerID:42,typeID:34,price:110,quantity:12,originalQuantity:20},
                        {orderID:10,sellerID:43,typeID:34,price:110,quantity:99}]},
  hasStaffAccountRole:session=>Boolean(session.isGM),clock:()=>now,
});
const service = new Service(), session = {charid:42,isGM:true};
(async()=>{
  const decode = async(method,args=[])=>JSON.parse(await service['Handle_'+method](args,session));
  const output = {
    state:await decode('NpcMarketGetState'),
    quote:await decode('NpcMarketQuote',[{type:'wstring',value:input.quoteInput}]),
    orders:await decode('NpcMarketGetOrders'),
    activity:await decode('NpcMarketActivity'),
  };
  if (input.configureInput) output.configure = await decode('NpcMarketConfigure',[{type:'rawstr',value:input.configureInput}]);
  process.stdout.write(JSON.stringify(output));
})().catch(error=>{console.error(error);process.exitCode=1;});
