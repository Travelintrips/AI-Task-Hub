import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isCstDevBoundedWorkerProbe } from "../../artifacts/api-server/src/lib/cst-ai-team-contract.ts";

const dev = { NODE_ENV:"development", APP_ENV:"development" };
const allowed = { companyId:"1", assignedClientId:"openclaw-pc-worker-dev", instruction:"ping" };
const bridge = readFileSync(new URL("../../artifacts/api-server/src/lib/ai-core-execution-bridge.ts",import.meta.url),"utf8");

test("explicit company-1 DEV bounded ping/status targets only the selected worker",()=>{
  assert.equal(isCstDevBoundedWorkerProbe(allowed,dev),true);
  assert.equal(isCstDevBoundedWorkerProbe({...allowed,instruction:" status "},dev),true);
  assert.equal(isCstDevBoundedWorkerProbe({...allowed,instruction:"PING"},dev),true);
});

test("no pinning outside DEV or for legacy/default/other companies",()=>{
  assert.equal(isCstDevBoundedWorkerProbe(allowed,{...dev,APP_ENV:"production"}),false);
  assert.equal(isCstDevBoundedWorkerProbe(allowed,{...dev,NODE_ENV:"production"}),false);
  assert.equal(isCstDevBoundedWorkerProbe(allowed,{}),false);
  assert.equal(isCstDevBoundedWorkerProbe({...allowed,companyId:"default"},dev),false);
  assert.equal(isCstDevBoundedWorkerProbe({...allowed,companyId:"3"},dev),false);
});

test("no pinning of wake-only agents, generic aliases, other workers or reasoning",()=>{
  for (const client of [null,"openclaw-travelintrips-dev","openclaw-dell-chatgpt-wake-dev",
    "openclaw-vps-main","gcp-openclaw-main","openclaw-pc-worker","openclaw-pc-worker-2"]) {
    assert.equal(isCstDevBoundedWorkerProbe({...allowed,assignedClientId:client},dev),false);
  }
  for (const instruction of ["ping extra","read secrets","run ping","DEV_CHATGPT_WAKE_V1",
    "approve","health check","deploy","ping;rm -rf /",""]) {
    assert.equal(isCstDevBoundedWorkerProbe({...allowed,instruction},dev),false);
  }
});

test("Core existing explicitWorkerTarget used only after narrow helper verifies request",()=>{
  assert.match(bridge,/\.\.\.\(isCstDevBoundedWorkerProbe\(input\) \? \{ explicitWorkerTarget: true \} : \{\}\)/);
  assert.match(bridge,/preferredClientId: input.assignedClientId/);
  assert.doesNotMatch(bridge,/GPT02_SIGNING_ENABLED|signingPermitted: true/);
});
