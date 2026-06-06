import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runReleasePackageChecks } from './check-release-package.mjs';

async function writeFixtureFile(root, relativePath, contents = '') {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents);
}

async function createValidFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aiui-release-check-'));

  await writeFixtureFile(root, 'AGENTS.md', `# Agent

## Capabilities
- **Permissions**:
  - microphone
  - network
- **Skills**:
  - storyboard-director
`);
  await writeFixtureFile(root, 'app.js', 'export default {};');
  await writeFixtureFile(root, 'app.json', JSON.stringify({
    pages: ['pages/index/index'],
    window: { navigationBarTitleText: '分镜导演' }
  }, null, 2));
  await writeFixtureFile(root, 'package.json', JSON.stringify({
    name: 'storyboard-director',
    scripts: { 'check:release': 'node tools/check-release-package.mjs' }
  }, null, 2));
  await writeFixtureFile(root, 'pages/index/index.ink', '<page><view>ok</view></page>');
  await writeFixtureFile(root, 'lib/storyboard-library.js', 'export const STORYBOARD_LIBRARY = {};');
  await writeFixtureFile(root, 'lib/library.js', 'import { STORYBOARD_LIBRARY } from "./storyboard-library.js";\nexport function loadLibrary() { return STORYBOARD_LIBRARY; }');
  await writeFixtureFile(root, 'lib/vocab.js', 'export const MOODS = {};');
  await writeFixtureFile(root, 'lib/agents/intent.js', 'export const run = () => null;');
  await writeFixtureFile(root, 'lib/json-rescue.js', 'export const parse = () => null;');
  await writeFixtureFile(root, 'lib/renderer/filmstrip.js', 'export const draw = () => null;');
  await writeFixtureFile(root, '.aixignore', [
    'README.md',
    'PRD.md',
    '任务拆分.md',
    '架构设计.md',
    '模块*.md',
    '架构师-交接提示词.md',
    'tools/',
    'tools/bootstrap/',
    'lib/figure.js',
    '*.png',
    '*.tmp.png',
    '*.snap',
    '*.test.mjs',
    '**/__snapshots__/',
    '*.intermediate.json'
  ].join('\n'));

  return root;
}

test('accepts a package with required AIUI files and upload-safe exclusions', async () => {
  const root = await createValidFixture();

  const result = await runReleasePackageChecks(root);

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.match(result.summary, /release package checks passed/i);
});

test('rejects offline bootstrap references and runtime JSON file loading', async () => {
  const root = await createValidFixture();
  await writeFixtureFile(root, 'lib/library.js', [
    'import "./tools/bootstrap/a0-build.js";',
    'export async function loadLibrary() {',
    '  return fetch("./storyboard-library.json");',
    '}'
  ].join('\n'));

  const result = await runReleasePackageChecks(root);

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /tools\/bootstrap/);
  assert.match(result.errors.join('\n'), /runtime JSON\/file loading/i);
});

test('rejects missing required runtime library modules and directories', async () => {
  const root = await createValidFixture();
  await rm(path.join(root, 'lib/vocab.js'));
  await rm(path.join(root, 'lib/agents'), { recursive: true });
  await rm(path.join(root, 'lib/renderer'), { recursive: true });

  const result = await runReleasePackageChecks(root);

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /lib\/vocab\.js: required file is missing/);
  assert.match(result.errors.join('\n'), /lib\/agents\/: required directory is missing/);
  assert.match(result.errors.join('\n'), /lib\/renderer\/: required directory is missing/);
});

test('rejects forbidden bootstrap references in package metadata', async () => {
  const root = await createValidFixture();
  await writeFixtureFile(root, 'package.json', JSON.stringify({
    name: 'storyboard-director',
    scripts: {
      'check:release': 'node tools/check-release-package.mjs',
      bootstrap: 'node tools/bootstrap/a0-build.js'
    }
  }, null, 2));

  const result = await runReleasePackageChecks(root);

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /package\.json: contains forbidden tools\/bootstrap reference/);
});

test('reports missing AGENTS.md without throwing', async () => {
  const root = await createValidFixture();
  await rm(path.join(root, 'AGENTS.md'));

  const result = await runReleasePackageChecks(root);

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /AGENTS\.md: required file is missing/);
});

test('rejects missing routes and wrong permissions', async () => {
  const root = await createValidFixture();
  await writeFixtureFile(root, 'AGENTS.md', `# Agent

## Capabilities
- **Permissions**:
  - microphone
  - camera
- **Skills**:
  - storyboard-director
`);
  await writeFixtureFile(root, 'app.json', JSON.stringify({
    pages: ['pages/missing/index'],
    permissions: ['microphone', 'camera']
  }, null, 2));

  const result = await runReleasePackageChecks(root);

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /missing required permission: network/i);
  assert.match(result.errors.join('\n'), /unsupported permission: camera/i);
  assert.match(result.errors.join('\n'), /route does not resolve/i);
});
