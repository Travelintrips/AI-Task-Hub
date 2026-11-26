import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../artifacts/ai-task-center/src/pages/ai-task-detail.tsx',import.meta.url),'utf8');
test('failed GPT02 execution is not misrepresented as 100 percent completed',()=>{
  assert.match(source, /Lifecycle GPT02 gagal — pekerjaan belum selesai/);
  assert.match(source, /GAGAL — bukan 100% selesai/);
  assert.match(source, /executionData\.execution\.status\.toLowerCase\(\) !== "failed" && <div className="h-full/);
  assert.match(source, /Tahap execution \(bukan progres proyek\)/);
});
test('failed execution offers read-only reconciliation rather than duplicate dispatch',()=>{
  assert.match(source, /Jangan mengirim ulang command secara manual/);
  assert.match(source, /Periksa Rekonsiliasi GPT02 \(baca-saja\)/);
  assert.match(source, /errorMessage \|\| "Tidak ada respons worker yang terverifikasi/);
});
test('completed without all three verification proofs stays unverified',()=>{
  assert.match(source, /executionData\.execution\.callbackVerified && executionData\.execution\.attestationVerified && executionData\.execution\.finalAckVerified/);
  assert.match(source, /Status COMPLETED belum berarti PASS/);
});
