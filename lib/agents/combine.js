// T12 · A4 组合（纯 JS 无 LLM）。
// 对齐 A2/A3 → 约束 → resolve → board/markdown/filmstripModel/guidance。

import { nearestTemplate, resolveTemplate } from '../library.js';
import { CAMERA_MOVES, COMPOSITIONS, MOODS, SHOT_SIZES, TRANSITIONS, pick } from '../vocab.js';
import { fallbackComposition } from './composition.js';
import { buildFallbackRhythm } from './rhythm.js';

function clampShotCount(value) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return 4;
  return Math.max(3, Math.min(6, number));
}

function durationOf(shot) {
  const value = Number(shot?.duration);
  if (!Number.isFinite(value)) return 4;
  return Math.max(1, Math.min(8, Math.round(value)));
}

function normalizeCutSpeed(value) {
  return ['slow', 'medium', 'fast', 'veryfast'].includes(value) ? value : 'medium';
}

function resolveGuardedTemplate(rawTemplateId, intent, usedCameras) {
  let template = resolveTemplate(rawTemplateId);
  const cameraId = template.camera.id;
  if (usedCameras.has(cameraId) || usedCameras.size < 3) {
    usedCameras.add(cameraId);
    return template;
  }

  const replacement = nearestTemplate({
    mood: intent.mood,
    scene: intent.scene,
    allowedCameras: Array.from(usedCameras),
    disallowedCameras: [cameraId]
  });
  template = resolveTemplate(replacement?.id || rawTemplateId);
  usedCameras.add(template.camera.id);
  return template;
}

export function buildGuidance(board) {
  return board.shots.map((shot) => {
    const cameraDesc = CAMERA_MOVES[shot.camera.id]?.desc || shot.camera.label;
    const transitionDesc = TRANSITIONS[shot.transition.id]?.desc || shot.transition.label;
    return `镜${shot.index} · ${shot.shotSize.label}/${shot.composition.label}/${shot.camera.label}：${cameraDesc}，保持 ${shot.duration}s，${transitionDesc}`;
  });
}

export function buildEditingFlow(shots) {
  return shots.map((shot, index) => ({
    step: index + 1,
    shot: `镜头 ${shot.index}`,
    duration: shot.duration,
    transition: shot.transition.id,
    transitionLabel: shot.transition.label,
    next: index < shots.length - 1 ? `镜头 ${shots[index + 1].index}` : '结束'
  }));
}

export function buildFilmstripModel(board) {
  return {
    palette: { bg: '#000000', fg: '#40FF5E' },
    shotCount: board.shotCount,
    totalDuration: board.totalDuration,
    cells: board.shots.map((shot) => ({
      index: shot.index,
      templateId: shot.templateId,
      duration: shot.duration,
      cutSpeed: shot.cutSpeed,
      transition: shot.transition.id,
      pause: shot.pause,
      shotSize: shot.shotSize,
      composition: shot.composition,
      camera: shot.camera,
      figure: shot.figure
    }))
  };
}

export function buildMarkdown(board) {
  const lines = [
    `## ${board.title}`,
    '',
    `- 镜数：${board.shotCount}`,
    `- 总时长：${board.totalDuration}s`,
    `- 情绪基调：${board.mood.label}`,
    `- 模板编号：${board.templates.join(' / ')}`,
    '',
    '### 分镜数组',
    ''
  ];

  for (const shot of board.shots) {
    lines.push(
      `**镜${shot.index}｜${shot.duration}s｜${shot.shotSize.label}｜${shot.composition.label}｜${shot.camera.label}**`,
      '',
      shot.description,
      '',
      `转场：${shot.transition.label}；剪辑速度：${shot.cutSpeed}`,
      ''
    );
  }

  lines.push('### 串联剪辑', '');
  for (const flow of board.editingFlow) {
    lines.push(`- ${flow.shot} ${flow.duration}s → ${flow.transitionLabel} → ${flow.next}`);
  }

  return lines.join('\n');
}

export function combineStoryboard(intent = {}, compositionResult = {}, rhythmResult = {}) {
  const shotCount = clampShotCount(intent.shotCount);
  const safeMood = pick(MOODS, intent.mood, 'calm');
  const composition = Array.isArray(compositionResult.shots) && compositionResult.shots.length
    ? compositionResult
    : fallbackComposition({ ...intent, mood: safeMood.id, shotCount });
  const rhythmShots = Array.isArray(rhythmResult.shots) && rhythmResult.shots.length === shotCount
    ? rhythmResult.shots
    : buildFallbackRhythm(safeMood.id, shotCount);

  const usedCameras = new Set();
  const shots = [];

  for (let i = 0; i < shotCount; i++) {
    const compositionShot = composition.shots[i] || fallbackComposition({ ...intent, shotCount }).shots[i];
    const rhythmShot = rhythmShots[i] || buildFallbackRhythm(safeMood.id, shotCount)[i];
    const template = resolveGuardedTemplate(compositionShot.templateId, { ...intent, mood: safeMood.id }, usedCameras);
    const transition = pick(TRANSITIONS, rhythmShot.transition, 'cut');
    shots.push({
      index: i + 1,
      title: `镜头 ${i + 1}`,
      duration: durationOf(rhythmShot),
      shotSize: pick(SHOT_SIZES, template.caption.shotSize, 'medium'),
      composition: pick(COMPOSITIONS, template.caption.composition, 'center'),
      camera: pick(CAMERA_MOVES, template.caption.camera, 'fixed'),
      transition,
      cutSpeed: normalizeCutSpeed(rhythmShot.cutSpeed),
      pause: Boolean(rhythmShot.pause),
      templateId: template.id,
      figure: template.figure,
      description: String(compositionShot.description || template.decisionHint || '').trim()
    });
  }

  const totalDuration = shots.reduce((sum, shot) => sum + shot.duration, 0);
  const board = {
    title: `${intent.subject || '分镜'} · ${intent.scene || '场景'}`,
    mood: safeMood,
    templates: shots.map((shot) => shot.templateId),
    shotCount,
    totalDuration,
    shots,
    editingFlow: buildEditingFlow(shots),
    guidance: []
  };

  board.guidance = buildGuidance(board);
  board.markdown = buildMarkdown(board);
  board.filmstripModel = buildFilmstripModel(board);
  return board;
}

export default {
  combineStoryboard,
  buildMarkdown,
  buildGuidance,
  buildEditingFlow,
  buildFilmstripModel
};
