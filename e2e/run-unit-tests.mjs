import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
// Discover every existing test:* script; browser smoke runs separately after build/install.
const names = Object.keys(scripts).filter(name => name.startsWith('test:') && !name.startsWith('test:e2e'));
if (!names.length) throw new Error('No unit test scripts found');
for (const name of names) {
  console.log(`\nRunning ${name}`);
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', name], {
    stdio: 'inherit', shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`\nAll ${names.length} unit test scripts passed.`);
