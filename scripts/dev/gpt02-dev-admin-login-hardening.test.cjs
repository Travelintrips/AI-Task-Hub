"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const source=readFileSync(require("node:path").join(__dirname,"../../artifacts/api-server/src/routes/auth.ts"),"utf8");
const gate=readFileSync(require("node:path").join(__dirname,"gpt02-new-test-admission-readonly.cjs"),"utf8");
test("existing DEV passwordless dashboard login remains enabled for all roles",()=>{
 assert.match(source,/process\.env\.DEV_PASSWORDLESS_LOGIN === "true"/);
 assert.match(source,/baseUrl === "https:\/\/dev-ai-task\.cstlogistic\.co\.id"/);
 assert.match(source,/if \(!user \|\| !user\.isActive \|\| \(!devPasswordlessLoginEnabled && !user\.passwordHash\)\)/);
 assert.match(source,/if \(!devPasswordlessLoginEnabled\) \{/);
 assert.doesNotMatch(source,/const privilegedRole = user != null/);
 assert.doesNotMatch(source,/Password required for this account/);
});
test("passwordless login never becomes GPT02 command approval",()=>{
 assert.match(gate,/superAdminSignatureValidated/);
 assert.match(gate,/issuerPermitted:false,dispatchPermitted:false/);
 assert.match(gate,/creationPermitted:false/);
});
test("regular password login continues to validate credentials when DEV flag is off",()=>{
 assert.match(source,/bcrypt\.compare\(password!, user\.passwordHash\)/);
 const auth=source.slice(source.indexOf('router.post("/auth/login"'),source.indexOf('// ─── Google Sign-In'));
 assert.ok(auth.indexOf("bcrypt.compare") < auth.indexOf("const token = signToken"));
});
