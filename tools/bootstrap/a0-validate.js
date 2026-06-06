/**
 * T05 · A0 中间 JSON / 静态库校验器。
 *
 * 用法：
 *   node tools/bootstrap/a0-validate.js
 *   node tools/bootstrap/a0-validate.js --write-static
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CAMERA_MOVES, COMPOSITIONS, MOODS, SHOT_SIZES } from '../../lib/vocab.js';
import { assertFigure } from '../../lib/figure.js';

export const INTERMEDIATE_LIBRARY_URL = new URL('./storyboard-library.generated.json', import.meta.url);
export const STATIC_LIBRARY_URL = new URL('../../lib/storyboard-library.js', import.meta.url);

export const INTERMEDIATE_LIBRARY_PATH = fileURLToPath(INTERMEDIATE_LIBRARY_URL);
export const STATIC_LIBRARY_PATH = fileURLToPath(STATIC_LIBRARY_URL);

const REQUIRED_TEMPLATE_KEYS = ['id', 'figure', 'caption', 'decisionHint', 'sceneFit'];
const REQUIRED_DATA_FIELDS = ['figure', 'caption', 'decisionHint', 'sceneFit'];
const MIN_TEMPLATES = 18;
const MAX_TEMPLATES = 24;
const MIN_TEMPLATES_PER_MOOD = 3;

function fail(message) {
  throw new Error(`A0 validation failed: ${message}`);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertKnown(map, value, path) {
  assert(typeof value === 'string' && Object.prototype.hasOwnProperty.call(map, value), `${path} must be a vocab id`);
}

function sortedKeys(value) {
  return Object.keys(value).sort();
}

function assertExactTemplateKeys(template, index) {
  const actual = sortedKeys(template);
  const expected = [...REQUIRED_TEMPLATE_KEYS].sort();
  assert(
    actual.length === expected.length && actual.every((key, keyIndex) => key === expected[keyIndex]),
    `templates[${index}] must contain id plus exactly 4 data fields: ${REQUIRED_DATA_FIELDS.join(', ')}`
  );
}

function assertStringArray(value, path) {
  assert(Array.isArray(value), `${path} must be an array`);
  assert(value.length > 0, `${path} must contain at least one item`);
  value.forEach((item, index) => {
    assert(typeof item === 'string' && item.trim().length > 0, `${path}[${index}] must be a non-empty string`);
  });
}

function validateTemplate(template, index, seenIds, moodCoverage, compositionCoverage, sceneSet) {
  assert(isPlainObject(template), `templates[${index}] must be an object`);
  assertExactTemplateKeys(template, index);

  assert(/^T\d{2}$/.test(template.id), `templates[${index}].id must match Tnn`);
  assert(!seenIds.has(template.id), `duplicate template id ${template.id}`);
  seenIds.add(template.id);

  assertFigure(template.figure);

  assert(isPlainObject(template.caption), `${template.id}.caption must be an object`);
  assertKnown(COMPOSITIONS, template.caption.composition, `${template.id}.caption.composition`);
  assertKnown(SHOT_SIZES, template.caption.shotSize, `${template.id}.caption.shotSize`);
  assertKnown(CAMERA_MOVES, template.caption.camera, `${template.id}.caption.camera`);
  compositionCoverage.set(template.caption.composition, (compositionCoverage.get(template.caption.composition) ?? 0) + 1);

  assert(typeof template.decisionHint === 'string' && template.decisionHint.trim().length >= 12, `${template.id}.decisionHint is too short`);

  assert(isPlainObject(template.sceneFit), `${template.id}.sceneFit must be an object`);
  assertStringArray(template.sceneFit.moods, `${template.id}.sceneFit.moods`);
  assertStringArray(template.sceneFit.scenes, `${template.id}.sceneFit.scenes`);
  template.sceneFit.moods.forEach((mood) => {
    assertKnown(MOODS, mood, `${template.id}.sceneFit.moods`);
    moodCoverage.set(mood, (moodCoverage.get(mood) ?? 0) + 1);
  });
  template.sceneFit.scenes.forEach((scene) => sceneSet.add(scene));
}

export function normalizeLibrary(library) {
  assert(isPlainObject(library), 'library must be an object');
  assert(Array.isArray(library.templates), 'library.templates must be an array');
  return {
    schemaVersion: library.schemaVersion,
    generatedBy: library.generatedBy,
    palette: {
      bg: library.palette?.bg,
      fg: library.palette?.fg
    },
    templates: library.templates.map((template) => ({
      id: template.id,
      figure: template.figure,
      caption: {
        composition: template.caption?.composition,
        shotSize: template.caption?.shotSize,
        camera: template.caption?.camera
      },
      decisionHint: template.decisionHint,
      sceneFit: {
        moods: [...(template.sceneFit?.moods ?? [])],
        scenes: [...(template.sceneFit?.scenes ?? [])]
      }
    }))
  };
}

export function validateLibrary(library) {
  assert(library.schemaVersion === 1, 'schemaVersion must be 1');
  assert(library.generatedBy === 'A0-bootstrap-handwritten-v1', 'generatedBy must mark A0 bootstrap');
  assert(library.palette?.bg === '#000' && library.palette?.fg === '#40FF5E', 'palette must be #000 / #40FF5E');
  assert(Array.isArray(library.templates), 'templates must be an array');
  assert(library.templates.length >= MIN_TEMPLATES, `templates must contain at least ${MIN_TEMPLATES} items`);
  assert(library.templates.length <= MAX_TEMPLATES, `templates must contain at most ${MAX_TEMPLATES} items`);

  const seenIds = new Set();
  const moodCoverage = new Map(Object.keys(MOODS).map((mood) => [mood, 0]));
  const compositionCoverage = new Map(Object.keys(COMPOSITIONS).map((composition) => [composition, 0]));
  const sceneSet = new Set();

  library.templates.forEach((template, index) => {
    validateTemplate(template, index, seenIds, moodCoverage, compositionCoverage, sceneSet);
  });

  for (const mood of Object.keys(MOODS)) {
    assert(
      (moodCoverage.get(mood) ?? 0) >= MIN_TEMPLATES_PER_MOOD,
      `mood ${mood} must have at least ${MIN_TEMPLATES_PER_MOOD} templates`
    );
  }

  const moduleACompositions = ['center', 'thirds', 'symmetry', 'vast', 'frame', 'leading', 'lowangle', 'topdown', 'silhouette', 'shallow'];
  for (const composition of moduleACompositions) {
    assert((compositionCoverage.get(composition) ?? 0) >= 1, `composition ${composition} must be covered`);
  }

  return {
    ok: true,
    count: library.templates.length,
    moodCoverage: Object.fromEntries(moodCoverage),
    compositionCoverage: Object.fromEntries(compositionCoverage),
    sceneCount: sceneSet.size,
    scenes: [...sceneSet].sort()
  };
}

export async function readIntermediateLibrary(inputPath = INTERMEDIATE_LIBRARY_PATH) {
  const text = await readFile(inputPath, 'utf8');
  return normalizeLibrary(JSON.parse(text));
}

export function toStaticModuleSource(library) {
  return [
    '// T05 · 死模板库静态模块。由 A0 离线中间 JSON 生成。',
    '// 生产运行时只 import 本模块，不读取 JSON 文件，不依赖离线生成器。',
    '',
    `export const STORYBOARD_LIBRARY = ${JSON.stringify(library, null, 2)};`,
    ''
  ].join('\n');
}

export async function writeStaticLibraryModule(library, outputPath = STATIC_LIBRARY_PATH) {
  await writeFile(outputPath, toStaticModuleSource(normalizeLibrary(library)), 'utf8');
  return outputPath;
}

export async function validateStaticLibraryModule(modulePath = STATIC_LIBRARY_PATH) {
  const moduleUrl = `${pathToFileURL(modulePath).href}?validate=${Date.now()}`;
  const { STORYBOARD_LIBRARY } = await import(moduleUrl);
  return validateLibrary(normalizeLibrary(STORYBOARD_LIBRARY));
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';

if (import.meta.url === invokedPath) {
  const args = new Set(process.argv.slice(2));
  const library = await readIntermediateLibrary();
  const summary = validateLibrary(library);

  if (args.has('--write-static')) {
    await writeStaticLibraryModule(library);
    await validateStaticLibraryModule();
  }

  console.log(`A0 validation ok: ${summary.count} templates`);
  console.log(`mood coverage: ${JSON.stringify(summary.moodCoverage)}`);
  console.log(`composition coverage: ${JSON.stringify(summary.compositionCoverage)}`);
  console.log(`scene count: ${summary.sceneCount}`);
}
