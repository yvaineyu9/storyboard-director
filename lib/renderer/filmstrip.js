// T13 · 两层色「胶片条」渲染器（架构设计 §4）。
//
// 输入 filmstripModel（A4 combine 产出）：cells[].figure 为**真库原语**，
// 字段契约见 lib/figure.js：
//   line     { kind:'line',     from:[x,y], to:[x,y], width? }
//   rect     { kind:'rect',     at:[x,y],   size:[w,h], fill?, width? }
//   circle   { kind:'circle',   at:[x,y],   r:number,   fill?, width? }
//   polyline { kind:'polyline', points:[[x,y],...], closed?, fill?, width? }
// 坐标全部归一化到 0..1（viewBox=[1,1]）。本渲染器只解释这些字段。
//
// 两层色写死 #000 / #40FF5E，无第三色、无渐变、无 emoji。
// 固定最大 backing（6 镜上限 ≈ 894×190）；N<6 左对齐绘制、右侧留黑底。
// createCanvasContext 返回 null 时最多重试 5 次（~16ms/次），仍失败则降级返回。

const BG = '#000';
const FG = '#40FF5E';

// 画布常量（px，backing 像素）— 架构设计 §4.1。
const PAD = 12;
const CELL = 120;     // 单镜构图格边长（正方画框）
const GUT = 30;       // 镜间间隙（画转场符号）
const RHY_H = 26;     // 节奏层条带高度
const RHY_GAP = 10;   // 构图格与节奏条间距
const LW = 2;         // 主描边线宽

const STRIP_W_MAX = PAD * 2 + 6 * CELL + 5 * GUT;        // ≈ 894
const STRIP_H_MAX = PAD * 2 + CELL + RHY_GAP + RHY_H;    // ≈ 190

// cutSpeed → 节奏条刻度间距（px）。越密＝切得越快。
const TICK_SPACING = { slow: 18, medium: 12, fast: 8, veryfast: 5 };

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function call(ctx, method, ...args) {
  if (ctx && typeof ctx[method] === 'function') {
    ctx[method](...args);
  }
}

// 颜色 / 线宽 / 字号：兼容属性式（ctx.fillStyle=）与方法式（ctx.setFillStyle()）API。
function setCanvasValue(ctx, property, setter, value) {
  if (!ctx) return;
  if (typeof ctx[setter] === 'function') ctx[setter](value);
  else ctx[property] = value;
}
function setStrokeStyle(ctx, value) { setCanvasValue(ctx, 'strokeStyle', 'setStrokeStyle', value); }
function setFillStyle(ctx, value) { setCanvasValue(ctx, 'fillStyle', 'setFillStyle', value); }
function setLineWidth(ctx, value) { setCanvasValue(ctx, 'lineWidth', 'setLineWidth', value); }

function setFontSize(ctx, value) {
  if (!ctx) return;
  if (typeof ctx.setFontSize === 'function') ctx.setFontSize(value);
  else ctx.font = `${value}px Arial`;
}

function setLineDash(ctx, segments) {
  if (!ctx) return;
  if (typeof ctx.setLineDash === 'function') ctx.setLineDash(segments);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function strokeRect(ctx, x, y, w, h) {
  if (ctx && typeof ctx.strokeRect === 'function') {
    ctx.strokeRect(x, y, w, h);
    return;
  }
  call(ctx, 'beginPath');
  call(ctx, 'rect', x, y, w, h);
  call(ctx, 'stroke');
}

function strokeLine(ctx, x1, y1, x2, y2) {
  call(ctx, 'beginPath');
  call(ctx, 'moveTo', x1, y1);
  call(ctx, 'lineTo', x2, y2);
  call(ctx, 'stroke');
}

// 把一条真库原语映射进 [ox,oy] 原点、边长 CELL 的格内绘制。
function drawPrimitive(ctx, primitive, ox, oy) {
  if (!primitive || !primitive.kind) return;
  setStrokeStyle(ctx, FG);
  setFillStyle(ctx, FG);
  const lineWidth = Number.isFinite(primitive.width) ? Math.max(1, primitive.width * CELL) : LW;
  setLineWidth(ctx, lineWidth);

  const px = (p) => ox + clamp(p, 0, 1) * CELL;
  const py = (p) => oy + clamp(p, 0, 1) * CELL;

  if (primitive.kind === 'line') {
    const from = primitive.from || [0, 0];
    const to = primitive.to || [0, 0];
    strokeLine(ctx, px(from[0]), py(from[1]), px(to[0]), py(to[1]));
    return;
  }

  if (primitive.kind === 'rect') {
    const at = primitive.at || [0, 0];
    const size = primitive.size || [0, 0];
    const rx = px(at[0]);
    const ry = py(at[1]);
    const rw = clamp(size[0], 0, 1) * CELL;
    const rh = clamp(size[1], 0, 1) * CELL;
    if (primitive.fill) {
      call(ctx, 'fillRect', rx, ry, rw, rh);
    } else {
      strokeRect(ctx, rx, ry, rw, rh);
    }
    return;
  }

  if (primitive.kind === 'circle') {
    const at = primitive.at || [0, 0];
    const r = clamp(primitive.r, 0, 0.5) * CELL;
    call(ctx, 'beginPath');
    call(ctx, 'arc', px(at[0]), py(at[1]), r, 0, Math.PI * 2);
    if (primitive.fill) call(ctx, 'fill');
    else call(ctx, 'stroke');
    return;
  }

  if (primitive.kind === 'polyline' && Array.isArray(primitive.points) && primitive.points.length) {
    call(ctx, 'beginPath');
    primitive.points.forEach((point, index) => {
      const x = px(point[0]);
      const y = py(point[1]);
      if (index === 0) call(ctx, 'moveTo', x, y);
      else call(ctx, 'lineTo', x, y);
    });
    if (primitive.closed) call(ctx, 'closePath');
    if (primitive.fill) call(ctx, 'fill');
    else call(ctx, 'stroke');
  }
}

// 节奏层：条长 ∝ 时长，刻度密度 ∝ 切速，pause 前导虚线。
function drawRhythm(ctx, cell, ox, ry, maxDuration) {
  setStrokeStyle(ctx, FG);
  setFillStyle(ctx, FG);
  setLineWidth(ctx, LW);

  const duration = Number(cell.duration) || 4;
  const ratio = clamp(duration / (maxDuration || 1), 0.18, 1);
  const barLen = CELL * ratio;
  const baseY = ry + RHY_H / 2;

  // pause（留白蓄势）：条首一段前导虚线静音段。
  let startX = ox;
  if (cell.pause) {
    const leadLen = Math.min(barLen * 0.4, 22);
    setLineDash(ctx, [3, 4]);
    strokeLine(ctx, ox, baseY, ox + leadLen, baseY);
    setLineDash(ctx, []);
    startX = ox + leadLen;
  }

  // 基线
  strokeLine(ctx, startX, baseY, ox + barLen, baseY);

  // 密度＝切速：等距竖向短刻度。
  const spacing = TICK_SPACING[cell.cutSpeed] || TICK_SPACING.medium;
  for (let tx = startX; tx <= ox + barLen + 0.01; tx += spacing) {
    strokeLine(ctx, tx, ry + 4, tx, ry + RHY_H - 4);
  }
}

// 7 种转场符号（FG 描边），画在右侧 GUT 中心。
function drawTransition(ctx, transition, gx, gy) {
  setStrokeStyle(ctx, FG);
  setLineWidth(ctx, LW);
  const s = 8; // 半尺寸
  switch (transition) {
    case 'cut': // 硬切：一条竖线 │
      strokeLine(ctx, gx, gy - s, gx, gy + s);
      break;
    case 'dissolve': // 叠化：交叉 ✕
      strokeLine(ctx, gx - s, gy - s, gx + s, gy + s);
      strokeLine(ctx, gx - s, gy + s, gx + s, gy - s);
      break;
    case 'fade': // 淡入淡出：空心圆 ○
      call(ctx, 'beginPath');
      call(ctx, 'arc', gx, gy, s, 0, Math.PI * 2);
      call(ctx, 'stroke');
      break;
    case 'match': // 匹配剪辑：两个同向 chevron 》》
      strokeLine(ctx, gx - s, gy - s, gx, gy);
      strokeLine(ctx, gx, gy, gx - s, gy + s);
      strokeLine(ctx, gx, gy - s, gx + s, gy);
      strokeLine(ctx, gx + s, gy, gx, gy + s);
      break;
    case 'whip': // 甩切：斜纹束 ⫽（3 条平行斜线）
      strokeLine(ctx, gx - s, gy + s, gx, gy - s);
      strokeLine(ctx, gx - s + 5, gy + s, gx + 5, gy - s);
      strokeLine(ctx, gx - s + 10, gy + s, gx + 10, gy - s);
      break;
    case 'beatcut': // 卡点快切：竖线 + 中点圆点（踩拍）
      strokeLine(ctx, gx, gy - s, gx, gy + s);
      call(ctx, 'beginPath');
      call(ctx, 'arc', gx, gy, 2, 0, Math.PI * 2);
      setFillStyle(ctx, FG);
      call(ctx, 'fill');
      break;
    case 'jcut': // J切：竖线 + 下方短横（声音先入）
      strokeLine(ctx, gx, gy - s, gx, gy + s);
      strokeLine(ctx, gx, gy + s, gx + s, gy + s);
      break;
    case 'lcut': // L切：竖线 + 上方短横（声音延留）
      strokeLine(ctx, gx, gy - s, gx, gy + s);
      strokeLine(ctx, gx, gy - s, gx + s, gy - s);
      break;
    default: // 兜底：竖线
      strokeLine(ctx, gx, gy - s, gx, gy + s);
      break;
  }
}

function drawCell(ctx, cell, index, maxDuration) {
  const ox = PAD + index * (CELL + GUT);
  const oy = PAD;

  // 画框
  setStrokeStyle(ctx, FG);
  setFillStyle(ctx, FG);
  setLineWidth(ctx, LW);
  strokeRect(ctx, ox, oy, CELL, CELL);

  // 序号
  setFontSize(ctx, 12);
  if (ctx && typeof ctx.setTextBaseline === 'function') ctx.setTextBaseline('top');
  else if (ctx) ctx.textBaseline = 'top';
  call(ctx, 'fillText', String(cell.index || index + 1), ox + 4, oy + 4);

  // 构图原语（真库 figure）
  for (const primitive of cell.figure?.primitives || []) {
    drawPrimitive(ctx, primitive, ox, oy);
  }

  // 节奏层
  drawRhythm(ctx, cell, ox, oy + CELL + RHY_GAP, maxDuration);

  // 转场符号（非末镜）。兼容 transitionToNext（架构 §4.2）与 transition 字段。
  const transition = cell.transitionToNext !== undefined
    ? cell.transitionToNext
    : (index < (cell.__lastIndex ?? Infinity) ? cell.transition : null);
  if (transition) {
    drawTransition(ctx, transition, ox + CELL + GUT / 2, oy + CELL / 2);
  }
}

function flush(ctx) {
  if (ctx && typeof ctx.flush === 'function') ctx.flush();
  else if (ctx && typeof ctx.draw === 'function') ctx.draw();
}

function render(ctx, model) {
  const cells = model?.cells || [];
  const maxDuration = Number(model?.maxDuration) > 0
    ? model.maxDuration
    : cells.reduce((max, cell) => Math.max(max, Number(cell.duration) || 0), 1);

  // 底：固定最大 backing 铺满黑底（N<6 右侧留黑）。
  setFillStyle(ctx, BG);
  call(ctx, 'fillRect', 0, 0, STRIP_W_MAX, STRIP_H_MAX);

  cells.forEach((cell, index) => drawCell(ctx, cell, index, maxDuration));

  flush(ctx);
}

export async function drawFilmstrip(model, options = {}) {
  const wxImpl = options.wxImpl || globalThis.wx;
  const canvasId = options.canvasId || 'filmstrip';
  const maxRetries = Number.isFinite(options.maxRetries) ? options.maxRetries : 5;
  const retryDelay = Number.isFinite(options.retryDelay) ? options.retryDelay : 16;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const ctx = wxImpl && typeof wxImpl.createCanvasContext === 'function'
      ? wxImpl.createCanvasContext(canvasId)
      : null;
    if (ctx) {
      render(ctx, model);
      return { ok: true };
    }
    if (attempt < maxRetries) await wait(retryDelay);
  }

  return { ok: false, reason: 'canvas-unavailable' };
}

export const FILMSTRIP_CONSTANTS = {
  BG, FG, PAD, CELL, GUT, RHY_H, RHY_GAP, LW, STRIP_W_MAX, STRIP_H_MAX
};

export default {
  drawFilmstrip,
  FILMSTRIP_CONSTANTS
};
