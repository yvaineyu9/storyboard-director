/**
 * T06 · 死模板库加载与索引。
 *
 * 运行时只从静态 ES module 读取数据；不读 JSON，不访问文件系统。
 */

import { STORYBOARD_LIBRARY } from './storyboard-library.js';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) {
    deepFreeze(item);
  }
  return Object.freeze(value);
}

const FROZEN_LIBRARY = deepFreeze(STORYBOARD_LIBRARY);
const STATIC_TEMPLATE_BY_ID = new Map(FROZEN_LIBRARY.templates.map((template) => [template.id, template]));

function templatesOf(library = FROZEN_LIBRARY) {
  return Array.isArray(library?.templates) ? library.templates : [];
}

function byIdFor(library = FROZEN_LIBRARY) {
  if (library === FROZEN_LIBRARY || library === STORYBOARD_LIBRARY) return STATIC_TEMPLATE_BY_ID;
  return new Map(templatesOf(library).map((template) => [template.id, template]));
}

function captionKey(caption) {
  return `${caption.composition}/${caption.shotSize}/${caption.camera}`;
}

function sceneFitKey(sceneFit) {
  return `moods=${sceneFit.moods.join(',')}; scenes=${sceneFit.scenes.join(',')}`;
}

function normalizeText(value) {
  return String(value ?? '').trim().toLowerCase();
}

function sceneScore(sceneFit, scene) {
  const query = normalizeText(scene);
  if (!query) return 0;
  let score = 0;
  for (const candidate of sceneFit.scenes) {
    const normalized = normalizeText(candidate);
    if (normalized === query) score = Math.max(score, 6);
    else if (normalized.includes(query) || query.includes(normalized)) score = Math.max(score, 3);
  }
  return score;
}

function scoreTemplate(template, query) {
  let score = 0;
  if (query.mood && template.sceneFit.moods.includes(query.mood)) score += 10;
  if (query.scene) score += sceneScore(template.sceneFit, query.scene);
  if (query.camera && template.caption.camera === query.camera) score += 4;
  if (query.composition && template.caption.composition === query.composition) score += 4;
  return score;
}

export function loadLibrary() {
  return FROZEN_LIBRARY;
}

export function getById(id, library = FROZEN_LIBRARY) {
  if (typeof id !== 'string' || id.trim() === '') return null;
  return byIdFor(library).get(id) ?? null;
}

export function buildLibraryIndexForPrompt(library = FROZEN_LIBRARY) {
  return templatesOf(library)
    .map((template) => `${template.id}｜${captionKey(template.caption)}｜${template.decisionHint}｜${sceneFitKey(template.sceneFit)}`)
    .join('\n');
}

export function nearestTemplate(query = {}, library = FROZEN_LIBRARY) {
  let best = null;
  let bestScore = -1;

  for (const template of templatesOf(library)) {
    const score = scoreTemplate(template, query);
    if (score > bestScore) {
      best = template;
      bestScore = score;
    }
  }

  return best;
}
