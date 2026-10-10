"use strict";
const USER_AGENT="EveJS-NPC-Market-Buyers/0.1.10 (+https://github.com/V0nCleef)";
const BASE="https://esi.evetech.net/latest";
function depthPrice(orders,stationID,typeID) {
  const rows=orders.filter(o=>(typeID===undefined||o.type_id===typeID)&&o.location_id===stationID&&o.is_buy_order===false&&Number.isFinite(o.price)&&o.price>0&&Number.isSafeInteger(o.volume_remain)&&o.volume_remain>0).sort((a,b)=>a.price-b.price);
  if(!rows.length) return {referencePrice:null,orders:0};
  const volume=rows.reduce((sum,o)=>sum+o.volume_remain,0);if(!Number.isSafeInteger(volume))return {referencePrice:null,orders:rows.length};
  const target=Math.max(1,Math.ceil(volume*.05));let remaining=target,value=0;
  for(const row of rows){const used=Math.min(remaining,row.volume_remain);value+=used*row.price;remaining-=used;if(remaining===0)break;}
  return {referencePrice:value/target,orders:rows.length,depthVolume:target};
}
function historyStats(history,days,now) {
  const today=new Date(now).toISOString().slice(0,10),start=new Date(now-days*86400000).toISOString().slice(0,10);
  const rows=history.filter(row=>row.date>=start&&row.date<today&&Number.isFinite(row.average)&&row.average>0&&Number.isFinite(row.volume)&&row.volume>=0);
  const volume=rows.reduce((s,r)=>s+r.volume,0),value=rows.reduce((s,r)=>s+r.average*r.volume,0);
  return {dailyVolume:volume/days,historyPrice:volume>0?value/volume:null,historyDays:rows.length};
}
function createQuoteProvider({store,fetchImpl=globalThis.fetch,clock=Date.now,localQuote}={}) {
  const flights=new Map(),httpFlights=new Map(),localFlights=new Map(),localCache=new Map(),resourceBackoff=new Map();let closed=false,active=0,nextRequestAt=0;const waiters=[];
  async function slot(){if(active>=2)await new Promise(resolve=>waiters.push(resolve));else active++;return ()=>{const next=waiters.shift();if(next)next();else active--;};}
  function resource(url,minimumCacheSeconds,maximumRows=10000) {
    if(httpFlights.has(url))return httpFlights.get(url);
    const flight=loadResource(url,minimumCacheSeconds,maximumRows).finally(()=>httpFlights.delete(url));
    httpFlights.set(url,flight);return flight;
  }
  async function loadResource(url,minimumCacheSeconds,maximumRows) {
    if(closed)throw Error("Quote provider is closed");
    const now=clock(),cached=store.getHTTP(url);
    if(cached?.expiresAt>now)return cached;
    if(nextRequestAt>now||resourceBackoff.get(url)>now)throw Error("ESI requests are backing off");
    const release=await slot();
    try{
      if(closed)throw Error("Quote provider is closed");
      if(nextRequestAt>clock()||resourceBackoff.get(url)>clock())throw Error("ESI requests are backing off");
      const headers={"User-Agent":USER_AGENT,"X-Compatibility-Date":"2026-10-09"};
      if(cached?.etag)headers["If-None-Match"]=cached.etag;
      const response=await fetchImpl(url,{headers,signal:AbortSignal.timeout(15000)});
      if(response.status===429||response.status===420){const retry=Math.max(60,Number(response.headers.get("retry-after"))||300);nextRequestAt=clock()+retry*1000;throw Error("ESI rate limit; retry scheduled");}
      // An unavailable hub endpoint must not prevent trying the independent
      // average endpoint. Actual rate limits still pause every ESI request.
      if(!response.ok&&response.status!==304){resourceBackoff.set(url,clock()+60000);throw Error(`ESI returned ${response.status}`);}
      if(response.status===304&&!cached)throw Error("ESI returned 304 without a cached response");
      const body=response.status===304?cached.body:await response.json();
      if(!Array.isArray(body)||body.length>maximumRows)throw Error("Unexpected or oversized ESI market response");
      const expires=Date.parse(response.headers.get("expires"));
      const result={body,expiresAt:Math.max(clock()+minimumCacheSeconds*1000,Number.isFinite(expires)?expires:0),
        checkedAt:clock(),etag:response.headers.get("etag")||cached?.etag||null,
        modified:response.headers.get("last-modified")||cached?.modified||null,
        pages:Number(response.headers.get("x-pages"))||cached?.pages||1};
      store.saveHTTP(url,result);return result;
    } finally{release();}
  }
  // Switching sources must never reuse a quote priced under the other mode.
  const key=(id,c)=>`v5:${c.useEveAveragePrices?'average':'hub'}:${c.referenceRegionID}:${c.referenceStationID}:${id}:${c.historyLookbackDays}:${c.ironMode?'unlimited':'limited'}`;
  const fresh=(quote,c)=>quote&&Number.isFinite(quote.updatedAt)&&quote.updatedAt<=clock()+60000&&clock()-quote.updatedAt<=c.maxQuoteAgeSeconds*1000;
  const usable=(quote,c)=>quote?.confidence==='high'&&Number.isFinite(quote.referencePrice)&&quote.referencePrice>0&&fresh(quote,c);
  const localKey=(id,c,context)=>`${key(id,c)}:local:${context?.stationID}:${context?.quantity}`;
  async function online(typeID,config) {
    if(!Number.isSafeInteger(typeID)||typeID<=0)throw Error("Invalid market type ID");
    const cacheKey=key(typeID,config),previous=store.getQuote(cacheKey);
    if(previous?.typeID===typeID&&previous.expiresAt>clock()&&fresh(previous,config)&&
        (usable(previous,config)||previous.confidence==='unavailable'&&previous.referencePrice===null))return previous;
    if(flights.has(cacheKey))return flights.get(cacheKey);
    const flight=(async()=>{
      const errors=[];
      try{
        const pages=[];
        if(!config.useEveAveragePrices){
         try{
          const ordersURL=`${BASE}/markets/${config.referenceRegionID}/orders/?order_type=sell&type_id=${typeID}`;
          const first=await resource(ordersURL,300);if(first.pages>20)throw Error("Item has too many market pages for a bounded quote");
          pages.push(first);
          for(let p=2;p<=first.pages;p++)pages.push(await resource(`${ordersURL}&page=${p}`,300));
          if(pages.some(p=>p.modified&&first.modified&&p.modified!==first.modified))throw Error("Market changed during pagination; retry next check");
         }catch(error){pages.length=0;errors.push(String(error.message).slice(0,200));}
        }
        const depth=depthPrice(pages.flatMap(p=>p.body),config.referenceStationID,typeID);
        let referencePrice=null,referenceKind=config.useEveAveragePrices?'eve_average':'hub_orders',pricingResources=[];
        let stats={dailyVolume:0,historyPrice:null,historyDays:0},historyError;
        if(!config.useEveAveragePrices||!config.ironMode){
          try{
            const history=await resource(`${BASE}/markets/${config.referenceRegionID}/history/?type_id=${typeID}`,3600);
            stats=historyStats(history.body,config.historyLookbackDays,clock());
          }catch(error){historyError=String(error.message).slice(0,200);}
        }
        // An absurd ask is not a usable reference. Reject it before displaying
        // a number, then continue the same fallback chain as an empty book.
        const sane=Number.isFinite(depth.referencePrice)&&depth.referencePrice>0&&(!stats.historyPrice||
          depth.referencePrice/stats.historyPrice>=.25&&depth.referencePrice/stats.historyPrice<=3);
        const currentHub=sane&&pages.every(p=>fresh({updatedAt:p.checkedAt},config));
        if(!config.useEveAveragePrices&&currentHub){referencePrice=depth.referencePrice;pricingResources=pages;}
        if(referencePrice===null){
          try{
            // adjusted_price is an industry valuation, never a selling price.
            const prices=await resource(`${BASE}/markets/prices/`,3600,50000);
            const entry=prices.body.find(row=>row.type_id===typeID);
            if(Number.isFinite(entry?.average_price)&&entry.average_price>0&&fresh({updatedAt:prices.checkedAt},config)){
              referencePrice=entry.average_price;referenceKind='eve_average';pricingResources=[prices];
            }
          }catch(error){errors.push(String(error.message).slice(0,200));}
        }
        // Keep the average's own timestamp, but retry the preferred hub on
        // its five-minute cache boundary. An hourly average must not pin the
        // whole TQ-mode quote to that fallback for an hour.
        const hubRecheckAt=!config.useEveAveragePrices&&referenceKind!=='hub_orders'?
          Math.min(clock()+300000,...pages.map(p=>p.expiresAt)):null;
        const quote={typeID,...depth,...stats,referencePrice,referenceKind,
          confidence:referencePrice>0?'high':'unavailable',
          updatedAt:pricingResources.length?Math.min(...pricingResources.map(p=>p.checkedAt)):clock(),
          expiresAt:Math.min(hubRecheckAt??Infinity,pricingResources.length?Math.min(...pricingResources.map(p=>Math.min(p.expiresAt,p.checkedAt+config.maxQuoteAgeSeconds*1000))):clock()+60000),
          ...(hubRecheckAt!==null?{hubRecheckAt}:{}),
          source:"CCP ESI",regionID:config.referenceRegionID,stationID:config.referenceStationID,...(historyError?{historyError}:{}),
          ...(errors.length?{error:errors.join('; ').slice(0,500)}:{}),
          ...(!config.useEveAveragePrices&&depth.referencePrice>0&&!currentHub?{rejectedHubPrice:depth.referencePrice}:{})};
        store.saveQuote(cacheKey,quote);return quote;
      }catch(error){return {typeID,referencePrice:null,orders:0,dailyVolume:0,confidence:"unavailable",updatedAt:clock(),error:String(error.message).slice(0,200),source:"CCP ESI"};}
    })().finally(()=>flights.delete(cacheKey));flights.set(cacheKey,flight);return flight;
  }
  async function get(typeID,config,context){
    const quote=await online(typeID,config);
    if(usable(quote,config)||typeof localQuote!=='function')return quote;
    if(!Number.isSafeInteger(context?.stationID)||context.stationID<=0||!Number.isSafeInteger(context.quantity)||context.quantity<=0)return quote;
    const cacheKey=localKey(typeID,config,context),cached=localCache.get(cacheKey);
    if(cached?.expiresAt>clock()&&fresh(cached,config))return cached;
    if(localFlights.has(cacheKey))return localFlights.get(cacheKey);
    const flight=(async()=>{
      let result=quote;
      try{
        const local=await localQuote(typeID,context);
        if(local?.typeID===typeID&&local.localStationID===context.stationID&&Number.isFinite(local.referencePrice)&&local.referencePrice>0)
          result={...quote,...local,referenceKind:'local_buy_order',confidence:'high',updatedAt:clock()};
      }catch(error){result={...quote,localError:String(error.message).slice(0,200)};}
      result={...result,expiresAt:clock()+30000};
      if(localCache.size>=200)localCache.delete(localCache.keys().next().value);
      localCache.set(cacheKey,result);return result;
    })().finally(()=>localFlights.delete(cacheKey));localFlights.set(cacheKey,flight);return flight;
  }
  function peek(id,c,context){
    const quote=store.getQuote(key(id,c));
    if(quote?.typeID===id&&usable(quote,c))return quote;
    const local=localCache.get(localKey(id,c,context));
    if(local?.expiresAt>clock()&&fresh(local,c))return local;
    return quote?.typeID===id?(usable(quote,c)||quote.referencePrice===null?quote:{...quote,referencePrice:null,confidence:'unavailable'}):null;
  }
  return {get,peek,close(){closed=true;localCache.clear();},status:()=>({requestsInFlight:active,nextRequestAt})};
}
module.exports={USER_AGENT,depthPrice,historyStats,createQuoteProvider};
