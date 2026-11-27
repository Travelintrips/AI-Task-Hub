import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {readDevGoogleCallback,devGoogleFailureMessage,devGoogleCallbackErrorMessage,CST_DEV_HOST} from "../../artifacts/ai-task-center/src/lib/dev-google-handoff.ts";
function readCallback(host, pathname, hash, search) {
 const fragment = new URLSearchParams(hash.replace(/^#/, ""));
 return readDevGoogleCallback(host, pathname, fragment.get("access_token"), fragment.get("error"), search);
}
test("DEV root callback errors and code are recognized; other hosts and routes are unchanged",()=>{
 const dev=CST_DEV_HOST;
 assert.equal(readCallback("ai-task.cstlogistic.co.id","/","#access_token=fixture","?error=denied"),null);
 assert.equal(readCallback(dev,"/bridge-jobs","","?code=fixture"),null);
 assert.equal(readCallback(dev,"/","","?job=fixture"),null);
 assert.deepEqual(readCallback(dev,"/","#access_token=fixture",""),{accessToken:"fixture",error:null,code:null});
 assert.equal(readCallback(dev,"/","#error=denied","").error,"denied");
 assert.equal(readCallback(dev,"/login","","?code=fixture").code,"fixture");
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

test("OAuth token has one source read across bootstrap and helper; retain the existing release guard",()=>{
 const root = "../../artifacts/ai-task-center/src/";
 const ctx=readFileSync(new URL(root+"contexts/auth-context.tsx",import.meta.url),"utf8");
 const helper=readFileSync(new URL(root+"lib/dev-google-handoff.ts",import.meta.url),"utf8");
 const marker='.get("access_token")';
 assert.equal((ctx+helper).split(marker).length-1,1);
 assert.match(ctx,/const fragmentAccessToken = hash\.get\("access_token"\)/);
 assert.match(ctx,/readDevGoogleCallback\(window\.location\.hostname, window\.location\.pathname, fragmentAccessToken, hash\.get\("error"\)/);
 assert.match(ctx,/const supabaseAccessToken = handoffEnabled \? callback\?\.accessToken : fragmentAccessToken/);
 const readAt=ctx.indexOf(marker);
 const scrubAt=ctx.indexOf("window.history.replaceState(",readAt);
 const exchangeAt=ctx.indexOf("devExchange.current ??= apiGoogleLogin(",readAt);
 assert.ok(readAt>=0 && scrubAt>readAt && exchangeAt>scrubAt);
});
