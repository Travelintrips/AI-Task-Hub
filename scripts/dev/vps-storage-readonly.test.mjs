import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('inventory reads Docker metadata only; protects images of running and stopped containers', () => {
  const folder = mkdtempSync(join(tmpdir(), 'vps-readonly-'));
  const docker = join(folder, 'docker');
  try {
    writeFileSync(docker, [
      '#!/bin/sh',
      'case "$1" in',
      '  ps) printf \'%s\\n\' \'{"ID":"running-1","Image":"registry/live:v1"}\' \'{"ID":"stopped-1","Image":"registry/old:v1"}\' ;;',
      '  inspect) printf \'%s\\n\' \'[{"Image":"sha256:live"},{"Image":"sha256:old"}]\' ;;',
      '  image) printf \'%s\\n\' \'{"ID":"sha256:live","Repository":"registry/live","Tag":"v1","Size":"1GB","CreatedAt":"today"}\' \'{"ID":"sha256:old","Repository":"registry/old","Tag":"v1","Size":"2GB","CreatedAt":"yesterday"}\' \'{"ID":"sha256:unused","Repository":"registry/unused","Tag":"v1","Size":"3GB","CreatedAt":"today"}\' ;;',
      '  *) echo "FORBIDDEN_DOCKER_SUBCOMMAND" >&2; exit 99 ;;',
      'esac',
    ].join('\n'));
    chmodSync(docker, 0o700);
    const result = spawnSync('python3', ['scripts/vps-storage/inventory.py'], {
      encoding: 'utf8', env: { ...process.env, PATH: folder + ':' + process.env.PATH },
    });
    assert.equal(result.status, 0, result.stderr);
    const out = JSON.parse(result.stdout);
    assert.equal(out.readOnly, true);
    const images = out.categories[0].items;
    assert.equal(images.find(x => x.id === 'sha256:live').protected, true);
    assert.equal(images.find(x => x.id === 'sha256:old').protected, true);
    assert.equal(images.find(x => x.id === 'sha256:unused').protected, false);
    assert.equal(images.length, 3);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('route is Super Admin and DEV-only, with explicit disabled-by-default flag', () => {
  const route = readFileSync('artifacts/api-server/src/routes/vps-storage.ts', 'utf8');
  assert.match(route, /requireAuth, requireRole\("super_admin"\)/);
  assert.match(route, /NODE_ENV !== "development"/);
  assert.match(route, /APP_ENV !== "development"/);
  assert.match(route, /VPS_STORAGE_INVENTORY_READONLY_ENABLED !== "true"/);
  assert.doesNotMatch(route, /router\.(post|put|patch|delete)\(/i);
});

test('frontend uses current auth provider token and disables deletion', () => {
  const page = readFileSync('artifacts/ai-task-center/src/pages/vps-storage.tsx', 'utf8');
  assert.match(page, /useGetVpsStorageInventory\(/);
  assert.doesNotMatch(page, /\bfetch\(/);
  assert.doesNotMatch(page, /type Inventory/);
  assert.match(page, /isVpsStorageDevHost\(/);
  assert.match(page, /<button disabled/);
  const layout = readFileSync('artifacts/ai-task-center/src/components/layout/app-layout.tsx', 'utf8');
  const app = readFileSync('artifacts/ai-task-center/src/App.tsx', 'utf8');
  assert.match(layout, /super_admin" && isVpsStorageDevHost\(/);
  assert.match(app, /isVpsStorageDevHost\(\) \? <VpsStoragePage/);
  const spec = readFileSync('lib/api-spec/openapi.yaml', 'utf8');
  const client = readFileSync('lib/api-client-react/src/generated/api.ts', 'utf8');
  assert.match(spec, /operationId: getVpsStorageInventory/);
  assert.match(client, /export function useGetVpsStorageInventory/);
});
