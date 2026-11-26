import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('task update persists assignedDivision when explicitly supplied', () => {
  const source = readFileSync(new URL('../src/routes/ai-tasks.ts', import.meta.url), 'utf8');
  assert.match(source, /if \(assignedDivision !== undefined\) updates\.assignedDivision = assignedDivision as string \| null;/);
  assert.match(source, /\.update\(aiTasksTable\)\s*\.set\(updates\)/);
});

const source = readFileSync(new URL('../src/routes/ai-tasks.ts', import.meta.url), 'utf8');
const match = source.match(/if \(assignedDivision !== undefined\) updates\.assignedDivision = assignedDivision as string \| null;/);
assert.ok(match, 'production update statement missing');
const executableStatement = match[0].replace(' as string | null', '');

for (const [label, input, expected, shouldExist] of [
  ['string assignment', 'QA-PR141', 'QA-PR141', true],
  ['explicit null', null, null, true],
  ['omitted field', undefined, undefined, false],
]) {
  test(`production assignment statement: ${label}`, () => {
    const updates = {};
    runInNewContext(executableStatement, { assignedDivision: input, updates });
    assert.equal(Object.hasOwn(updates, 'assignedDivision'), shouldExist);
    if (shouldExist) assert.equal(updates.assignedDivision, expected);
  });
}
