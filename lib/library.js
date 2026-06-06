// T06 · 死模板库加载与索引。
// 运行时只 import 静态 JS 数据，不读文件、不生成模板。

import { STORYBOARD_LIBRARY } from './storyboard-library.js';
import { CAMERA_MOVES, COMPOSITIONS, MOODS, SHOT_SIZES, pick } from './vocab.js';

let templateById = null;

function ensureIndex() {
  if (templateById) return templateById;
  templateById = new Map();
  for (const template of STORYBOARD_LIBRARY.templates || []) {
    templateById.set(template.id, template);
  }
  return templateById;
}

export function loadLibrary() {
  ensureIndex();
  return STORYBOARD_LIBRARY;
}

export function listTemplates() {
  return loadLibrary().templates || [];
}

export function getById(id) {
  return ensureIndex().get(id) || null;
}

export function resolveTemplate(id) {
  const template = getById(id) || listTemplates()[0];
  const caption = template.caption || {};
  return {
    ...template,
    shotSize: pick(SHOT_SIZES, caption.shotSize, 'medium'),
    composition: pick(COMPOSITIONS, caption.composition, 'center'),
    camera: pick(CAMERA_MOVES, caption.camera, 'fixed')
  };
}

export function buildLibraryIndexForPrompt() {
  return listTemplates()
    .map((template) => {
      const caption = template.caption || {};
      const shotSize = pick(SHOT_SIZES, caption.shotSize, 'medium').label;
      const composition = pick(COMPOSITIONS, caption.composition, 'center').label;
      const camera = pick(CAMERA_MOVES, caption.camera, 'fixed').label;
      const moods = (template.sceneFit?.moods || [])
        .map((mood) => pick(MOODS, mood, 'calm').label)
        .join('/');
      const scenes = (template.sceneFit?.scenes || []).join('/');
      return `${template.id}｜${shotSize}/${composition}/${camera}｜${template.decisionHint}｜情绪:${moods}｜场景:${scenes}`;
    })
    .join('\n');
}

function includesText(list, text) {
  if (!text) return false;
  return (list || []).some((item) => String(text).includes(item) || String(item).includes(text));
}

function scoreTemplate(template, query = {}) {
  const caption = template.caption || {};
  const sceneFit = template.sceneFit || {};
  let score = 0;

  if (query.mood && (sceneFit.moods || []).includes(query.mood)) score += 8;
  if (query.scene && includesText(sceneFit.scenes, query.scene)) score += 4;
  if (query.camera && caption.camera === query.camera) score += 3;
  if (query.composition && caption.composition === query.composition) score += 3;
  if (query.shotSize && caption.shotSize === query.shotSize) score += 2;
  if (query.allowedCameras && query.allowedCameras.includes(caption.camera)) score += 5;
  if (query.disallowedCameras && query.disallowedCameras.includes(caption.camera)) score -= 8;

  return score;
}

export function nearestTemplate(query = {}) {
  const templates = listTemplates();
  if (!templates.length) return null;
  let best = templates[0];
  let bestScore = -Infinity;
  for (const template of templates) {
    const score = scoreTemplate(template, query);
    if (score > bestScore) {
      best = template;
      bestScore = score;
    }
  }
  return best;
}

export default {
  loadLibrary,
  listTemplates,
  getById,
  resolveTemplate,
  buildLibraryIndexForPrompt,
  nearestTemplate
};
