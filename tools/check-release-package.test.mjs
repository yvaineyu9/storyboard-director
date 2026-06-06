// 发布包检查的单元测试（针对 check-release-package.mjs）。
// 用合成 fixture 覆盖：通过路径 + 每个失败维度（缺必含、figure.js 进包、
// 运行时 import figure.js、运行时读 JSON/文件、tools/ 泄漏、权限错误、路由缺失）。

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

const AIXIGNORE = [
  '*.md',
  'README.md',
  'PRD.md',
  '任务拆分.md',
  '架构设计.md',
  '架构师-交接提示词.md',
  '模块*.md',
  '!AGENTS.md',
  'tools/',
  'tools/bootstrap/',
  'lib/figure.js',
  '*.test.js',
  '*.test.mjs',
  '*.spec.js',
  '*.spec.mjs',
  '_*-test.mjs',
  '**/__snapshots__/',
  '*.snap',
  '*.png',
  '*.tmp.png',
  '*.intermediate.json',
  '*.generated.json'
].join('\n');

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
  await writeFixtureFile(
    root,
    'lib/library.js',
    'import { STORYBOARD_LIBRARY } from "./storyboard-library.js";\nexport function loadLibrary() { return STORYBOARD_LIBRARY; }'
  );
  await writeFixtureFile(root, 'lib/vocab.js', 'export const MOODS = {};');
  await writeFixtureFile(root, 'lib/json-rescue.js', 'export const parse = () => null;');
  await writeFixtureFile(root, 'lib/agents/intent.js', 'export const run = () => null;');
  await writeFixtureFile(root, 'lib/agents/composition.js', 'export const run = () => null;');
  await writeFixtureFile(root, 'lib/agents/rhythm.js', 'export const run = () => null;');
  await writeFixtureFile(root, 'lib/agents/combine.js', '// figure 来自真库\nexport const run = () => null;');
  await writeFixtureFile(root, 'lib/renderer/filmstrip.js', '// 渲染真库 figure 原语\nexport const draw = () => null;');

  // 应被排除的噪声文件（验证排除规则真的命中）。
  await writeFixtureFile(root, 'lib/figure.js', 'export const buildFigureForCaption = () => null;');
  await writeFixtureFile(root, 'README.md', '# readme');
  await writeFixtureFile(root, 'PRD.md', '# prd');
  await writeFixtureFile(root, 'tools/bootstrap/a0-build.js', 'import "../../lib/figure.js";');
  await writeFixtureFile(root, 'tools/bootstrap/storyboard-library.generated.json', '{}');
  await writeFixtureFile(root, 'tools/_reconcile-test.mjs', 'test stuff');

  await writeFixtureFile(root, '.aixignore', AIXIGNORE);

  return root;
}

test('accepts the integrated package with required files and upload-safe exclusions', async () => {
  const root = await createValidFixture();

  const result = await runReleasePackageChecks(root);

  assert.equal(result.ok, true, result.summary);
  assert.deepEqual(result.errors, []);
  assert.match(result.summary, /release package checks passed/i);
  // 离线物不进包
  assert.ok(!result.includedFiles.includes('lib/figure.js'));
  assert.ok(!result.includedFiles.some((f) => f.startsWith('tools/')));
  assert.ok(!result.includedFiles.includes('README.md'));
  assert.ok(!result.includedFiles.some((f) => f.endsWith('.generated.json')));
  // 必含物进包
  assert.ok(result.includedFiles.includes('AGENTS.md'));
  assert.ok(result.includedFiles.includes('lib/storyboard-library.js'));
});

test('rejects when lib/figure.js leaks into the payload (not excluded)', async () => {
  const root = await createValidFixture();
  // 去掉 figure.js 的排除规则 → 它会进包。
  await writeFixtureFile(root, '.aixignore', AIXIGNORE.replace('lib/figure.js\n', ''));

  const result = await runReleasePackageChecks(root);

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /lib\/figure\.js: offline figure generator must not be included/);
});

test('rejects a runtime file that imports the offline figure.js generator', async () => {
  const root = await createValidFixture();
  await writeFixtureFile(
    root,
    'lib/renderer/filmstrip.js',
    'import { buildFigureForCaption } from "../figure.js";\nexport const draw = () => null;'
  );

  const result = await runReleasePackageChecks(root);

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /imports offline figure\.js generator/i);
});

test('does not flag figure.js mentioned only in comments', async () => {
  const root = await createValidFixture();
  await writeFixtureFile(
    root,
    'lib/agents/combine.js',
    '// figure 原语来自真库（lib/figure.js 契约）\nexport const run = () => null;'
  );

  const result = await runReleasePackageChecks(root);

  assert.equal(result.ok, true, result.summary);
});

test('rejects forbidden tools/bootstrap references and runtime JSON/file loading', async () => {
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

test('rejects runtime readFile / createReadStream dependency', async () => {
  const root = await createValidFixture();
  await writeFixtureFile(
    root,
    'lib/library.js',
    'import { readFile } from "node:fs/promises";\nimport { STORYBOARD_LIBRARY } from "./storyboard-library.js";\nexport const loadLibrary = () => STORYBOARD_LIBRARY;'
  );

  const result = await runReleasePackageChecks(root);

  assert.equal(result.ok, false);
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

test('reports missing AGENTS.md without throwing', async () => {
  const root = await createValidFixture();
  await rm(path.join(root, 'AGENTS.md'));

  const result = await runReleasePackageChecks(root);

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /AGENTS\.md: required file is missing/);
});

test('rejects missing routes and wrong / extra permissions', async () => {
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
