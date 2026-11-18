import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const file = readFileSync(new URL("./cst-ai-team-local-ollama-qa.ps1", import.meta.url), "utf8");

test("local QA preflight only uses the pinned DELL Ollama loopback", () => {
  assert.match(file, /\$env:COMPUTERNAME -ne \$hostName/);
  assert.match(file, /\$hostName='DELL'/);
  assert.match(file, /\$model='qwen2\.5:3b'/);
  assert.match(file, /http:\/\/127\.0\.0\.1:11434\/api\/generate/);
  assert.doesNotMatch(file, /https:\/\/|SUPABASE_|DATABASE_URL|api\.openai\.com|AI_TASK_BRIDGE_TOKEN/);
});

test("local model runs with bounded input, response and network time", () => {
  assert.match(file, /ValidatePattern\('\^\[0-9a-fA-F\]\{8\}/);
  assert.match(file, /ValidateSet\('NO_PERSISTED_HANDOFF','REVIEW_COMPLETE'\)/);
  assert.match(file, /ValidateSet\('MISSING_WORKER_LEASE','DEV_READ_ONLY_GUARDS_OK'\)/);
  assert.match(file, /ValidateSet\('MISSING_FINAL_ACK','DEV_READ_ONLY_GUARDS_OK'\)/);
  assert.match(file, /num_ctx=512;num_predict=24;temperature=0/);
  assert.match(file, /-TimeoutSec 30/);
  assert.match(file, /if \(\$answer -cne 'QA_BLOCKED'\)/);
  assert.match(file, /NO_VERIFIED_BLOCKER_INPUT/);
});

test("proof output is operator collected and never grants GPT02 authority", () => {
  assert.match(file, /DEV_OPERATOR_COLLECTED_UNATTESTED/);
  assert.match(file, /agentId='ollama-local-qa'/);
  assert.match(file, /signed=\$false/);
  assert.match(file, /operationalVerified=\$false/);
  assert.match(file, /independentFinalAckVerified=\$false/);
  assert.match(file, /result='BLOCKED'/);
  assert.match(file, /responseSha256=\(Get-Sha256 \$answer\)/);
  assert.match(file, /sessionSha256=\(Get-Sha256 "local-ollama-qa:\$nonce"\)/);
  assert.doesNotMatch(file, /Invoke-Expression|Start-Process|New-Item|Set-ItemProperty|Remove-Item|Authorization.*Bearer/);
});
