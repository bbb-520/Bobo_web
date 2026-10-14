import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('CI installs locked dependencies on Node 24 and runs unit, build and isolated browser checks', () => {
  const workflow = readFileSync(new URL('../.github/workflows/frontend-ci.yml', import.meta.url), 'utf8');
  assert.match(workflow, /node-version: ['"]?24/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /node e2e\/run-unit-tests.mjs/);
  assert.match(workflow, /npm run build/);
  assert.match(workflow, /playwright install --with-deps chromium/);
  assert.match(workflow, /npm run test:e2e/);
  assert.match(workflow, /\.migration\/playwright-browsers/);
});

test('browser runner has a pinned version, a local server and refuses existing server reuse', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.devDependencies['@playwright/test'], '1.56.1');
  assert.equal(pkg.scripts['test:e2e'], 'playwright test');
  const config = readFileSync(new URL('../playwright.config.ts', import.meta.url), 'utf8');
  assert.match(config, /reuseExistingServer: false/);
  assert.match(config, /127\.0\.0\.1:4173/);
});
