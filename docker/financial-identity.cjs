"use strict";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const current=require("./financial-source-identity.json"),legacy=require("../lib/financialAbiIdentities.json");
const names=Object.keys(current.files).sort(),sha=bytes=>crypto.createHash("sha256").update(bytes).digest("hex");
function fingerprint(files){return sha(JSON.stringify(Object.fromEntries(names.map(name=>[name,files[name]]))));}
function knownFingerprints(){return [fingerprint(current.files),...legacy.predecessors.map(row=>fingerprint(row.files))];}
function identity(modRoot,{version,currentPackage=false}={}){
  if(current.schemaVersion!==1||current.protocol!==legacy.protocol)throw Error("Unsupported financial source identity contract");
  const own=require("../package.json").version;
  const expected=currentPackage||[current.baselineVersion,own].includes(version)?current.files
    :legacy.predecessors.find(row=>row.versions.includes(version))?.files;
  if(!expected)throw Error("No reviewed predecessor financial ABI for version "+version);
  const hashes={};
  for(const name of names){
    const file=path.join(modRoot,"lib",name),info=fs.lstatSync(file);
    if(!info.isFile()||info.isSymbolicLink())throw Error("Financial source is not a regular package file");
    hashes[name]=sha(fs.readFileSync(file));
    if(hashes[name]!==expected[name])throw Error("Unrecognized predecessor financial source: "+name);
  }
  return fingerprint(hashes);
}
module.exports={identity,knownFingerprints};
