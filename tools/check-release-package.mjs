// 发布包规范检查（架构设计 §8 / 任务拆分 T17）
//
// 对「已集成 main」的真实工程做上传前验收：
//   1. 必含项齐全（逐个存在且不会被 .aixignore 误排）
//   2. 必排除项确实被 .aixignore 命中（tools/、lib/figure.js、*.md、测试、generated/intermediate JSON…）
//   3. grep 验运行时无 import figure.js（pages/ + lib/ 运行时代码不得依赖离线生成器）
//   4. grep 验运行时无读文件/JSON 依赖（无 readFile/createReadStream/fetch 本地 JSON；
//      storyboard-library 必须是静态 import 模块）
//   5. AGENTS.md 权限含 microphone + network（且不含多余权限）
//   6. app.json pages 路由都指向存在且未被排除的页面文件
//
// 用法：node tools/check-release-package.mjs [packageRoot]
// 退出码 0=通过 / 1=失败。

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---- 必含项（架构设计 §8.1：运行时真库 + 编排 + 渲染器）----
const REQUIRED_FILES = [
  'AGENTS.md',
  'app.js',
  'app.json',
  'package.json',
  '.aixignore',
  'lib/vocab.js',
  'lib/json-rescue.js',
  'lib/library.js',
  'lib/storyboard-library.js',
  'lib/agents/intent.js',
  'lib/agents/composition.js',
  'lib/agents/rhythm.js',
  'lib/agents/combine.js',
  'lib/renderer/filmstrip.js'
];

const REQUIRED_DIRS = [
  'pages',
  'lib',
  'lib/agents',
  'lib/renderer'
];

// 发布包顶层只允许这些根条目进包（其余视为非法泄漏）。
const RUNTIME_ALLOWED_ROOTS = new Set([
  '.aixignore',
  'AGENTS.md',
  'app.js',
  'app.json',
  'assets',
  'lib',
  'package.json',
  'pages'
]);

// .aixignore 必须显式命中的排除规则（与实际 .aixignore 行对齐）。
const REQUIRED_AIXIGNORE_RULES = [
  'tools/',
  'lib/figure.js',
  '*.md',
  '*.test.mjs',
  '*.generated.json',
  '*.intermediate.json',
  '**/__snapshots__/',
  '*.snap',
  '*.png'
];

const ALLOWED_PERMISSIONS = new Set(['microphone', 'network']);
const REQUIRED_PERMISSIONS = new Set(['microphone', 'network']);
const RUNTIME_SCAN_EXTENSIONS = new Set(['.js', '.mjs', '.ink', '.json']);

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function globToRegex(glob) {
  let pattern = '';

  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    const next = glob[index + 1];
    const nextNext = glob[index + 2];

    if (char === '*' && next === '*' && nextNext === '/') {
      pattern += '(?:.*/)?';
      index += 2;
    } else if (char === '*' && next === '*') {
      pattern += '.*';
      index += 1;
    } else if (char === '*') {
      pattern += '[^/]*';
    } else if (char === '?') {
      pattern += '[^/]';
    } else {
      pattern += escapeRegex(char);
    }
  }

  return new RegExp(`^${pattern}$`);
}

function matchGlob(value, glob) {
  return globToRegex(glob).test(value);
}

function directoryPrefixes(relativePath) {
  const parts = relativePath.split('/');
  const prefixes = [];

  for (let index = 1; index < parts.length; index += 1) {
    prefixes.push(parts.slice(0, index).join('/'));
  }

  return prefixes;
}

function matchesIgnorePattern(relativePath, rawPattern) {
  const pattern = rawPattern.replace(/^\/+/, '');

  if (pattern.endsWith('/')) {
    const directoryPattern = pattern.slice(0, -1);
    return directoryPrefixes(relativePath).some((directory) => {
      if (directoryPattern.includes('/')) {
        return matchGlob(directory, directoryPattern);
      }
      return matchGlob(path.posix.basename(directory), directoryPattern);
    });
  }

  if (pattern.includes('/')) {
    return matchGlob(relativePath, pattern);
  }

  return matchGlob(path.posix.basename(relativePath), pattern);
}

function parseAixignore(contents) {
  return contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => ({
      raw: line,
      negate: line.startsWith('!'),
      pattern: line.startsWith('!') ? line.slice(1) : line
    }));
}

function isIgnored(relativePath, rules) {
  let ignored = false;

  for (const rule of rules) {
    if (matchesIgnorePattern(relativePath, rule.pattern)) {
      ignored = !rule.negate;
    }
  }

  return ignored;
}

async function exists(root, relativePath) {
  try {
    await stat(path.join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(root, relativePath) {
  try {
    return (await stat(path.join(root, relativePath))).isDirectory();
  } catch {
    return false;
  }
}

async function readText(root, relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}

async function readJson(root, relativePath, errors) {
  try {
    return JSON.parse(await readText(root, relativePath));
  } catch (error) {
    errors.push(`${relativePath}: invalid JSON (${error.message})`);
    return null;
  }
}

async function walkFiles(root, relativeDirectory = '') {
  const absoluteDirectory = path.join(root, relativeDirectory);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '.git' || entry.name === 'node_modules') {
      continue;
    }

    const relativePath = toPosix(path.join(relativeDirectory, entry.name));

    if (entry.isDirectory()) {
      files.push(...await walkFiles(root, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
}

function packageRootOf(relativePath) {
  return relativePath.includes('/') ? relativePath.slice(0, relativePath.indexOf('/')) : relativePath;
}

function parseAgentsPermissions(contents) {
  const permissions = [];
  let inPermissions = false;

  for (const line of contents.split(/\r?\n/)) {
    if (/permissions/i.test(line)) {
      inPermissions = true;
      continue;
    }

    if (inPermissions && (/skills/i.test(line) || /^##\s+/.test(line))) {
      break;
    }

    if (inPermissions) {
      const match = line.match(/^\s*[-*]\s+([A-Za-z0-9_-]+)\s*$/);
      if (match) {
        permissions.push(match[1]);
      }
    }
  }

  return permissions;
}

function collectAppJsonPermissions(value, permissions = []) {
  if (!value || typeof value !== 'object') {
    return permissions;
  }

  for (const [key, child] of Object.entries(value)) {
    if (/permissions?/i.test(key)) {
      if (Array.isArray(child)) {
        permissions.push(...child.filter((entry) => typeof entry === 'string'));
      } else if (child && typeof child === 'object') {
        permissions.push(...Object.keys(child));
      } else if (typeof child === 'string') {
        permissions.push(child);
      }
    } else if (child && typeof child === 'object') {
      collectAppJsonPermissions(child, permissions);
    }
  }

  return permissions;
}

function validatePermissionSet(source, permissions, errors, requireAll) {
  const uniquePermissions = new Set(permissions);

  if (requireAll) {
    for (const permission of REQUIRED_PERMISSIONS) {
      if (!uniquePermissions.has(permission)) {
        errors.push(`${source}: missing required permission: ${permission}`);
      }
    }
  }

  for (const permission of uniquePermissions) {
    if (!ALLOWED_PERMISSIONS.has(permission)) {
      errors.push(`${source}: unsupported permission: ${permission}`);
    }
  }
}

async function resolveRoute(root, route) {
  const candidates = [
    `${route}.ink`,
    `${route}.js`,
    `${route}.json`,
    `${route}.wxml`
  ];

  for (const candidate of candidates) {
    if (await exists(root, candidate)) {
      return candidate;
    }
  }

  return null;
}

function extractAssetReferences(relativePath, contents) {
  const references = new Set();
  const regex = /(?:['"(\s:=])((?:\.{1,2}\/)*assets\/[^'")\s,}]+)/g;
  let match;

  while ((match = regex.exec(contents))) {
    const cleanPath = match[1]
      .replace(/^[.][/]/, '')
      .replace(/^[.][.][/]/, '')
      .replace(/[?#].*$/, '');

    references.add(cleanPath);
  }

  return [...references].map((assetPath) => ({ source: relativePath, assetPath }));
}

// 运行时禁止：读文件 / 加载本地 JSON / fetch 本地 JSON。
// 注意：静态 `import x from './storyboard-library.js'`（.js 模块）是允许的；
// 只有对 *.json 的 import/require/动态 import，以及 fs 读取才视为违规。
function hasRuntimeJsonOrFileLoad(contents) {
  const patterns = [
    /\breadFile(?:Sync)?\b/,
    /\bcreateReadStream\b/,
    /\bgetFileSystemManager\s*\(/,
    /\bfs\s*\.\s*(?:readFile|readFileSync|createReadStream)\b/,
    /import\s+(?:[^'"]+\s+from\s+)?['"][^'"]+\.json['"]/,
    /import\s*\(\s*['"][^'"]+\.json['"]\s*\)/,
    /require\s*\(\s*['"][^'"]+\.json['"]\s*\)/,
    /fetch\s*\(\s*['"][^'"]*\.json(?:[?#][^'"]*)?['"]\s*\)/
  ];

  return patterns.some((pattern) => pattern.test(contents));
}

// 仅匹配真正的 import/require 语句中引用 figure.js 的情形，避免误伤注释里出现的
// "lib/figure.js" 文字（运行时代码大量在注释里引用契约文件名）。
function importsFigureGenerator(contents) {
  const importFrom = /import\b[^;\n]*\bfrom\s*['"][^'"]*\bfigure\.js['"]/;
  const dynamicImport = /\bimport\s*\(\s*['"][^'"]*\bfigure\.js['"]\s*\)/;
  const requireFigure = /\brequire\s*\(\s*['"][^'"]*\bfigure\.js['"]\s*\)/;
  return importFrom.test(contents) || dynamicImport.test(contents) || requireFigure.test(contents);
}

function formatResult(ok, checks, errors, warnings, includedFiles) {
  const status = ok ? 'passed' : 'failed';
  const lines = [`Release package checks ${status}`];

  for (const check of checks) {
    lines.push(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` - ${check.detail}` : ''}`);
  }

  if (warnings.length) {
    lines.push('Warnings:');
    lines.push(...warnings.map((warning) => `- ${warning}`));
  }

  if (errors.length) {
    lines.push('Errors:');
    lines.push(...errors.map((error) => `- ${error}`));
  }

  lines.push(`Included files: ${includedFiles.length}`);

  return lines.join('\n');
}

function pushCheck(checks, name, errorsBefore, errors, detail = '') {
  checks.push({
    name,
    ok: errors.length === errorsBefore,
    detail
  });
}

export async function runReleasePackageChecks(root = process.cwd()) {
  const errors = [];
  const warnings = [];
  const checks = [];

  const aixignorePath = '.aixignore';
  const aixignoreExists = await exists(root, aixignorePath);
  let ignoreRules = [];
  let allFiles = [];
  let includedFiles = [];

  // ---- 检查 1：.aixignore 存在且含必须的排除规则 ----
  {
    const before = errors.length;
    if (!aixignoreExists) {
      errors.push('.aixignore: missing upload exclusion file');
    } else {
      const aixignoreContents = await readText(root, aixignorePath);
      ignoreRules = parseAixignore(aixignoreContents);
      const rawRules = new Set(ignoreRules.map((rule) => rule.raw));

      for (const requiredRule of REQUIRED_AIXIGNORE_RULES) {
        if (!rawRules.has(requiredRule)) {
          errors.push(`.aixignore: missing exclusion rule ${requiredRule}`);
        }
      }
    }
    pushCheck(checks, '.aixignore rules', before, errors);
  }

  allFiles = await walkFiles(root);
  // .aixignore 自身不应被它自己排除（保留在包根）。
  includedFiles = allFiles.filter((file) => file === '.aixignore' || !isIgnored(file, ignoreRules));

  // ---- 检查 2：必含项齐全且未被误排 ----
  {
    const before = errors.length;
    for (const file of REQUIRED_FILES) {
      if (!await exists(root, file)) {
        errors.push(`${file}: required file is missing`);
      } else if (!includedFiles.includes(file)) {
        errors.push(`${file}: required file is excluded by .aixignore`);
      }
    }

    for (const directory of REQUIRED_DIRS) {
      if (!await isDirectory(root, directory)) {
        errors.push(`${directory}/: required directory is missing`);
      } else if (!includedFiles.some((file) => file.startsWith(`${directory}/`))) {
        errors.push(`${directory}/: required directory has no included files`);
      }
    }

    pushCheck(checks, 'required AIUI package files', before, errors);
  }

  // ---- 检查 3：必排除项确实被排除（包内无非法泄漏）----
  {
    const before = errors.length;
    for (const file of includedFiles) {
      const rootEntry = packageRootOf(file);
      if (!RUNTIME_ALLOWED_ROOTS.has(rootEntry)) {
        errors.push(`${file}: not allowed in release package payload`);
      }
    }

    // figure.js：仅 A0 离线用，绝不进包。
    if (includedFiles.includes('lib/figure.js')) {
      errors.push('lib/figure.js: offline figure generator must not be included in release package');
    }

    // tools/ 全部（含 bootstrap 脚本、generated JSON、各种 *-test.mjs）必须排除。
    if (includedFiles.some((file) => file === 'tools' || file.startsWith('tools/'))) {
      errors.push('tools/: offline toolchain must not be included in release package');
    }

    // 所有 *.md（AGENTS.md 除外）必须排除。
    for (const file of allFiles.filter((entry) => entry.endsWith('.md') && entry !== 'AGENTS.md')) {
      if (!isIgnored(file, ignoreRules)) {
        errors.push(`${file}: markdown documentation must be excluded from release package`);
      }
    }

    // 中间 / 生成 JSON 必须排除。
    for (const file of allFiles.filter((entry) => entry.endsWith('.generated.json') || entry.endsWith('.intermediate.json'))) {
      if (!isIgnored(file, ignoreRules)) {
        errors.push(`${file}: intermediate/generated JSON must be excluded from release package`);
      }
    }

    pushCheck(checks, 'package payload exclusions', before, errors);
  }

  const appJson = await readJson(root, 'app.json', errors);
  await readJson(root, 'package.json', errors);

  // ---- 检查 4：权限 microphone + network（AGENTS.md 必含两者，无多余）----
  {
    const before = errors.length;
    if (await exists(root, 'AGENTS.md')) {
      const agentsContents = await readText(root, 'AGENTS.md');
      validatePermissionSet('AGENTS.md', parseAgentsPermissions(agentsContents), errors, true);
    } else {
      errors.push('AGENTS.md: required file is missing');
    }

    const appPermissions = collectAppJsonPermissions(appJson);
    validatePermissionSet('app.json', appPermissions, errors, false);

    pushCheck(checks, 'microphone/network permissions', before, errors);
  }

  // ---- 检查 5：app.json 路由全部指向存在且未被排除的页面 ----
  {
    const before = errors.length;
    if (!Array.isArray(appJson?.pages) || appJson.pages.length === 0) {
      errors.push('app.json: pages must be a non-empty array');
    } else {
      for (const route of appJson.pages) {
        if (typeof route !== 'string') {
          errors.push(`app.json: invalid route ${JSON.stringify(route)}`);
          continue;
        }

        const resolved = await resolveRoute(root, route);
        if (!resolved) {
          errors.push(`app.json: route does not resolve to an existing page: ${route}`);
        } else if (!includedFiles.includes(resolved)) {
          errors.push(`app.json: route page is excluded from release package: ${resolved}`);
        }
      }
    }
    pushCheck(checks, 'app.json routes', before, errors);
  }

  // ---- 检查 6：grep 运行时泄漏（figure.js import / tools/bootstrap / 文件&JSON 读取）----
  {
    const before = errors.length;
    const payloadFiles = includedFiles.filter((file) => file !== '.aixignore');
    let storyboardLibraryStaticallyImported = false;

    for (const file of payloadFiles) {
      const extension = path.extname(file);
      if (!RUNTIME_SCAN_EXTENSIONS.has(extension)) {
        continue;
      }

      const contents = await readText(root, file);

      if (/import\b[^;\n]*\bfrom\s*['"][^'"]*storyboard-library\.js['"]/.test(contents)) {
        storyboardLibraryStaticallyImported = true;
      }

      if (/\btools\/bootstrap\b/.test(contents)) {
        errors.push(`${file}: contains forbidden tools/bootstrap reference`);
      }

      if (importsFigureGenerator(contents)) {
        errors.push(`${file}: imports offline figure.js generator (runtime must not depend on it)`);
      }

      if (hasRuntimeJsonOrFileLoad(contents)) {
        errors.push(`${file}: contains runtime JSON/file loading dependency (storyboard-library must be a static import)`);
      }
    }

    // storyboard-library 必须作为静态 .js 模块被 import（library.js 持有契约）。
    if (await exists(root, 'lib/library.js') && !storyboardLibraryStaticallyImported) {
      errors.push('lib/storyboard-library.js: must be consumed via static `import` (no static import found in payload)');
    }

    pushCheck(checks, 'grep runtime leak checks', before, errors);
  }

  // ---- 检查 7：运行时引用的 assets 都存在且进包 ----
  {
    const before = errors.length;
    const assetReferences = [];
    const sourceFiles = includedFiles.filter((file) => RUNTIME_SCAN_EXTENSIONS.has(path.extname(file)));

    for (const file of sourceFiles) {
      assetReferences.push(...extractAssetReferences(file, await readText(root, file)));
    }

    for (const reference of assetReferences) {
      if (!await exists(root, reference.assetPath)) {
        errors.push(`${reference.source}: referenced asset is missing: ${reference.assetPath}`);
      } else if (!includedFiles.includes(reference.assetPath)) {
        errors.push(`${reference.source}: referenced asset is excluded: ${reference.assetPath}`);
      }
    }

    const detail = assetReferences.length
      ? `${assetReferences.length} asset reference(s) verified`
      : 'no runtime assets referenced';
    pushCheck(checks, 'necessary assets', before, errors, detail);
  }

  const ok = errors.length === 0;

  return {
    ok,
    checks,
    errors,
    warnings,
    includedFiles,
    summary: formatResult(ok, checks, errors, warnings, includedFiles)
  };
}

async function main() {
  const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
  const result = await runReleasePackageChecks(root);
  console.log(result.summary);
  process.exitCode = result.ok ? 0 : 1;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  await main();
}
