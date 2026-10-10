"use strict";
const path=require("node:path");
const {evaluate,priceChance}=require("./policy");
const {uiError}=require('./uiErrors');
const {DEFAULTS}=require('./config');
function clientText(value,maximum=8192){
  if(value&&["wstring","token","rawstr"].includes(value.type))value=value.value;
  if(Buffer.isBuffer(value))value=value.toString("utf8");
  if(typeof value!=="string"||Buffer.byteLength(value)>maximum)throw Error("Invalid or oversized request");
  return value;
}
function parse(args,maximum){return JSON.parse(clientText(args?.[0],maximum));}
function characterID(session){const id=Number(session?.characterID||session?.charid);if(!Number.isSafeInteger(id)||id<=0)throw Error("Character login required");return id;}
function installService(Service,{root,store,quotes,engine,adapter,hasStaffAccountRole,clock=Date.now}){
  if(Service.prototype.__npcMarketServiceV1)return;
  if(!hasStaffAccountRole)({hasStaffAccountRole}=require(path.join(root,"server/src/services/account/accountRoleProfiles.js")));
  const ownOrders=async id=>(await adapter.listOrders()).filter(o=>Number(o.sellerID)===id);
  const readiness=async()=>{try{await adapter.ready();return {ready:true};}catch(error){return {ready:false,reason:String(error.message).slice(0,500)};}};
  const block=(preview,reason)=>({...preview,eligible:false,chancePercent:0,reason:"settlement_unavailable",warning:"unavailable",message:reason});
  const wrap=action=>async function(args,session){try{const id=characterID(session);return JSON.stringify({success:true,...await action(args,session,id)});}catch(error){return JSON.stringify({success:false,message:String(error.message).slice(0,500),...uiError(error)});}};
  Service.prototype.Handle_NpcMarketGetState=wrap(async(args,session)=>({config:store.getConfig(),defaultConfig:DEFAULTS,referenceChancePercent:priceChance(100,store.getConfig()),revision:store.getRevision(),status:{...engine.status(),...await readiness()},canConfigure:hasStaffAccountRole(session)}));
  Service.prototype.Handle_NpcMarketQuote=wrap(async(args,session,id)=>{
    const input=parse(args),typeID=Number(input.typeID),price=Number(input.price),quantity=Number(input.quantity);
    if(!Number.isSafeInteger(typeID)||typeID<=0||!Number.isFinite(price)||price<=0||!Number.isSafeInteger(quantity)||quantity<=0)throw Error("Invalid item, price or quantity");
    const config=store.getConfig(),context={stationID:Number(input.stationID),quantity},quote=await quotes.get(typeID,config,context);
    const allowance=engine.previewAllowance?engine.previewAllowance({sellerID:id,typeID,stationID:Number(input.stationID),price,quantity}):null;
    let preview=evaluate({price,quantity,quote,config,now:clock(),availableISK:config.ironMode?Infinity:allowance?.availableISK??Math.min(config.cycleBudgetISK,config.dailyBudgetISK,config.sellerDailyBudgetISK),remainingDemand:allowance?.remainingDemand??Infinity});
    const native=await readiness();if(!native.ready)preview=block(preview,native.reason);
    if(Number(input.duration)===0){preview.eligible=false;preview.chancePercent=0;preview.reason="immediate_sale";preview.message="Scheduled NPC buying applies to placed sell orders; immediate sale uses current buy orders";}
    return {preview,config,quote,revision:store.getRevision(),chanceLabel:config.ironMode?"Chance per eligible check; Unlimited mode has no volume quotas or spending caps":"Chance per eligible check; limited-mode quotas and budgets apply"};
  });
  Service.prototype.Handle_NpcMarketConfigure=wrap(async(args,session,id)=>{
    if(!hasStaffAccountRole(session))throw Error("Only a server owner or GM can change NPC buying policy");
    const input=parse(args,16384),saved=store.saveConfig(input.config,input.revision);
    store.recordActivity({kind:"configuration",message:"NPC buying policy updated",characterID:id,details:{revision:saved.revision}});
    return {...saved,message:"Policy saved. Buying changes apply at the next scheduled check."};
  });
  Service.prototype.Handle_NpcMarketGetOrders=wrap(async(args,session,id)=>{
    const config=store.getConfig(),orders=(await ownOrders(id)).slice(0,200);
    const contexts=new Map();
    for(const order of orders){const key=`${order.typeID}:${order.stationID}:${order.quantity}`;
      if(!contexts.has(key)&&contexts.size<20)contexts.set(key,order);}
    for(const order of contexts.values())quotes.get(order.typeID,config,order).catch(()=>{});
    const native=await readiness();
    return {orders:orders.map(order=>{
      const allowance=engine.previewAllowance(order);
      let preview=evaluate({price:order.price,quantity:order.quantity,quote:quotes.peek(order.typeID,config,order),config,now:clock(),availableISK:config.ironMode?Infinity:allowance.availableISK,remainingDemand:allowance.remainingDemand??Infinity});
      if(!native.ready||order.reason)preview=block(preview,order.reason||native.reason);
      return {...order,volRemaining:order.quantity,volEntered:order.originalQuantity??null,preview};
    }),config};
  });
  Service.prototype.Handle_NpcMarketActivity=wrap(async(args,session,id)=>({activity:store.listActivity(id,100,{all:hasStaffAccountRole(session)}).map(row=>{
    const event={...row.details,...row,totalISK:row.details.grossISK};
    // Recovery entries describe an attempt, not another payment. Resolve their
    // current status from the durable operation while retaining their identity.
    if(row.kind==='recovery'&&store.db&&row.details.operationKey){
      const operation=store.db.prepare('SELECT state FROM nm_operations WHERE operation_key=?').get(row.details.operationKey);
      event.resolution=operation?.state||'pending';
    }
    return event;
  })}));
  Object.defineProperty(Service.prototype,"__npcMarketServiceV1",{value:true});
}
module.exports={clientText,parse,characterID,installService};
