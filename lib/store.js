"use strict";
const fs=require("node:fs"),path=require("node:path");
const {validateConfig,DEFAULTS}=require("./config");
function createStore(filename,{Database,root}={}) {
  if(!Database) Database=require(path.join(root||path.resolve(__dirname,"../../EveJS-v0.12.9"),"server/node_modules/better-sqlite3"));
  fs.mkdirSync(path.dirname(filename),{recursive:true});
  const db=new Database(filename);db.pragma("journal_mode = WAL");db.pragma("busy_timeout = 5000");
  db.exec(`CREATE TABLE IF NOT EXISTS nm_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS nm_quote_cache(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS nm_http_cache(url TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS nm_activity(id INTEGER PRIMARY KEY, timestamp INTEGER NOT NULL,
      character_id INTEGER,kind TEXT NOT NULL,message TEXT NOT NULL,details TEXT NOT NULL,
      operation_key TEXT UNIQUE);
    CREATE INDEX IF NOT EXISTS nm_activity_character ON nm_activity(character_id,id DESC);`);
  const metaGet=db.prepare("SELECT value FROM nm_meta WHERE key=?"),metaPut=db.prepare("INSERT INTO nm_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  if(!metaGet.get("config")) db.transaction(()=>{metaPut.run("config",JSON.stringify(DEFAULTS));metaPut.run("revision","1");})();
  // Migrate saved policies once. Pricing and batch choices survive; the
  // purchase interval is now fixed at fifteen minutes for every installation.
  db.transaction(()=>{
    const previous=JSON.parse(metaGet.get('config').value);
    if(Object.hasOwn(previous,'minimumOrders') || previous.intervalSeconds!==DEFAULTS.intervalSeconds || ['ironMode','randomBatch','minimumBatchPercent','offlinePurchases','useEveAveragePrices'].some(key=>!Object.hasOwn(previous,key))){
      // Start a fresh full interval when upgrading an old ten-minute schedule.
      // Pending settlement identities remain untouched and recover first.
      if(previous.intervalSeconds!==DEFAULTS.intervalSeconds && db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='nm_engine_meta'").get())
        db.prepare("DELETE FROM nm_engine_meta WHERE key='nextDueAt'").run();
      // A user's smaller existing maximum remains valid on upgrade.
      metaPut.run('config',JSON.stringify(validateConfig({...previous,intervalSeconds:DEFAULTS.intervalSeconds,
        minimumBatchPercent:previous.minimumBatchPercent??Math.min(DEFAULTS.minimumBatchPercent,previous.batchPercent??DEFAULTS.batchPercent)})));
      metaPut.run('revision',String(Number(metaGet.get('revision').value)+1));
    }
  })();
  function getConfig(){return validateConfig(JSON.parse(metaGet.get("config").value));}
  function getRevision(){return Number(metaGet.get("revision").value);}
  const saveConfig=db.transaction((input,expected)=>{
    if(expected!==getRevision()) throw Error("Policy changed in another window; reload before saving");
    const previous=getConfig(),config=validateConfig(input),revision=getRevision()+1;
    // Turning catch-up on starts from now; it cannot claim time while off.
    // Pause/resume likewise begins a fresh interval. Persist this with policy.
    if((previous.enabled!==config.enabled||previous.offlinePurchases!==config.offlinePurchases)&&
        db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='nm_engine_meta'").get())
      db.prepare("DELETE FROM nm_engine_meta WHERE key='nextDueAt'").run();
    metaPut.run("config",JSON.stringify(config));metaPut.run("revision",String(revision));return {config,revision};
  });
  function getJSON(table,keyColumn,key){const row=db.prepare(`SELECT value FROM ${table} WHERE ${keyColumn}=?`).get(key);return row?JSON.parse(row.value):null;}
  function putJSON(table,keyColumn,key,value){db.prepare(`INSERT INTO ${table}(${keyColumn},value) VALUES(?,?) ON CONFLICT(${keyColumn}) DO UPDATE SET value=excluded.value`).run(key,JSON.stringify(value));}
  const recordActivity=({kind,message,characterID=null,details={},operationKey=null,timestamp=Date.now()})=>{
    db.prepare("INSERT OR IGNORE INTO nm_activity(timestamp,character_id,kind,message,details,operation_key) VALUES(?,?,?,?,?,?)").run(timestamp,characterID,kind,String(message).slice(0,1000),JSON.stringify(details),operationKey);
    // History is permanent. Only a bounded page is sent to the client.
  };
  function listActivity(characterID,limit=100,{all=false}={}){
    limit=Math.max(1,Math.min(200,Math.floor(limit)||100));
    const rows=all?db.prepare("SELECT * FROM nm_activity ORDER BY timestamp DESC,id DESC LIMIT ?").all(limit):db.prepare("SELECT * FROM nm_activity WHERE character_id=? ORDER BY timestamp DESC,id DESC LIMIT ?").all(characterID,limit);
    return rows.map(row=>({...row,characterID:row.character_id,details:JSON.parse(row.details)}));
  }
  db.exec('CREATE INDEX IF NOT EXISTS nm_activity_time ON nm_activity(character_id,timestamp DESC,id DESC); CREATE INDEX IF NOT EXISTS nm_activity_all_time ON nm_activity(timestamp DESC,id DESC);');
  function activityPage(characterID,{scope='recent',cursor=null,all=false,now=Date.now()}={}){
    if(!['recent','archive'].includes(scope))throw Error('Invalid activity scope');
    if(cursor&&(!Number.isSafeInteger(cursor.at)||!Number.isSafeInteger(cursor.id)))throw Error('Invalid activity cursor');
    const owner=all?'1=1':'character_id=?',ownerArgs=all?[]:[characterID];
    // Recent = at most 500 entries, no older than 30 days. Everything else
    // remains in a browsable archive; there is no deletion or repeat copying.
    const boundary=db.prepare(`SELECT timestamp,id FROM nm_activity WHERE ${owner} ORDER BY timestamp DESC,id DESC LIMIT 1 OFFSET 499`).get(...ownerArgs);
    const recent='timestamp>=?'+(boundary?' AND (timestamp,id)>=(?,?)':'');
    const recentArgs=[now-30*86400000,...(boundary?[boundary.timestamp,boundary.id]:[])];
    const total=db.prepare(`SELECT COUNT(*) n FROM nm_activity WHERE ${owner}`).get(...ownerArgs).n;
    const recentCount=db.prepare(`SELECT COUNT(*) n FROM nm_activity WHERE ${owner} AND (${recent})`).get(...ownerArgs,...recentArgs).n;
    const filter=scope==='recent'?`(${recent})`:`NOT (${recent})`;
    const rows=db.prepare(`SELECT * FROM nm_activity WHERE ${owner} AND ${filter}
      ${cursor?'AND (timestamp,id)<(?,?)':''} ORDER BY timestamp DESC,id DESC LIMIT 101`).all(...ownerArgs,...recentArgs,...(cursor?[cursor.at,cursor.id]:[]));
    const more=rows.length>100;rows.length=Math.min(rows.length,100);
    const last=rows.at(-1);
    return {activity:rows.map(row=>({...row,characterID:row.character_id,details:JSON.parse(row.details)})),
      scope,total,recentCount,archiveCount:total-recentCount,
      nextCursor:more&&last?{at:last.timestamp,id:last.id}:null};
  }
  const statistics=require('./statistics').createStatistics(db);
  return {db,getConfig,getRevision,saveConfig,recordActivity,listActivity,activityPage,statistics,
    getQuote:key=>getJSON("nm_quote_cache","key",key),saveQuote:(key,value)=>putJSON("nm_quote_cache","key",key,value),
    getHTTP:url=>getJSON("nm_http_cache","url",url),saveHTTP:(url,value)=>putJSON("nm_http_cache","url",url,value),
    close:()=>db.close()};
}
module.exports={createStore};
