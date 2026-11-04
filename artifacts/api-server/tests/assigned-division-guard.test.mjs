import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('task update persists assignedDivision when explicitly supplied', () => {
  const source = readFileSync(new URL('../src/routes/ai-tasks.ts', import.meta.url), 'utf8');
  assert.match(source, /if \(assignedDivision !== undefined\) updates\.assignedDivision = assignedDivision as string \| null;/);
  assert.match(source, /\.update\(aiTasksTable\)\s*\.set\(updates\)/);
});
