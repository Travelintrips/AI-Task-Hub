"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {runInNewContext}=require("node:vm");
const source=readFileSync(require("node:path").join(__dirname,"../../artifacts/api-server/src/routes/auth.ts"),"utf8");
function policy(user,devPasswordlessLoginEnabled){
 const start=source.indexOf("const privilegedRole = user != null");
 const end=source.indexOf("if (!user || !user.isActive",start);
 assert.ok(start>=0&&end>start,"production login policy missing");
 const snippet=source.slice(start,end)+"\n({privilegedRole,requirePassword})";
 return runInNewContext(snippet,{user,devPasswordlessLoginEnabled});
}
test("DEV never authorizes privileged roles by email alone",()=>{
 for(const role of ["super_admin","company_admin","owner","supervisor"]){
  const result=policy({role},true);
  assert.equal(result.privilegedRole,true,role);
  assert.equal(result.requirePassword,true,role);
 }
});
test("nonprivileged DEV passwordless legacy mode remains explicit and isolated",()=>{
 for(const role of ["staff","vendor","customer"]){
  assert.equal(policy({role},true).requirePassword,false);
  assert.equal(policy({role},false).requirePassword,true);
 }
});
test("production cannot enable legacy passwordless flag and privileged login checks password",()=>{
 assert.match(source,/!isProduction\s*&&\s*process\.env\.DEV_PASSWORDLESS_LOGIN === "true"/);
 assert.match(source,/if \(requirePassword\) \{[\s\S]*?if \(!password\)/);
 assert.match(source,/bcrypt\.compare\(password, user\.passwordHash\)/);
});
test("no caller-supplied privileged JWT is generated before authentication branch",()=>{
 const start=source.indexOf('router.post("/auth/login"');
 const sign=source.indexOf("const token = signToken",start);
 const check=source.indexOf("bcrypt.compare(password, user.passwordHash)",start);
 assert.ok(check>start&&sign>check);
});
