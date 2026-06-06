// T10 · A3 情绪→剪辑节奏（管线 b，模块B 映射 + 确定性回退）。

import { rescueJSON } from '../json-rescue.js';
import { TRANSITIONS, buildVocabContext, pick } from '../vocab.js';

export const MODULE_B = {
  calm: { durations: [5, 4, 5, 6], speeds: ['slow', 'slow', 'medium', 'slow'], transitions: ['dissolve', 'cut', 'fade'] },
  warm: { durations: [4, 4, 3, 5], speeds: ['slow', 'medium', 'medium', 'slow'], transitions: ['dissolve', 'match', 'lcut'] },
  melancholy: { durations: [6, 4, 5, 6], speeds: ['slow', 'medium', 'slow', 'slow'], transitions: ['fade', 'dissolve', 'lcut'] },
  tense: { durations: [3, 2, 2, 4], speeds: ['medium', 'fast', 'veryfast', 'slow'], transitions: ['cut', 'whip', 'jcut'] },
  epic: { durations: [5, 4, 3, 6], speeds: ['slow', 'medium', 'fast', 'slow'], transitions: ['dissolve', 'match', 'fade'] },
  joyful: { durations: [3, 3, 2, 4], speeds: ['medium', 'fast', 'fast', 'medium'], transitions: ['cut', 'match', 'beatcut'] },
  premium: { durations: [4, 4, 5, 5], speeds: ['slow', 'medium', 'slow', 'slow'], transitions: ['dissolve', 'match', 'fade'] },
  energetic: { durations: [2, 2, 2, 3], speeds: ['fast', 'veryfast', 'fast', 'medium'], transitions: ['beatcut', 'whip', 'cut'] }
};

export const RHYTHM_SYSTEM_PROMPT = [
  '你是分镜导演 Agent 的 A3 剪辑节奏规划器。',
  '任务：根据 mood 和 shotCount 输出每镜 duration、cutSpeed、transition、pause。',
  '正常路径必须基于本会话输出 JSON；长度必须等于 shotCount。',
  '节奏弧线：建立段落稍长，中段推进，高潮短促，收尾留白。',
  buildVocabContext(),
  '模块B参考：calm/warm/melancholy 偏慢；tense/energetic/joyful 偏快；epic 由慢到快再留白；premium 稳定精致。',
  '只输出 JSON：{"shots":[{"duration":4,"cutSpeed":"slow","transition":"dissolve","pause":false}]}'
].join('\n');

const CUT_SPEEDS = ['slow', 'medium', 'fast', 'veryfast'];

function clampShotCount(value) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return 4;
  return Math.max(3, Math.min(6, number));
}

function clampDuration(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(1, Math.min(8, Math.round(number)));
}

function normalizeSpeed(value, fallback) {
  return CUT_SPEEDS.includes(value) ? value : fallback;
}

export function buildFallbackRhythm(mood = 'calm', shotCount = 4) {
  const count = clampShotCount(shotCount);
  const table = MODULE_B[mood] || MODULE_B.calm;
  const climaxIndex = Math.max(1, Math.floor(count * 0.65));
  const shots = [];

  for (let i = 0; i < count; i++) {
    const isLast = i === count - 1;
    const durationBase = table.durations[i % table.durations.length];
    const speedBase = table.speeds[i % table.speeds.length];
    const transitionBase = isLast ? 'fade' : table.transitions[i % table.transitions.length];
    shots.push({
      duration: isLast ? Math.max(durationBase, 4) : durationBase,
      cutSpeed: i === climaxIndex && mood !== 'calm' && mood !== 'premium' ? 'fast' : speedBase,
      transition: pick(TRANSITIONS, transitionBase, 'cut').id,
      pause: i === climaxIndex && (mood === 'tense' || mood === 'epic')
    });
  }

  return shots;
}

function normalizeRhythm(payload, mood, shotCount) {
  const fallback = buildFallbackRhythm(mood, shotCount);
  const rawShots = Array.isArray(payload?.shots) ? payload.shots : [];
  if (rawShots.length !== fallback.length) {
    return { shots: fallback, source: 'fallback' };
  }

  return {
    source: 'llm',
    shots: rawShots.map((raw, index) => ({
      duration: clampDuration(raw.duration, fallback[index].duration),
      cutSpeed: normalizeSpeed(raw.cutSpeed, fallback[index].cutSpeed),
      transition: pick(TRANSITIONS, raw.transition, fallback[index].transition).id,
      pause: Boolean(raw.pause)
    }))
  };
}

function destroySession(session) {
  if (session && typeof session.destroy === 'function') {
    try {
      session.destroy();
    } catch (error) {
      console.error('A3 session destroy failed', error);
    }
  }
}

export async function runRhythm(input = {}, options = {}) {
  const mood = input.mood || 'calm';
  const shotCount = clampShotCount(input.shotCount);
  const LanguageModel = options.LanguageModel;
  if (!LanguageModel || typeof LanguageModel.create !== 'function') {
    return { shots: buildFallbackRhythm(mood, shotCount), source: 'fallback' };
  }

  let session;
  let releaseSession;
  try {
    session = await LanguageModel.create({
      initialPrompts: [{ role: 'system', content: RHYTHM_SYSTEM_PROMPT }]
    });
    if (typeof options.onSession === 'function') {
      releaseSession = options.onSession(session, 'rhythm');
    }
    const raw = await session.prompt(JSON.stringify({ mood, shotCount }));
    const parsed = rescueJSON(raw);
    return normalizeRhythm(parsed, mood, shotCount);
  } catch (error) {
    if (!options.silent) console.error('A3 rhythm failed; using fallback', error);
    return { shots: buildFallbackRhythm(mood, shotCount), source: 'fallback' };
  } finally {
    if (typeof releaseSession === 'function') releaseSession();
    destroySession(session);
  }
}

export default {
  MODULE_B,
  RHYTHM_SYSTEM_PROMPT,
  buildFallbackRhythm,
  runRhythm
};
