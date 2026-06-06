// T09 · A2 画面→构图（管线 a，独立会话，调用死模板）。

import { rescueJSON } from '../json-rescue.js';
import { buildLibraryIndexForPrompt, getById, nearestTemplate } from '../library.js';
import { buildVocabContext } from '../vocab.js';

export const COMPOSITION_SYSTEM_PROMPT = [
  '你是分镜导演 Agent 的 A2 构图规划器。',
  '任务：根据 A1 intent 为每一镜选择一个已存在的死模板编号，不得生成新模板、不得改写模板。',
  '必须输出长度等于 shotCount 的 shots；templateId 必须来自模板索引。',
  '跨模板混搭护栏：运镜手法尽量不超过 3 种，情绪基调沿用 A1，不另起情绪。',
  buildVocabContext(),
  '【死模板索引】',
  buildLibraryIndexForPrompt(),
  '只输出 JSON：{"shots":[{"templateId":"T01","beat":"establish","description":"中文短句"}],"cameraUsed":["fixed"]}'
].join('\n');

function clampShotCount(value) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return 4;
  return Math.max(3, Math.min(6, number));
}

function pickBeat(index, count) {
  if (index === 0) return 'establish';
  if (index === count - 1) return 'close';
  if (index === Math.max(1, Math.floor(count * 0.65))) return 'climax';
  return 'build';
}

function templateFor(intent, index) {
  const cameraBias = index === 0 ? 'fixed' : '';
  return nearestTemplate({
    mood: intent.mood,
    scene: intent.scene,
    camera: cameraBias
  });
}

export function fallbackComposition(intent = {}) {
  const shotCount = clampShotCount(intent.shotCount);
  const shots = [];
  const cameraUsed = [];
  for (let i = 0; i < shotCount; i++) {
    const template = templateFor(intent, i);
    const camera = template?.caption?.camera || 'fixed';
    if (!cameraUsed.includes(camera)) cameraUsed.push(camera);
    shots.push({
      templateId: template?.id || 'T01',
      beat: pickBeat(i, shotCount),
      description: `${intent.scene || '场景'}中呈现${intent.subject || '主体'}，${pickBeat(i, shotCount)} 段落。`
    });
  }
  return { shots, cameraUsed, source: 'fallback' };
}

function normalizeComposition(payload, intent) {
  const shotCount = clampShotCount(intent.shotCount);
  const fallback = fallbackComposition(intent);
  const rawShots = Array.isArray(payload?.shots) ? payload.shots : [];
  const shots = [];
  const cameraUsed = [];

  for (let i = 0; i < shotCount; i++) {
    const raw = rawShots[i] || {};
    let template = getById(raw.templateId);
    if (!template) {
      template = getById(fallback.shots[i]?.templateId) || nearestTemplate({ mood: intent.mood, scene: intent.scene });
    }
    const camera = template?.caption?.camera || 'fixed';
    if (!cameraUsed.includes(camera)) cameraUsed.push(camera);
    shots.push({
      templateId: template?.id || 'T01',
      beat: raw.beat || fallback.shots[i]?.beat || pickBeat(i, shotCount),
      description: String(raw.description || fallback.shots[i]?.description || '').trim()
    });
  }

  return { shots, cameraUsed, source: payload ? 'llm' : 'fallback' };
}

function destroySession(session) {
  if (session && typeof session.destroy === 'function') {
    try {
      session.destroy();
    } catch (error) {
      console.error('A2 session destroy failed', error);
    }
  }
}

export async function runComposition(intent, options = {}) {
  const LanguageModel = options.LanguageModel;
  if (!LanguageModel || typeof LanguageModel.create !== 'function') {
    return fallbackComposition(intent);
  }

  let session;
  let releaseSession;
  try {
    session = await LanguageModel.create({
      initialPrompts: [{ role: 'system', content: COMPOSITION_SYSTEM_PROMPT }]
    });
    if (typeof options.onSession === 'function') {
      releaseSession = options.onSession(session, 'composition');
    }
    const raw = await session.prompt(JSON.stringify({ intent }));
    const parsed = rescueJSON(raw);
    if (!parsed || !Array.isArray(parsed.shots) || parsed.shots.length !== clampShotCount(intent.shotCount)) {
      return fallbackComposition(intent);
    }
    return normalizeComposition(parsed, intent);
  } catch (error) {
    if (!options.silent) console.error('A2 composition failed; using fallback', error);
    return fallbackComposition(intent);
  } finally {
    if (typeof releaseSession === 'function') releaseSession();
    destroySession(session);
  }
}

export default {
  COMPOSITION_SYSTEM_PROMPT,
  fallbackComposition,
  runComposition
};
