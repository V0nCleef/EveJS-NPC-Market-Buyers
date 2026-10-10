"use strict";
const BUY_INTERVAL_SECONDS = 900;
const DEFAULTS = Object.freeze({
  enabled: true, ironMode: true, offlinePurchases: false, useEveAveragePrices: false, intervalSeconds: BUY_INTERVAL_SECONDS, chanceAtReference: 35,
  maxPricePercent: 125, warnAbovePercent: 110, warnBelowPercent: 80,
  dailyBudgetISK: 250000000, sellerDailyBudgetISK: 50000000,
  cycleBudgetISK: 25000000, batchPercent: 10, randomBatch: true, minimumBatchPercent: 0.01, tqDailyVolumePercent: 0.1,
  maxQuoteAgeSeconds: 3600, referenceRegionID: 10000002,
  referenceStationID: 60003760, historyLookbackDays: 7,
});
const ranges = {
  chanceAtReference: [0,95], maxPricePercent: [100,200],
  warnAbovePercent: [100,200], warnBelowPercent: [1,100],
  dailyBudgetISK: [0,1e12], sellerDailyBudgetISK: [0,1e12],
  cycleBudgetISK: [0,1e12], batchPercent: [0.01,100], minimumBatchPercent: [0.0001,100],
  tqDailyVolumePercent: [0.00001,10], maxQuoteAgeSeconds: [300,86400],
  referenceRegionID: [1,2147483647], referenceStationID: [1,Number.MAX_SAFE_INTEGER],
  historyLookbackDays: [1,30],
};
const integerKeys = new Set(["maxQuoteAgeSeconds","referenceRegionID","referenceStationID","historyLookbackDays"]);
function validateConfig(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw Error("Buying policy must be an object");
  // Accept old saved/RPC policies, but never retain the removed order-count gate.
  const {minimumOrders: obsoleteMinimum, ...current} = input;
  input = current;
  for (const key of Object.keys(input)) if (!Object.hasOwn(DEFAULTS,key)) throw Error(`Unknown buying policy setting: ${key}`);
  const result = {...DEFAULTS,...input};
  for (const key of ['enabled','ironMode','randomBatch','offlinePurchases','useEveAveragePrices']) if (typeof result[key] !== "boolean") throw Error(`${key} must be true or false`);
  if (result.intervalSeconds !== BUY_INTERVAL_SECONDS) throw Error("Check interval must be 900 seconds; it is fixed");
  for (const [key,[min,max]] of Object.entries(ranges)) {
    const value=result[key];
    if (typeof value!=="number" || !Number.isFinite(value) || value<min || value>max || (integerKeys.has(key)&&!Number.isSafeInteger(value))) throw Error(`Invalid ${key}: expected ${min} to ${max}`);
  }
  if (result.warnAbovePercent>result.maxPricePercent) throw Error("Warning threshold cannot exceed the NPC price cap");
  if (result.randomBatch && result.minimumBatchPercent>result.batchPercent) throw Error('Minimum batch cannot exceed the maximum batch');
  return result;
}
module.exports={DEFAULTS,validateConfig,BUY_INTERVAL_SECONDS};
