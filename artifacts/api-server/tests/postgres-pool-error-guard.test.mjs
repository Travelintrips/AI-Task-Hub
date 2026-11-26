import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';

const sourceUrl = new URL('../../../lib/db/src/index.ts', import.meta.url);
const bundleUrl = new URL('../dist/index.mjs', import.meta.url);
const hasSource = existsSync(sourceUrl);
const source = readFileSync(hasSource ? sourceUrl : bundleUrl, 'utf8');


test('idle PostgreSQL pool errors have a registered listener', () => {
  if (hasSource) {
    assert.match(source, /pool\.on\("error",\s*\(error\)\s*=>/);
  } else {
    assert.match(source, /PostgreSQL idle pool client error/);
  }
});

test('idle pool error handler does not expose connection parameters', () => {
  if (hasSource) {
    assert.doesNotMatch(source, /console\.error\([^;]*\b(error|client)\s*\)/s);
    assert.match(source, /code:\s*\(error as NodeJS\.ErrnoException\)\.code/);
  } else {
    assert.match(source, /PostgreSQL idle pool client error/);
  }
});

test('pool error listener prevents EventEmitter from throwing', () => {
  const pool = new EventEmitter();
  const observed = [];
  pool.on('error', error => observed.push(error.code));
  assert.doesNotThrow(() => pool.emit('error', Object.assign(new Error('read ETIMEDOUT'), {code:'ETIMEDOUT'})));
  assert.deepEqual(observed, ['ETIMEDOUT']);
});
