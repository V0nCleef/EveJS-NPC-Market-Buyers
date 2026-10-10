"use strict";
// Read the same native bid book and range rules as Sell -> Immediate. Only
// seeded NPC bids are trusted: a player's own buy order cannot set fair value.
function createLocalQuoteProvider({marketDaemonClient,getStationRecord,getStationSolarSystemID,
  isBidOrderInRange,hasPendingMarketFillSagaForOrder=()=>false}={}) {
  return async function localQuote(typeID,{stationID,quantity}={}) {
    if(!Number.isSafeInteger(typeID)||typeID<=0||!Number.isSafeInteger(stationID)||stationID<=0||
        !Number.isSafeInteger(quantity)||quantity<=0)return null;
    const station=getStationRecord(stationID),regionID=Number(station?.regionID??station?.regionId);
    if(!Number.isSafeInteger(regionID)||regionID<=0)return null;
    const solarSystemID=getStationSolarSystemID(stationID);
    const book=await marketDaemonClient.call('GetOrders',{region_id:regionID,type_id:typeID});
    if(book?.type_id!==typeID||book.region_id!==regionID||!Array.isArray(book.buys))return null;
    const bids=book.buys.filter(row=>{
      if(row.type_id!==typeID||row.region_id!==regionID||row.bid!==true||row.source!=='seed'||
          !Number.isFinite(row.price)||row.price<=0||!Number.isSafeInteger(row.vol_remaining)||row.vol_remaining<=0||
          !Number.isSafeInteger(row.min_volume)||row.min_volume<=0||hasPendingMarketFillSagaForOrder(row.order_id)||
          !isBidOrderInRange(row,stationID,solarSystemID))return false;
      const fillable=Math.min(quantity,row.vol_remaining);
      return fillable>=row.min_volume||row.vol_remaining<row.min_volume&&fillable>=row.vol_remaining;
    }).sort((a,b)=>b.price-a.price||a.station_id-b.station_id||String(a.order_id).localeCompare(String(b.order_id)));
    const bid=bids[0];
    return bid?{typeID,referencePrice:bid.price,offerOrderID:String(bid.order_id),
      offerStationID:bid.station_id,localStationID:stationID,regionID,source:'EveJS NPC buy offer'}:null;
  };
}
module.exports={createLocalQuoteProvider};
