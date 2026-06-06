// T11 · A1 意图分析 + 追问循环（单会话）。

import { MOODS, buildVocabContext, pick } from '../vocab.js';
import { rescueJSON } from '../json-rescue.js';

export const MAX_CLARIFY = 2;

export const INTENT_SYSTEM_PROMPT = [
  '你是分镜导演 Agent 的 A1 意图分析器。',
  '任务：从用户中文口述中抽取 subject、scene、visualIntent、mood、shotCount。',
  '仅当主体、场景、情绪三者都足够明确时 ready=true。',
  '信息不足时 ready=false，只问一个定向问题，ask 必须中文、无 emoji、短句。',
  'shotCount 必须是 3 到 6 的整数；缺省按情绪和复杂度给 3 到 5。',
  buildVocabContext(),
  '只输出 JSON：{"ready":boolean,"ask":string,"missing":[],"intent":{"subject":string,"scene":string,"visualIntent":string,"mood":string,"shotCount":number}}'
].join('\n');

const MOOD_KEYWORDS = [
  ['tense', ['紧张', '压迫', '悬疑', '危险', '焦虑']],
  ['epic', ['史诗', '壮阔', '宏大', '震撼', '辽阔']],
  ['energetic', ['动感', '速度', '运动', '快节奏', '燃']],
  ['joyful', ['欢快', '快乐', '活泼', '轻松', '开心']],
  ['premium', ['高级', '质感', '商业', '精致', '奢华']],
  ['melancholy', ['忧郁', '孤独', '失落', '伤感', '冷清']],
  ['warm', ['温暖', '治愈', '亲密', '柔和']],
  ['calm', ['平静', '安静', '舒缓', '宁静']]
];

const SCENE_KEYWORDS = [
  '公路', '街道', '城市', '室内', '房间', '海边', '山野', '展厅', '店铺',
  '舞台', '餐厅', '夜路', '走廊', '窗边', '门口', '运动', '桌面', '产品'
];

function clampShotCount(value, fallback = 4) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(3, Math.min(6, number));
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function inferMood(text) {
  for (const [mood, words] of MOOD_KEYWORDS) {
    if (words.some((word) => text.includes(word))) return mood;
  }
  return '';
}

function inferScene(text) {
  const hit = SCENE_KEYWORDS.find((word) => text.includes(word));
  return hit || '';
}

function inferShotCount(text, mood) {
  const match = text.match(/([3-6])\s*(?:个)?镜(?:头)?/);
  if (match) return clampShotCount(match[1]);
  if (mood === 'tense' || mood === 'energetic') return 5;
  if (mood === 'epic') return 5;
  return 4;
}

function inferSubject(text) {
  const cleaned = cleanText(text);
  const match = cleaned.match(/(?:拍|拍摄|做|生成|设计)(?:一个|一条|一段)?(.{2,24}?)(?:，|。|,|$)/);
  if (match) return cleanText(match[1]);
  return cleaned.length >= 4 ? cleaned.slice(0, 24) : '';
}

function buildAsk(missing) {
  if (missing.includes('subject')) return '你想拍摄的主体是什么？';
  if (missing.includes('scene')) return '这个主体出现在哪个场景里？';
  if (missing.includes('mood')) return '你想要哪种情绪基调？';
  return '再补充一句主体、场景或情绪。';
}

function normalizeIntentPayload(payload, text, clarifyCount) {
  const rawIntent = payload?.intent || {};
  const joinedText = cleanText(text);
  const inferredMood = inferMood(joinedText);
  const mood = pick(MOODS, rawIntent.mood || inferredMood, inferredMood || 'calm').id;
  const scene = cleanText(rawIntent.scene) || inferScene(joinedText);
  const subject = cleanText(rawIntent.subject) || inferSubject(joinedText);
  const visualIntent = cleanText(rawIntent.visualIntent) || joinedText || subject;
  const shotCount = clampShotCount(rawIntent.shotCount, inferShotCount(joinedText, mood));

  const missing = [];
  if (!subject) missing.push('subject');
  if (!scene) missing.push('scene');
  if (!rawIntent.mood && !inferredMood) missing.push('mood');

  const mustForceReady = clarifyCount >= MAX_CLARIFY;
  const intent = {
    subject: subject || '待拍主体',
    scene: scene || '日常场景',
    visualIntent: visualIntent || '清晰呈现主体与情绪',
    mood: mood || 'calm',
    shotCount
  };

  const explicitReady = typeof payload?.ready === 'boolean' ? payload.ready : missing.length === 0;
  const ready = mustForceReady ? true : explicitReady && missing.length === 0;
  if (ready) {
    return { ready: true, ask: '', missing: [], intent };
  }

  return {
    ready: false,
    ask: cleanText(payload?.ask) || buildAsk(missing),
    missing,
    intent
  };
}

export async function createIntentSession(LanguageModel, options = {}) {
  if (!LanguageModel || typeof LanguageModel.create !== 'function') {
    throw new Error('LanguageModel.create unavailable');
  }
  const session = await LanguageModel.create({
    initialPrompts: [{ role: 'system', content: INTENT_SYSTEM_PROMPT }]
  });
  if (typeof options.onSession === 'function') {
    options.onSession(session, 'intent');
  }
  return session;
}

export async function runIntent(text, options = {}) {
  const clarifyCount = Number.isFinite(options.clarifyCount) ? options.clarifyCount : 0;
  const prompt = [
    `追问轮次：${clarifyCount}/${MAX_CLARIFY}`,
    '请基于本轮和同会话上下文分析意图。若达到追问上限，即使仍有缺项也用合理默认值 ready=true。',
    text
  ].join('\n');

  let parsed = null;
  try {
    if (!options.session || typeof options.session.prompt !== 'function') {
      throw new Error('A1 session unavailable');
    }
    parsed = rescueJSON(await options.session.prompt(prompt));
  } catch (error) {
    parsed = null;
  }

  return normalizeIntentPayload(parsed || {}, text, clarifyCount);
}

export default {
  MAX_CLARIFY,
  INTENT_SYSTEM_PROMPT,
  createIntentSession,
  runIntent
};
