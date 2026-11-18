/** Offline-only Ed25519 three-party binding rehearsal.
 * Ephemeral test keys are generated in-memory. This does not issue approval.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, verify, createHash, randomUUID } from "node:crypto";

const roles = ["super-admin-approval", "hub-identity", "core-identity"];
const custody = new Map(roles.map(role => [role, generateKeyPairSync("ed25519")]));
const task = 172, company = "default";
const job = randomUUID(), coreTask = randomUUID(), command = randomUUID(), attempt = randomUUID();
const worker = "openclaw-dell-chatgpt-wake-dev";
const issuedAt = 1000, expiresAt = 1200;
const nonce = randomUUID();
const payload = Object.freeze({
  environment: "DEV", companyId: company, taskId: task, hubJobId: job,
  coreTaskId: coreTask, commandId: command, attemptId: attempt,
  workerId: worker, nonce, issuedAt, expiresAt
});
function bytes(x) { return Buffer.from(JSON.stringify(x), "utf8"); }
function attest(role, p=payload) {
  return sign(null, bytes({role, payload:p}), custody.get(role).privateKey);
}
const signatures = new Map(roles.map(role => [role, attest(role)]));
function verifyAll(input, proofs, now, seen) {
  if (input.environment !== "DEV" || input.companyId !== "default" ||
      !Number.isInteger(input.taskId) || input.taskId <= 139 ||
      input.workerId !== worker || now < input.issuedAt || now >= input.expiresAt ||
      input.expiresAt-input.issuedAt > 300 || seen.has(input.nonce)) return false;
  if (![input.hubJobId,input.coreTaskId,input.commandId,input.attemptId].every(
    x => typeof x==="string" && /^[0-9a-f-]{36}$/i.test(x)
  )) return false;
  for (const role of roles) {
    const p = proofs.get(role);
    if (!Buffer.isBuffer(p) || !verify(null, bytes({role, payload:input}), custody.get(role).publicKey, p)) {
      return false;
    }
  }
  seen.add(input.nonce);
  return true;
}
test("three independently signed identities authorize only exact synthetic tuple", () => {
  assert.equal(verifyAll(payload,signatures,1100,new Set()),true);
});
test("single missing, replaced or wrong-role signature denies", () => {
  for (const role of roles) {
    const absent = new Map(signatures);absent.delete(role);
    assert.equal(verifyAll(payload,absent,1100,new Set()),false);
    const swapped = new Map(signatures);swapped.set(role,signatures.get(roles[(roles.indexOf(role)+1)%roles.length]));
    assert.equal(verifyAll(payload,swapped,1100,new Set()),false);
  }
});
test("altered tenant, task, command, attempt, job, Core id or worker denies", () => {
  for (const [key,value] of Object.entries({companyId:"other",taskId:173,hubJobId:randomUUID(),coreTaskId:randomUUID(),commandId:randomUUID(),attemptId:randomUUID(),workerId:"not-authorized"})) {
    assert.equal(verifyAll({...payload,[key]:value},signatures,1100,new Set()),false,key);
  }
});
test("expired or future signature denies", () => {
  assert.equal(verifyAll(payload,signatures,1200,new Set()),false);
  assert.equal(verifyAll(payload,signatures,999,new Set()),false);
});
test("replayed nonce denies even for valid cryptographic signatures", () => {
  const seen=new Set();
  assert.equal(verifyAll(payload,signatures,1100,seen),true);
  assert.equal(verifyAll(payload,signatures,1100,seen),false);
});
test("signature cannot be replaced by similarly formatted fake bytes", () => {
  const forged=new Map(signatures);
  forged.set(roles[0],Buffer.alloc(64,9));
  assert.equal(forged.get(roles[0]).toString("base64url").length,86);
  assert.equal(verifyAll(payload,forged,1100,new Set()),false);
});
test("untrusted self-signed key cannot replace trusted custody public key", () => {
  const attacker=generateKeyPairSync("ed25519");
  const forged=new Map(signatures);
  forged.set(roles[0],sign(null,bytes({role:roles[0],payload}),attacker.privateKey));
  assert.equal(verifyAll(payload,forged,1100,new Set()),false);
});
test("approval digest is payload-bound", () => {
  const digest = createHash("sha256").update(bytes(payload)).digest("hex");
  assert.notEqual(digest,createHash("sha256").update(bytes({...payload,attemptId:randomUUID()})).digest("hex"));
});
