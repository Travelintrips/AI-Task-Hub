import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';

const source = readFileSync(new URL('../../../lib/db/src/index.ts', import.meta.url), 'utf8');

test('idle PostgreSQL pool errors have a registered listener', () => {
  assert.match(source, /pool\.on\("error",\s*\(error\)\s*=>/);
});

test('idle pool error handler does not expose connection parameters', () => {
  assert.doesNotMatch(source, /console\.error\([^;]*\b(error|client)\s*\)/s);
  assert.match(source, /code:\s*\(error as NodeJS\.ErrnoException\)\.code/);
});

test('pool error listener prevents EventEmitter from throwing', () => {
  const pool = new EventEmitter();
  const observed = [];
  pool.on('error', error => observed.push(error.code));
  assert.doesNotThrow(() => pool.emit('error', Object.assign(new Error('read ETIMEDOUT'), {code:'ETIMEDOUT'})));
  assert.deepEqual(observed, ['ETIMEDOUT']);
});
