import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {readDevGoogleCallback,devGoogleFailureMessage,devGoogleCallbackErrorMessage,CST_DEV_HOST} from "../../artifacts/ai-task-center/src/lib/dev-google-handoff.ts";
test("DEV root callback errors and code are recognized; other hosts and routes are unchanged",()=>{
 const dev=CST_DEV_HOST;
 assert.equal(readDevGoogleCallback("ai-task.cstlogistic.co.id","/","#access_token=fixture","?error=denied"),null);
 assert.equal(readDevGoogleCallback(dev,"/bridge-jobs","","?code=fixture"),null);
 assert.equal(readDevGoogleCallback(dev,"/","","?job=fixture"),null);
 assert.deepEqual(readDevGoogleCallback(dev,"/","#access_token=fixture",""),{accessToken:"fixture",error:null,code:null});
 assert.equal(readDevGoogleCallback(dev,"/","#error=denied","").error,"denied");
 assert.equal(readDevGoogleCallback(dev,"/login","","?code=fixture").code,"fixture");
});
test("display messages are bounded and do not echo provider secrets",()=>{
 for(const err of [new Error("not registered fixture-secret"),new Error("invalid supabase session fixture-secret"),new Error("fixture-secret")]){
  assert.ok(!devGoogleFailureMessage(err).includes("fixture-secret"));
 }
 assert.ok(!devGoogleCallbackErrorMessage({accessToken:null,error:"fixture-secret",code:null}).includes("fixture-secret"));
});
test("canonical login preserves early and final scrub, Google-only DEV and single in-flight exchange",()=>{
 const read=p=>readFileSync(new URL("../../artifacts/ai-task-center/src/"+p,import.meta.url),"utf8");
 const ctx=read("contexts/auth-context.tsx"),login=read("pages/login.tsx");
 assert.ok(ctx.indexOf("window.history.replaceState(")<ctx.indexOf("devExchange.current ??= apiGoogleLogin("));
 assert.match(ctx,/await apiGoogleLogin\(supabaseAccessToken\)/);
 assert.match(ctx,/callback.error \|\| callback.code/);
 assert.match(ctx,/clearAuth\(\); setToken\(null\); setUser\(null\)/);
 assert.match(ctx,/devCallback.current = null; devExchange.current = null/);
 assert.match(ctx,/window.location.hash.includes\("access_token="\)/);
 assert.match(login,/isDevPasswordless && googleLoginError/);
 assert.match(login,/\{!isDevPasswordless && \(<>/);
 assert.match(login,/window.location.assign\("\/api\/auth\/google\/start"\)/);
});
