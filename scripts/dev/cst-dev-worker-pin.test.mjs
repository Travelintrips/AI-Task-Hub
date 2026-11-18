import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { pinCstDevBoundedWorkerTarget } from "../../artifacts/api-server/src/lib/cst-dev-worker-pin.ts";

const dev={NODE_ENV:"development",APP_ENV:"development"};
const good={companyId:"1",assignedClientId:"openclaw-pc-worker-dev",instruction:"ping"};
const source=readFileSync(new URL("../../artifacts/api-server/src/lib/ai-core-execution-bridge.ts",import.meta.url),"utf8");

test("retains the explicitly selected DEV CST worker for exact ping/status",()=>{
  for(const instruction of ["ping","status"," Ping ","STATUS"]) {
    assert.equal(pinCstDevBoundedWorkerTarget({...good,instruction},dev),true);
  }
});

test("rejects PROD and all other company IDs",()=>{
  assert.equal(pinCstDevBoundedWorkerTarget(good,{...dev,NODE_ENV:"production"}),false);
  assert.equal(pinCstDevBoundedWorkerTarget(good,{...dev,APP_ENV:"production"}),false);
  assert.equal(pinCstDevBoundedWorkerTarget(good,{}),false);
  for(const companyId of ["default","3","","2"])assert.equal(pinCstDevBoundedWorkerTarget({...good,companyId},dev),false);
});

test("rejects reasoning, arbitrary shell and special wake worker targets",()=>{
  for(const instruction of ["Read diagnostic logs","ping && curl localhost","run ping","ping now","deploy","status;env","DEV_CHATGPT_WAKE_V1",""]) {
    assert.equal(pinCstDevBoundedWorkerTarget({...good,instruction},dev),false);
  }
  for(const assignedClientId of [null,"openclaw-vps-main","openclaw-travelintrips-dev","openclaw-dell-chatgpt-wake-dev","openclaw-pc-worker"]) {
    assert.equal(pinCstDevBoundedWorkerTarget({...good,assignedClientId},dev),false);
  }
});

test("pins only the metadata of the existing authenticated bridge, does not dispatch elsewhere",()=>{
  assert.match(source,/pinCstDevBoundedWorkerTarget\(input\) \? \{ explicitWorkerTarget: true \} : \{\}/);
  assert.match(source,/externalCommandId: input.externalCommandId/);
  assert.match(source,/preferredClientId: input.assignedClientId/);
  assert.doesNotMatch(source,/GPT02_SIGNING_ENABLED|signingPermitted: true/);
});
