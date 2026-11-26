"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {spawnSync}=require("node:child_process");
const path=require("node:path");
const script=path.join(__dirname,"gpt02-hub-db-static-access-inventory.cjs");
function audit(){
 const p=spawnSync(process.execPath,[script],{encoding:"utf8",timeout:20000,maxBuffer:4e6});
 assert.equal(p.status,0,p.stderr);
 return JSON.parse(p.stdout);
}
test("inventory covers declared Drizzle tables and reports raw SQL uncertainty",()=>{
 const r=audit();
 assert.equal(r.mode,"STATIC_SOURCE_ONLY");
 assert.ok(r.scanned.schemaFiles>=40);
 assert.ok(r.scanned.apiFiles>=150);
 assert.ok(r.scanned.declaredTableExports>=80);
 assert.ok(r.scanned.candidateTableReferences>=50);
 assert.ok(r.scanned.rawSchemaIdentifiers>0);
 assert.ok(r.scanned.databaseCallCounts.execute>0);
 assert.ok(r.scanned.databaseCallCounts.insert>0);
 assert.ok(r.scanned.databaseCallCounts.update>0);
 assert.ok(r.tables.every(t=>t.schema===undefined&&t.table.startsWith("public.")));
});
test("static inventory is never authorization for an app DB cutover or GPT02 native issuer",()=>{
 const r=audit();
 assert.equal(r.conclusion.releaseDecision,"NO_GO");
 assert.equal(r.conclusion.dbCutoverPermitted,false);
 assert.equal(r.conclusion.issuerPermitted,false);
 assert.equal(r.conclusion.nativeDispatchPermitted,false);
 for(const x of ["dynamicSqlChecked","routinesTriggersSequencesChecked",
  "schemaAndCrossTenantRlsChecked","authenticatedEndToEndChecked"])
  assert.equal(r.coverage[x],false,x);
 assert.equal(r.coverage.readOnly,true);
});
