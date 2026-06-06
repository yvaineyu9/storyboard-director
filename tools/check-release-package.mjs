import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_FILES = [
  'AGENTS.md',
  'app.js',
  'app.json',
  'package.json',
  'lib/storyboard-library.js',
  'lib/vocab.js',
  'lib/library.js',
  'lib/json-rescue.js'
];

const REQUIRED_DIRS = [
  'pages',
  'lib',
  'lib/agents',
  'lib/renderer'
];

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

const REQUIRED_AIXIGNORE_RULES = [
  'tools/',
  'tools/bootstrap/',
  'lib/figure.js',
  'README.md',
  '*.png',
  '*.snap',
  '**/__snapshots__/',
  '*.intermediate.json'
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

function hasRuntimeJsonOrFileLoad(contents) {
  const patterns = [
    /\breadFile(?:Sync)?\b/,
    /\bgetFileSystemManager\s*\(/,
    /\bfs\s*\.\s*(?:readFile|readFileSync)\b/,
    /import\s+(?:[^'"]+\s+from\s+)?['"][^'"]+\.json['"]/,
    /import\s*\(\s*['"][^'"]+\.json['"]\s*\)/,
    /require\s*\(\s*['"][^'"]+\.json['"]\s*\)/,
    /fetch\s*\(\s*['"][^'"]+\.json(?:[?#][^'"]*)?['"]\s*\)/
  ];

  return patterns.some((pattern) => pattern.test(contents));
}

function importsFigureGenerator(contents) {
  return /import\s*(?:\([^)]*figure\.js|[^;]*['"][^'"]*figure\.js['"])/.test(contents);
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
  includedFiles = allFiles.filter((file) => !isIgnored(file, ignoreRules));

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

  {
    const before = errors.length;
    for (const file of includedFiles) {
      const rootEntry = packageRootOf(file);
      if (!RUNTIME_ALLOWED_ROOTS.has(rootEntry)) {
        errors.push(`${file}: not allowed in release package payload`);
      }
    }

    if (includedFiles.includes('lib/figure.js')) {
      errors.push('lib/figure.js: offline figure generator must not be included in release package');
    }

    for (const file of allFiles.filter((entry) => entry.endsWith('.md') && entry !== 'AGENTS.md')) {
      if (!isIgnored(file, ignoreRules)) {
        errors.push(`${file}: markdown documentation must be excluded from release package`);
      }
    }

    pushCheck(checks, 'package payload exclusions', before, errors);
  }

  const appJson = await readJson(root, 'app.json', errors);
  const packageJson = await readJson(root, 'package.json', errors);

  {
    const before = errors.length;
    if (!packageJson?.scripts?.['check:release']) {
      errors.push('package.json: missing scripts.check:release');
    }
    pushCheck(checks, 'release check script entry', before, errors);
  }

  {
    const before = errors.length;
    if (await exists(root, 'AGENTS.md')) {
      const agentsContents = await readText(root, 'AGENTS.md');
      validatePermissionSet('AGENTS.md', parseAgentsPermissions(agentsContents), errors, true);
    }

    const appPermissions = collectAppJsonPermissions(appJson);
    validatePermissionSet('app.json', appPermissions, errors, false);

    pushCheck(checks, 'microphone/network permissions', before, errors);
  }

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

  {
    const before = errors.length;
    const payloadFiles = includedFiles.filter((file) => file !== '.aixignore');

    for (const file of payloadFiles) {
      const extension = path.extname(file);
      if (!RUNTIME_SCAN_EXTENSIONS.has(extension)) {
        continue;
      }

      const contents = await readText(root, file);

      if (contents.includes('tools/bootstrap')) {
        errors.push(`${file}: contains forbidden tools/bootstrap reference`);
      }

      if (importsFigureGenerator(contents)) {
        errors.push(`${file}: imports offline figure.js generator`);
      }

      if (hasRuntimeJsonOrFileLoad(contents)) {
        errors.push(`${file}: contains runtime JSON/file loading dependency`);
      }
    }

    pushCheck(checks, 'grep runtime leak checks', before, errors);
  }

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
