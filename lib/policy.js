"use strict";
// This is the single pricing/chance implementation used by both the client
// advisory RPC and the authoritative buying scheduler.
function priceChance(pricePercent, config) {
  if (pricePercent>config.maxPricePercent) return 0;
  const points=[[0,95],[60,85],[80,70],[90,55],[100,35],[110,20],[120,8]];
  if (config.maxPricePercent>120) points.push([config.maxPricePercent,3]);
  let chance=0;
  for (let i=1;i<points.length;i++) if (pricePercent<=points[i][0]) {
    const [x,y]=points[i-1],[xx,yy]=points[i];
    chance=y+(yy-y)*(pricePercent-x)/(xx-x);break;
  }
  chance=Math.min(95,Math.max(0,chance*config.chanceAtReference/35));
  return chance;
}
function batchRange(quantity,config,cap=quantity){
  const maximum=Math.max(0,Math.min(quantity,cap,Math.max(1,Math.floor(quantity*config.batchPercent/100))));
  const minimum=config.randomBatch?Math.min(maximum,Math.max(1,Math.floor(quantity*config.minimumBatchPercent/100))):maximum;
  return {minimum,maximum};
}
function batchQuantity({quantity,config,draw,cap=quantity}){
  if(!Number.isFinite(draw)||draw<0||draw>=1)throw Error('Invalid batch random sample');
  const {minimum,maximum}=batchRange(quantity,config,cap);
  if(!config.randomBatch||minimum===maximum)return maximum;
  // Log-uniform whole units: small retail batches are more common than bulk
  // buys, while each order of magnitude still gets a meaningful share.
  return Math.min(maximum,Math.max(minimum,Math.floor(minimum*Math.pow((maximum+1)/minimum,draw))));
}
function evaluate({price,quantity,quote,config,now=Date.now(),availableISK=Infinity,remainingDemand=Infinity}) {
  const result={eligible:false,chancePercent:0,baseChancePercent:0,referencePrice:null,
    pricePercent:null,warning:"unavailable",message:"Fair price reference unavailable",maxQuantity:0,minQuantity:0,
    quoteAgeSeconds:null,referenceKind:quote?.referenceKind||(config.useEveAveragePrices?"eve_average":"hub_orders"),reason:config.useEveAveragePrices?"missing_average":"missing_quote"};
  if (!Number.isFinite(price)||price<=0||!Number.isSafeInteger(quantity)||quantity<=0) return {...result,reason:"invalid_order",message:"Enter a positive price and whole-number quantity"};
  if (!quote || !Number.isFinite(quote.referencePrice) || quote.referencePrice<=0) return result;
  result.referencePrice=quote.referencePrice;
  result.pricePercent=Math.round(price/quote.referencePrice*1e8)/1e6;
  result.quoteAgeSeconds=Math.max(0,(now-quote.updatedAt)/1000);
  const blocked=(reason,message)=>({...result,reason,message,warning:"unavailable"});
  if (!Number.isFinite(quote.updatedAt)||quote.updatedAt>now+60000||result.quoteAgeSeconds>config.maxQuoteAgeSeconds) return blocked("stale_quote","Price reference is stale; NPC purchases paused for this item");
  if (quote.confidence!=="high") return blocked("thin_market","No reliable price reference; NPC purchases paused for this item");
  if (!config.enabled) return blocked("disabled","NPC purchases are paused by the server owner");
  if (result.pricePercent>config.maxPricePercent) return {...result,reason:"price_cap",warning:"high",message:`${(result.pricePercent-100).toFixed(1)}% above reference; NPCs will not buy above ${config.maxPricePercent}% of reference`};
  result.baseChancePercent=priceChance(result.pricePercent,config);
  // TQ provides a price reference. Unlimited mode never imports its trading-volume
  // quota or the optional institutional spending limits into a private market.
  const dailyDemand=config.ironMode?quantity:Math.min(Math.floor(Math.max(0,Number(quote.dailyVolume)||0)*config.tqDailyVolumePercent/100),remainingDemand??Infinity);
  const affordable=config.ironMode?quantity:Number.isFinite(availableISK)?Math.floor(Math.max(0,availableISK)/price):quantity;
  result.maxQuantity=Math.max(0,Math.min(quantity,Math.max(1,Math.floor(quantity*config.batchPercent/100)),dailyDemand,affordable));
  result.minQuantity=batchRange(quantity,config,result.maxQuantity).minimum;
  result.randomBatch=config.randomBatch;
  if (result.maxQuantity<1) return {...result,reason:dailyDemand<1?"demand_limit":"budget_limit",warning:"unavailable",
    message:dailyDemand<1?"Limited mode: daily item quota exhausted; enable Unlimited mode to remove this limit":"Limited mode: remaining NPC budget cannot buy one unit"};
  result.eligible=result.baseChancePercent>0;
  result.chancePercent=result.baseChancePercent;
  result.reason=result.eligible?"eligible":"zero_chance";
  result.warning=result.pricePercent>config.warnAbovePercent?"high":result.pricePercent<config.warnBelowPercent?"low":"fair";
  result.message=result.warning==="high"?`${(result.pricePercent-100).toFixed(1)}% above reference; reduced NPC purchase chance`:
    result.warning==="low"?`${(100-result.pricePercent).toFixed(1)}% below reference; check your price before selling`:
    "Within the configured reference price range";
  return result;
}
module.exports={evaluate,priceChance,batchRange,batchQuantity};
