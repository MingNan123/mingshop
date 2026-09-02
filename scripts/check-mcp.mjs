#!/usr/bin/env node
import { rmSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const checkConfig = join(root, 'mcp', `.wrangler-check.${process.pid}.jsonc`);
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function run(args) {
  const result = spawnSync(npx, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

try {
  const template = readFileSync(join(root, 'mcp', 'wrangler.template.jsonc'), 'utf8')
    .replace(/__NAME__/g, 'minshop-check')
    .replace(/__DB_NAME__/g, 'minshop-check-db')
    .replace(/__DB_ID__/g, '00000000-0000-0000-0000-000000000000');
  writeFileSync(checkConfig, template);

  run(['tsc', '-p', join(root, 'mcp', 'tsconfig.json'), '--noEmit']);
  run(['wrangler', 'deploy', '--config', checkConfig, '--dry-run']);
} finally {
  rmSync(checkConfig, { force: true });
}
