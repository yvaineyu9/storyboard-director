// T13 · 两层色胶片条渲染器。
// 只使用 #000000 / #40FF5E；canvas 不可用时返回降级状态，不阻断结果。

const BG = '#000000';
const FG = '#40FF5E';
const PAD = 12;
const CELL_W = 132;
const CELL_H = 110;
const GUTTER = 14;
const RHYTHM_H = 28;
const WIDTH = 894;
const HEIGHT = 180;

const TRANSITION_MARK = {
  cut: '|',
  dissolve: '○',
  fade: '□',
  match: '=',
  whip: '>>',
  beatcut: '×',
  jcut: 'J',
  lcut: 'L'
};

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function call(ctx, method, ...args) {
  if (ctx && typeof ctx[method] === 'function') {
    ctx[method](...args);
  }
}

function setCanvasValue(ctx, property, setter, value) {
  if (!ctx) return;
  if (typeof ctx[setter] === 'function') {
    ctx[setter](value);
  } else {
    ctx[property] = value;
  }
}

function setStrokeStyle(ctx, value) {
  setCanvasValue(ctx, 'strokeStyle', 'setStrokeStyle', value);
}

function setFillStyle(ctx, value) {
  setCanvasValue(ctx, 'fillStyle', 'setFillStyle', value);
}

function setLineWidth(ctx, value) {
  setCanvasValue(ctx, 'lineWidth', 'setLineWidth', value);
}

function setFontSize(ctx, value) {
  if (!ctx) return;
  if (typeof ctx.setFontSize === 'function') {
    ctx.setFontSize(value);
  } else {
    ctx.font = `${value}px sans-serif`;
  }
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

function drawPrimitive(ctx, primitive, x, y, w, h) {
  if (!primitive || !primitive.kind) return;
  setStrokeStyle(ctx, FG);
  setFillStyle(ctx, FG);
  setLineWidth(ctx, 2);

  if (primitive.kind === 'line') {
    strokeLine(ctx, x + primitive.x1 * w, y + primitive.y1 * h, x + primitive.x2 * w, y + primitive.y2 * h);
    return;
  }
  if (primitive.kind === 'rect') {
    const px = x + primitive.x * w;
    const py = y + primitive.y * h;
    const pw = primitive.w * w;
    const ph = primitive.h * h;
    if (primitive.fill) call(ctx, 'fillRect', px, py, pw, ph);
    else {
      call(ctx, 'beginPath');
      call(ctx, 'rect', px, py, pw, ph);
      call(ctx, 'stroke');
    }
    return;
  }
  if (primitive.kind === 'circle') {
    call(ctx, 'beginPath');
    call(ctx, 'arc', x + primitive.cx * w, y + primitive.cy * h, primitive.r * Math.min(w, h), 0, Math.PI * 2);
    primitive.fill ? call(ctx, 'fill') : call(ctx, 'stroke');
    return;
  }
  if (primitive.kind === 'polyline' && Array.isArray(primitive.points) && primitive.points.length) {
    call(ctx, 'beginPath');
    primitive.points.forEach((point, index) => {
      const px = x + point.x * w;
      const py = y + point.y * h;
      if (index === 0) call(ctx, 'moveTo', px, py);
      else call(ctx, 'lineTo', px, py);
    });
    call(ctx, 'stroke');
  }
}

function drawRhythm(ctx, cell, x, y) {
  const speedTicks = { slow: 2, medium: 4, fast: 6, veryfast: 8 };
  const ticks = speedTicks[cell.cutSpeed] || 4;
  const durationWidth = Math.max(18, Math.min(CELL_W - 18, Number(cell.duration || 4) * 14));
  setStrokeStyle(ctx, FG);
  setFillStyle(ctx, FG);
  setLineWidth(ctx, 2);
  strokeRect(ctx, x, y, CELL_W, RHYTHM_H);
  call(ctx, 'fillRect', x + 4, y + 10, durationWidth, 8);
  for (let i = 0; i < ticks; i++) {
    const tx = x + 8 + i * ((CELL_W - 16) / Math.max(1, ticks - 1));
    strokeLine(ctx, tx, y + 2, tx, y + 8);
  }
  if (cell.pause) {
    for (let i = 0; i < 4; i++) {
      strokeLine(ctx, x + 6 + i * 8, y + RHYTHM_H - 5, x + 10 + i * 8, y + RHYTHM_H - 5);
    }
  }
}

function drawCell(ctx, cell, index) {
  const x = PAD + index * (CELL_W + GUTTER);
  const y = PAD;
  setStrokeStyle(ctx, FG);
  setFillStyle(ctx, FG);
  setLineWidth(ctx, 2);
  strokeRect(ctx, x, y, CELL_W, CELL_H);
  setFontSize(ctx, 12);
  call(ctx, 'fillText', String(cell.index || index + 1).padStart(2, '0'), x + 8, y + 16);

  const figureX = x + 8;
  const figureY = y + 22;
  const figureW = CELL_W - 16;
  const figureH = CELL_H - 30;
  for (const primitive of cell.figure?.primitives || []) {
    drawPrimitive(ctx, primitive, figureX, figureY, figureW, figureH);
  }

  drawRhythm(ctx, cell, x, y + CELL_H + 8);
  call(ctx, 'fillText', TRANSITION_MARK[cell.transition] || '|', x + CELL_W - 20, y + CELL_H + RHYTHM_H + 22);
}

function drawBackground(ctx) {
  setFillStyle(ctx, BG);
  call(ctx, 'fillRect', 0, 0, WIDTH, HEIGHT);
  setStrokeStyle(ctx, FG);
  setLineWidth(ctx, 2);
  for (let x = 0; x < WIDTH; x += 22) {
    strokeRect(ctx, x + 4, 4, 10, 8);
    strokeRect(ctx, x + 4, HEIGHT - 12, 10, 8);
  }
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
      drawBackground(ctx);
      (model?.cells || []).forEach((cell, index) => drawCell(ctx, cell, index));
      call(ctx, 'draw');
      return { ok: true };
    }
    if (attempt < maxRetries) await wait(retryDelay);
  }

  return { ok: false, reason: 'canvas-unavailable' };
}

export default {
  drawFilmstrip
};
