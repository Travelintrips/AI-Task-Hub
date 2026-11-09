#!/usr/bin/env node
/**
 * Static, conservative DB access inventory for the AI Task DEV restricted-login
 * migration. Does NOT grant any privilege or claim coverage of dynamic SQL.
 * Exit 0 means the audit ran; never means cutover can proceed.
 */
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"../..");
const walk=(dir)=>fs.existsSync(dir)?fs.readdirSync(dir,{withFileTypes:true})
 .flatMap(x=>x.isDirectory()?walk(path.join(dir,x.name)):x.isFile()&&/\.(ts|tsx|js|mjs)$/.test(x.name)?[path.join(dir,x.name)]:[]):[];
const schemaFiles=walk(path.join(root,"lib/db/src/schema")).filter(x=>x.endsWith(".ts"));
const apiFiles=walk(path.join(root,"artifacts/api-server/src"));
const tableDefinitions=new Map();
for(const f of schemaFiles){
 const src=fs.readFileSync(f,"utf8");
 const rx=/\b(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:(?:\w+)\.)?pgTable\s*\(\s*["'`](\w+)["'`]/g;
 for(const m of src.matchAll(rx)){
  if(tableDefinitions.has(m[1])&&tableDefinitions.get(m[1]).name!==m[2])throw Error("AMBIGUOUS_TABLE_EXPORT:"+m[1]);
  tableDefinitions.set(m[1],{name:m[2],schema:"public",definition:path.relative(root,f)});
 }
}
const operations=new Map();
const unknown=new Set();
const raw=new Set();
const kindRx=/\b(?:db|tx|transaction|trx)\.(select|insert|update|delete|execute|transaction)\s*\(/g;
const boundRx=/\.\s*(?:from|join|leftJoin|rightJoin|innerJoin|fullJoin|insert|update|delete)\s*\(\s*(\w+Table)\s*\)/g;
const rawSchemaRx=/\b(public|ai_platform|fleet|sport_center)\.([a-z_][a-z0-9_]*)\b/g;
for(const f of apiFiles){
 const src=fs.readFileSync(f,"utf8"),relative=path.relative(root,f);
 for(const m of src.matchAll(kindRx)){
  const key=m[1];operations.set(key,(operations.get(key)||0)+1);
 }
 for(const m of src.matchAll(boundRx)){
  if(tableDefinitions.has(m[1]))continue;
  unknown.add(m[1]+" @ "+relative);
 }
 for(const m of src.matchAll(rawSchemaRx))raw.add(m[1]+"."+m[2]);
}
const referenced=new Map();
for(const f of apiFiles){
 const src=fs.readFileSync(f,"utf8");
 for(const [symbol,definition] of tableDefinitions){
  // Conservative: symbol anywhere in source, not proof that it is queried.
  if(new RegExp("\\b"+symbol+"\\b").test(src)){
   const key=definition.schema+"."+definition.name;
   if(!referenced.has(key))referenced.set(key,{table:key,files:0,operations:"UNKNOWN",definition:definition.definition});
   referenced.get(key).files++;
  }
 }
}
const report={schemaVersion:1,environment:"DEV",mode:"STATIC_SOURCE_ONLY",
 gitCommit:process.env.GITHUB_SHA||null,
 scanned:{schemaFiles:schemaFiles.length,apiFiles:apiFiles.length,declaredTableExports:tableDefinitions.size,
 candidateTableReferences:referenced.size,databaseCallCounts:Object.fromEntries([...operations].sort()),
 unresolvedTableSymbols:unknown.size,rawSchemaIdentifiers:raw.size},
 tables:[...referenced.values()].sort((a,b)=>a.table.localeCompare(b.table)),
 rawIdentifiers:[...raw].sort(),unresolvedSymbols:[...unknown].sort(),
 coverage:{dynamicSqlChecked:false,queryPlansChecked:false,routinesTriggersSequencesChecked:false,
  schemaAndCrossTenantRlsChecked:false,authenticatedEndToEndChecked:false,readOnly:true},
 conclusion:{dbCutoverPermitted:false,issuerPermitted:false,nativeDispatchPermitted:false,
  releaseDecision:"NO_GO",reason:"STATIC_INVENTORY_NOT_FULL_PRIVILEGE_OR_AUTHORIZED_E2E"}},
};
if(process.argv.includes("--summary")){
 process.stdout.write(JSON.stringify({scanned:report.scanned,coverage:report.coverage,conclusion:report.conclusion})+"\n");
}else process.stdout.write(JSON.stringify(report,null,2)+"\n");
