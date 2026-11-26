import assert from "node:assert/strict";
import test from "node:test";
import { preparationAction } from "../../artifacts/ai-task-center/src/lib/gpt02-preparation-action.ts";

const ready = { taskId: 189, canRequestPreparation: true, reason: "READY_FOR_PREPARATION_ONLY" };
const locked = { ...ready, canRequestPreparation: false, reason: "GPT02_PREPARER_LOGIN_LOCKED" };
const fresh = { googleProofFresh: true, requiresFreshGoogleLogin: false };
const expired = { googleProofFresh: false, requiresFreshGoogleLogin: true };

test("a locked preparation never asks for login or another action", () => {
  for (const session of [undefined, fresh, expired]) {
    assert.equal(preparationAction(189, locked, session, false), "waiting");
  }
});
test("only readiness for this task can offer sign-in or preparation", () => {
  assert.equal(preparationAction(189, ready, expired, false), "sign-in");
  assert.equal(preparationAction(189, ready, fresh, false), "prepare");
  assert.equal(preparationAction(190, ready, fresh, false), "unavailable");
});
test("missing, failed and inconsistent readbacks cannot offer preparation", () => {
  assert.equal(preparationAction(189, undefined, fresh, false), "checking");
  assert.equal(preparationAction(189, ready, undefined, false), "checking");
  assert.equal(preparationAction(189, ready, fresh, true), "unavailable");
  assert.equal(preparationAction(189, ready, { googleProofFresh: true, requiresFreshGoogleLogin: true }, false), "unavailable");
});

test("a task-specific stale session from the preparation API offers sign-in only", () => {
  const needsSignIn = { ...locked, reason: "GPT02_FRESH_GOOGLE_OPERATOR_REQUIRED" };
  assert.equal(preparationAction(189, needsSignIn, undefined, false), "sign-in");
  assert.equal(preparationAction(189, needsSignIn, expired, false), "sign-in");
  assert.equal(preparationAction(190, needsSignIn, expired, false), "unavailable");
  assert.equal(preparationAction(189, needsSignIn, expired, true), "unavailable");
  assert.equal(preparationAction(189, { ...needsSignIn, canRequestPreparation: true }, fresh, false), "unavailable");
});
