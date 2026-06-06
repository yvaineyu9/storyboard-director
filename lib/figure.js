/**
 * T03 · 构图原语生成器（仅 A0 离线用）。
 *
 * 原语契约供 T03 烘焙器与 T13 渲染器共用：
 * - 坐标系固定为 viewBox=[1,1]，所有点位、尺寸、半径均归一化到 0..1。
 * - 颜色不进入原语；Canvas 渲染器固定使用 #000 / #40FF5E 两层色。
 * - fill 默认 false，表示描边；true 表示填充。
 */

import { COMPOSITIONS, SHOT_SIZES } from './vocab.js';

export const FIGURE_VIEW_BOX = [1, 1];

export const PRIMITIVE_KINDS = ['line', 'rect', 'circle', 'polyline'];

export const FIGURE_PRIMITIVE_CONTRACT = {
  viewBox: FIGURE_VIEW_BOX,
  coordinateRange: [0, 1],
  color: 'renderer-owned: bg=#000, fg=#40FF5E',
  kinds: {
    line: {
      shape: '{ kind:"line", from:[x,y], to:[x,y], width?:number }',
      draw: 'stroke from -> to'
    },
    rect: {
      shape: '{ kind:"rect", at:[x,y], size:[w,h], fill?:boolean, width?:number }',
      draw: 'fillRect or strokeRect at top-left'
    },
    circle: {
      shape: '{ kind:"circle", at:[x,y], r:number, fill?:boolean, width?:number }',
      draw: 'arc centered at at'
    },
    polyline: {
      shape: '{ kind:"polyline", points:[[x,y],...], closed?:boolean, fill?:boolean, width?:number }',
      draw: 'moveTo first point, lineTo each remaining point, closePath when closed'
    }
  }
};

export const MODULE_A_COMPOSITIONS = [
  'center',
  'thirds',
  'symmetry',
  'vast',
  'frame',
  'leading',
  'lowangle',
  'topdown',
  'silhouette',
  'shallow'
];

export const SUPPORTED_COMPOSITIONS = [...MODULE_A_COMPOSITIONS, 'bisect'];

const DEFAULT_WIDTH = 0.012;

function clamp(value, min = 0, max = 1) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function round(value) {
  return Number(clamp(value).toFixed(4));
}

function roundWidth(value = DEFAULT_WIDTH) {
  return Number(Math.max(0.002, Math.min(0.08, value)).toFixed(4));
}

function point(x, y) {
  return [round(x), round(y)];
}

function line(from, to, width = DEFAULT_WIDTH) {
  return { kind: 'line', from: point(from[0], from[1]), to: point(to[0], to[1]), width: roundWidth(width) };
}

function rect(at, size, fill = false, width = DEFAULT_WIDTH) {
  const w = clamp(size[0], 0.001, 1);
  const h = clamp(size[1], 0.001, 1);
  const x = clamp(at[0], 0, 1 - w);
  const y = clamp(at[1], 0, 1 - h);
  return {
    kind: 'rect',
    at: point(x, y),
    size: [round(w), round(h)],
    fill: Boolean(fill),
    width: roundWidth(width)
  };
}

function circle(at, radius, fill = false, width = DEFAULT_WIDTH) {
  const r = clamp(radius, 0.002, 0.5);
  const x = clamp(at[0], r, 1 - r);
  const y = clamp(at[1], r, 1 - r);
  return { kind: 'circle', at: point(x, y), r: round(r), fill: Boolean(fill), width: roundWidth(width) };
}

function polyline(points, options = {}) {
  return {
    kind: 'polyline',
    points: points.map(([x, y]) => point(x, y)),
    closed: Boolean(options.closed),
    fill: Boolean(options.fill),
    width: roundWidth(options.width ?? DEFAULT_WIDTH)
  };
}

function shotScale(shotSize = 'medium') {
  return SHOT_SIZES[shotSize]?.scale ?? SHOT_SIZES.medium.scale;
}

function defaultFocus(composition) {
  const focus = COMPOSITIONS[composition]?.focus ?? COMPOSITIONS.center.focus;
  return { x: clamp(focus.x), y: clamp(focus.y) };
}

function normalizeFocus(focus, composition) {
  const base = defaultFocus(composition);
  return {
    x: clamp(focus?.x ?? base.x),
    y: clamp(focus?.y ?? base.y)
  };
}

function subjectBox(focus, scale, options = {}) {
  const width = options.width ?? clamp(0.045 + scale * 0.27, 0.055, 0.34);
  const height = options.height ?? clamp(width * (options.ratio ?? 0.78), 0.035, 0.34);
  return rect([focus.x - width / 2, focus.y - height / 2], [width, height], true, options.lineWidth ?? DEFAULT_WIDTH);
}

function subjectDot(focus, scale, options = {}) {
  const radius = options.radius ?? clamp(0.018 + scale * 0.075, 0.022, 0.11);
  return circle([focus.x, focus.y], radius, true, options.lineWidth ?? DEFAULT_WIDTH);
}

function centerFigure({ focus, scale }) {
  return [
    line([0.5, 0.16], [0.5, 0.84], 0.006),
    line([0.16, 0.5], [0.84, 0.5], 0.006),
    subjectDot(focus, scale, { radius: clamp(0.032 + scale * 0.105, 0.04, 0.14) })
  ];
}

function thirdsFigure({ focus, scale }) {
  return [
    line([1 / 3, 0.08], [1 / 3, 0.92], 0.006),
    line([2 / 3, 0.08], [2 / 3, 0.92], 0.006),
    line([0.08, 1 / 3], [0.92, 1 / 3], 0.006),
    line([0.08, 2 / 3], [0.92, 2 / 3], 0.006),
    subjectBox(focus, scale, { ratio: 1.16 })
  ];
}

function bisectFigure({ focus, scale }) {
  const side = clamp(0.05 + scale * 0.22, 0.07, 0.30);
  return [
    line([0.5, 0.08], [0.5, 0.92], 0.01),
    rect([0.16, 0.28], [0.24, 0.44], false, 0.008),
    rect([0.60, 0.28], [0.24, 0.44], false, 0.008),
    rect([focus.x - side / 2, focus.y - side / 2], [side, side], true)
  ];
}

function symmetryFigure({ focus, scale }) {
  const radius = clamp(0.018 + scale * 0.035, 0.022, 0.06);
  return [
    line([0.08, 0.55], [0.92, 0.55], 0.012),
    polyline([[0.16, 0.55], [0.30, 0.36], [0.44, 0.55]], { width: 0.009 }),
    polyline([[0.56, 0.55], [0.70, 0.36], [0.84, 0.55]], { width: 0.009 }),
    circle([focus.x - 0.12, focus.y + 0.10], radius, true),
    circle([focus.x + 0.12, focus.y + 0.10], radius, true)
  ];
}

function vastFigure({ focus, scale }) {
  const radius = clamp(0.010 + scale * 0.026, 0.012, 0.040);
  return [
    line([0.08, 0.78], [0.92, 0.78], 0.006),
    circle([focus.x, focus.y], radius, true),
    line([focus.x, focus.y + radius], [focus.x, clamp(focus.y + radius + 0.06)], 0.006)
  ];
}

function frameFigure({ focus, scale }) {
  const inset = 0.10;
  const notch = 0.24;
  return [
    polyline([[inset, notch], [inset, inset], [notch, inset]], { width: 0.018 }),
    polyline([[1 - notch, inset], [1 - inset, inset], [1 - inset, notch]], { width: 0.018 }),
    polyline([[1 - inset, 1 - notch], [1 - inset, 1 - inset], [1 - notch, 1 - inset]], { width: 0.018 }),
    polyline([[notch, 1 - inset], [inset, 1 - inset], [inset, 1 - notch]], { width: 0.018 }),
    subjectDot(focus, scale, { radius: clamp(0.024 + scale * 0.07, 0.034, 0.10) })
  ];
}

function leadingFigure({ focus, scale }) {
  const vanishing = point(focus.x, focus.y);
  return [
    line([0.06, 0.92], vanishing, 0.014),
    line([0.94, 0.92], vanishing, 0.014),
    line([0.22, 0.92], [focus.x - 0.02, focus.y + 0.02], 0.006),
    line([0.78, 0.92], [focus.x + 0.02, focus.y + 0.02], 0.006),
    circle(vanishing, clamp(0.012 + scale * 0.028, 0.014, 0.05), true)
  ];
}

function lowangleFigure({ focus, scale }) {
  const bodyW = clamp(0.16 + scale * 0.26, 0.18, 0.42);
  const topW = bodyW * 0.42;
  const yTop = clamp(focus.y - 0.30, 0.20, 0.58);
  return [
    line([0.08, 0.78], [0.92, 0.78], 0.008),
    polyline(
      [
        [0.5 - bodyW / 2, 0.96],
        [0.5 - topW / 2, yTop],
        [0.5 + topW / 2, yTop],
        [0.5 + bodyW / 2, 0.96]
      ],
      { closed: true, fill: true, width: 0.012 }
    ),
    line([0.5, yTop], [0.5, 0.12], 0.006)
  ];
}

function topdownFigure({ focus, scale }) {
  const tableW = clamp(0.58 + scale * 0.12, 0.58, 0.72);
  const tableH = clamp(0.42 + scale * 0.12, 0.42, 0.56);
  const item = clamp(0.08 + scale * 0.18, 0.10, 0.26);
  return [
    rect([0.5 - tableW / 2, 0.5 - tableH / 2], [tableW, tableH], false, 0.014),
    rect([focus.x - item / 2, focus.y - item / 2], [item, item], true),
    line([0.14, 0.14], [0.26, 0.14], 0.006),
    line([0.14, 0.14], [0.14, 0.26], 0.006),
    line([0.86, 0.86], [0.74, 0.86], 0.006),
    line([0.86, 0.86], [0.86, 0.74], 0.006)
  ];
}

function silhouetteFigure({ focus, scale }) {
  const head = clamp(0.028 + scale * 0.045, 0.034, 0.078);
  const bodyW = clamp(0.055 + scale * 0.11, 0.07, 0.17);
  const bodyH = clamp(0.12 + scale * 0.20, 0.14, 0.32);
  return [
    line([0.08, 0.72], [0.92, 0.72], 0.01),
    circle([focus.x, focus.y - bodyH / 2 - head * 0.65], head, true),
    rect([focus.x - bodyW / 2, focus.y - bodyH / 2], [bodyW, bodyH], true),
    line([focus.x - bodyW * 0.10, focus.y + bodyH / 2], [focus.x - bodyW * 0.58, 0.72], 0.012),
    line([focus.x + bodyW * 0.10, focus.y + bodyH / 2], [focus.x + bodyW * 0.62, 0.72], 0.012),
    line([focus.x + bodyW / 2, focus.y - bodyH * 0.10], [focus.x + bodyW * 1.25, focus.y - bodyH * 0.14], 0.012)
  ];
}

function shallowFigure({ focus, scale }) {
  const radius = clamp(0.10 + scale * 0.22, 0.14, 0.33);
  return [
    circle([0.22, 0.30], 0.065, false, 0.005),
    circle([0.78, 0.22], 0.050, false, 0.005),
    circle([0.76, 0.78], 0.075, false, 0.005),
    circle([focus.x, focus.y], radius, true),
    line([focus.x - radius * 0.56, focus.y], [focus.x + radius * 0.56, focus.y], 0.006)
  ];
}

const DRAWERS = {
  center: centerFigure,
  thirds: thirdsFigure,
  bisect: bisectFigure,
  symmetry: symmetryFigure,
  vast: vastFigure,
  frame: frameFigure,
  leading: leadingFigure,
  lowangle: lowangleFigure,
  topdown: topdownFigure,
  silhouette: silhouetteFigure,
  shallow: shallowFigure
};

function collectNumbers(value, output = []) {
  if (typeof value === 'number') output.push(value);
  if (Array.isArray(value)) value.forEach((item) => collectNumbers(item, output));
  return output;
}

function assertPoint(value, path) {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error(`${path} must be [x,y]`);
  }
  value.forEach((item, index) => {
    if (!Number.isFinite(item) || item < 0 || item > 1) {
      throw new Error(`${path}[${index}] must be within 0..1`);
    }
  });
}

function assertPrimitive(primitive, index) {
  if (!primitive || typeof primitive !== 'object') {
    throw new Error(`primitive[${index}] must be an object`);
  }
  if (!PRIMITIVE_KINDS.includes(primitive.kind)) {
    throw new Error(`primitive[${index}].kind is invalid: ${primitive.kind}`);
  }
  const width = primitive.width ?? DEFAULT_WIDTH;
  if (!Number.isFinite(width) || width <= 0 || width > 0.08) {
    throw new Error(`primitive[${index}].width must be >0 and <=0.08`);
  }

  if (primitive.kind === 'line') {
    assertPoint(primitive.from, `primitive[${index}].from`);
    assertPoint(primitive.to, `primitive[${index}].to`);
  }
  if (primitive.kind === 'rect') {
    assertPoint(primitive.at, `primitive[${index}].at`);
    assertPoint(primitive.size, `primitive[${index}].size`);
    if (primitive.size[0] <= 0 || primitive.size[1] <= 0) {
      throw new Error(`primitive[${index}].size must be positive`);
    }
  }
  if (primitive.kind === 'circle') {
    assertPoint(primitive.at, `primitive[${index}].at`);
    if (!Number.isFinite(primitive.r) || primitive.r <= 0 || primitive.r > 0.5) {
      throw new Error(`primitive[${index}].r must be >0 and <=0.5`);
    }
  }
  if (primitive.kind === 'polyline') {
    if (!Array.isArray(primitive.points) || primitive.points.length < 2) {
      throw new Error(`primitive[${index}].points must contain at least 2 points`);
    }
    primitive.points.forEach((item, pointIndex) => assertPoint(item, `primitive[${index}].points[${pointIndex}]`));
  }

  collectNumbers(primitive).forEach((number) => {
    if (!Number.isFinite(number)) {
      throw new Error(`primitive[${index}] contains a non-finite number`);
    }
  });
}

export function assertFigure(figure) {
  if (!figure || typeof figure !== 'object') {
    throw new Error('figure must be an object');
  }
  if (!Array.isArray(figure.viewBox) || figure.viewBox[0] !== 1 || figure.viewBox[1] !== 1) {
    throw new Error('figure.viewBox must be [1,1]');
  }
  if (!Array.isArray(figure.primitives) || figure.primitives.length === 0) {
    throw new Error('figure.primitives must be a non-empty array');
  }
  figure.primitives.forEach(assertPrimitive);
  return true;
}

export function buildFigure({ composition = 'center', shotSize = 'medium', focus } = {}) {
  const compositionId = DRAWERS[composition] ? composition : 'center';
  const scale = shotScale(shotSize);
  const normalizedFocus = normalizeFocus(focus, compositionId);
  const primitives = DRAWERS[compositionId]({ focus: normalizedFocus, scale, shotSize });
  const figure = { viewBox: [...FIGURE_VIEW_BOX], primitives };
  assertFigure(figure);
  return figure;
}

export function buildFigureForCaption(caption = {}) {
  return buildFigure({
    composition: caption.composition,
    shotSize: caption.shotSize,
    focus: caption.focus
  });
}
