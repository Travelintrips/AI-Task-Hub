import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { runInNewContext } from "node:vm";

// Verify the REAL onSuccess body rendered by Task183, without credentials,
// browser sessions, external network, a signing key or database access.
// A verified signature is not proof that the receipt was durably registered.
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const source=readFileSync(resolve(root,"artifacts/ai-task-center/src/pages/ai-task-detail.tsx"),"utf8");
const mutationStart=source.indexOf("const task183OwnerDecisionMutation = useMutation({");
assert.ok(mutationStart>=0,"Task183 Owner mutation missing");
const successStart=source.indexOf("onSuccess:(result:",mutationStart);
const bodyStart=source.indexOf("})=>{",successStart)+5;
const bodyEnd=source.indexOf("\n    },\n    onError:",bodyStart);
assert.ok(successStart>mutationStart&&bodyStart>successStart&&bodyEnd>bodyStart,
  "Owner toast callback boundaries changed: review this test before release");
const body=source.slice(bodyStart,bodyEnd);
assert.doesNotMatch(body,/\b(fetch|apiFetch|mutate|setTimeout)\s*\(/,
  "Owner result UI must not replay a write after an uncertain response");
const callback=runInNewContext("(function(result,toast){"+body+"})",{},{timeout:500});
function feedback(overrides) {
  const result={
    ownerDecisionStored:true,signedEvidenceVerified:true,
    receiptRegistered:true,manualReviewRequired:false,
    issuerAuthorized:false,dispatchPermitted:false,...overrides
  };
  const toasts=[];callback(result,(event)=>toasts.push(event));
  assert.equal(toasts.length,1);
  return toasts[0];
}

test("only verified signature + confirmed receipt + no manual review reports registration success",()=>{
  const event=feedback({});
  assert.match(event.title,/registrasi receipt.*dikonfirmasi/i);
  assert.doesNotMatch(event.description,/Jangan klik persetujuan ulang/i);
});
for(const [name,changes] of [
  ["receipt missing",{receiptRegistered:undefined}],
  ["receipt rejected",{receiptRegistered:false}],
  ["registration uncertain",{manualReviewRequired:true}],
  ["issuer unexpectedly authorized",{issuerAuthorized:true}],
  ["dispatch unexpectedly authorized",{dispatchPermitted:true}],
  ["Owner decision not stored",{ownerDecisionStored:false}],
  ["signature not verified",{signedEvidenceVerified:false}],
]) {
  test(name+" never reports receipt stored",()=>{
    const event=feedback(changes);
    assert.doesNotMatch(event.title,/registrasi receipt.*dikonfirmasi/i);
    assert.equal(event.variant,"destructive");
    assert.match(event.description,/Jangan/i);
  });
}
