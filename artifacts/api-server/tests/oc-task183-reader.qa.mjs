import { build } from "esbuild";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "src/routes/oc-task183-reader.ts");
const outfile = path.join(root, ".oc-reader-qa-bundle.mjs");
const require = createRequire(import.meta.url);
const express = require("express");
const mock = {
  name: "qa-virtual-db",
  setup(b) {
    b.onResolve({filter:/^@workspace\/db$/},()=>({path:"db",namespace:"qa"}));
    b.onResolve({filter:/^drizzle-orm$/},()=>({path:"orm",namespace:"qa"}));
    b.onResolve({filter:/^\.\.\/lib\/logger$/},()=>({path:"logger",namespace:"qa"}));
    b.onLoad({filter:/.*/,namespace:"qa"},args => ({
      contents: args.path==="db"
        ? 'export const aiTasksTable = {kind:"task"}; export const aiExecutionJobsTable={kind:"jobs"}; export const db={select:()=>({from:(table)=>({where:()=>({limit:async()=>table.kind==="task"?[{id:183,companyId:"default",taskNumber:"WA-2611-7669",title:"test",status:"new_inquiry",assignedTo:"Admin",assignedToId:5}]:[]})})})};'
        : args.path==="orm" ? 'export const eq=(a,b)=>({a,b});export const and=(...x)=>x;'
        : 'export const logger={info(){},warn(){},error(){}};',
      loader:"js"
    }));
  }
};
await build({entryPoints:[source],outfile,bundle:true,platform:"node",format:"esm",packages:"external",plugins:[mock],logLevel:"silent"});
const router = (await import("file://"+outfile+"?qa=1")).default;
const app = express();app.use("/api",router);
const srv = app.listen(0,"127.0.0.1");
await new Promise(r=>srv.once("listening",r));
const port=srv.address().port, url="http://127.0.0.1:"+port+"/api/integrations/oc-dev/task/183";
const token="qa-only-32-char-secret-not-for-runtime-0001";
process.env.APP_ENV="development";process.env.NODE_ENV="development";
process.env.OC_DEV_TASK183_READER_SHA256=createHash("sha256").update(token).digest("hex");
async function req(method,auth){return fetch(url,{method,headers:auth?{Authorization:"Bearer "+auth}:{}})}
try{
 assert.equal((await req("GET")).status,401);
 assert.equal((await req("GET","incorrect-token-that-is-long-enough-123")).status,401);
 assert.equal((await req("POST",token)).status,405);
 assert.equal((await req("PATCH",token)).status,405);
 assert.equal((await req("DELETE",token)).status,405);
 const ok=await req("GET",token);assert.equal(ok.status,200);
 const body=await ok.json();assert.equal(body.task.id,183);
 assert.equal(body.task.taskNumber,"WA-2611-7669");assert.deepEqual(body.jobs,[]);
 assert.equal(body.scope,"task:183:read");
 process.env.APP_ENV="production";assert.equal((await req("GET",token)).status,404);
 process.env.APP_ENV="development";delete process.env.OC_DEV_TASK183_READER_SHA256;
 assert.equal((await req("GET",token)).status,401);
 console.log("OC_TASK183_READER_QA_PASS 8/8");
}finally{srv.close();fs.rmSync(outfile,{force:true})}
