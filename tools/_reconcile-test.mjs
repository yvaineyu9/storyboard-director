// 集成返工自测（放 tools/，不进生产包）。
// LLM 在本环境无法真调：对 LLM 路径用注入 mock session / mock 返回测；
// 对确定性逻辑（A4 combine、渲染器、A2 兜底、A3 降级）直接测。
// 真契约以真库为准：所有 templateId 必须 getById 命中真库。
//
// 运行：node tools/_reconcile-test.mjs

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { MAX_CLARIFY, createIntentSession, runIntent } from '../lib/agents/intent.js';
import { fallbackComposition, runComposition } from '../lib/agents/composition.js';
import { buildFallbackRhythm, runRhythm } from '../lib/agents/rhythm.js';
import { combineStoryboard } from '../lib/agents/combine.js';
import { drawFilmstrip } from '../lib/renderer/filmstrip.js';
import { getById, loadLibrary } from '../lib/library.js';

let passed = 0;
let failed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  PASS  ${name}`); })
    .catch((err) => { failed++; console.error(`  FAIL  ${name}\n        ${err.message}`); });
}

// —— mock session 工厂：A2/A3 返回不同内容；可注入非法 templateId / 失败 ——
function mockSession(kind, opts = {}) {
  return {
    destroyed: false,
    async prompt() {
      if (kind === 'A2') {
        if (opts.fail) throw new Error('A2 failed');
        return JSON.stringify({ shots: opts.shots, cameraUsed: [] });
      }
      if (kind === 'A3') {
        if (opts.fail) throw new Error('A3 failed');
        return JSON.stringify({ shots: opts.shots });
      }
      return '{}';
    },
    destroy() { this.destroyed = true; }
  };
}
function mockLanguageModel(kind, opts) {
  return {
    async availability() { return 'available'; },
    async create() { return mockSession(kind, opts); }
  };
}

// —— 记录调用的 stub canvas ctx（属性式 + 方法式都覆盖）——
function recordingCtx() {
  const calls = [];
  const ctx = {
    calls,
    _fillStyle: null,
    _strokeStyle: null,
    set fillStyle(v) { this._fillStyle = v; calls.push(['fillStyle', v]); },
    get fillStyle() { return this._fillStyle; },
    set strokeStyle(v) { this._strokeStyle = v; calls.push(['strokeStyle', v]); },
    get strokeStyle() { return this._strokeStyle; },
    set lineWidth(v) { calls.push(['lineWidth', v]); },
    set font(v) { calls.push(['font', v]); },
    set textBaseline(v) { calls.push(['textBaseline', v]); }
  };
  for (const m of ['beginPath', 'moveTo', 'lineTo', 'rect', 'arc', 'stroke', 'fill',
    'fillRect', 'strokeRect', 'fillText', 'setLineDash', 'closePath', 'flush', 'draw']) {
    ctx[m] = (...args) => calls.push([m, ...args]);
  }
  return ctx;
}

function distinctCameras(board) {
  return new Set(board.shots.map((s) => s.camera.id)).size;
}

async function main() {
  const lib = loadLibrary();
  const validIds = lib.templates.map((t) => t.id);
  console.log(`真库模板数：${validIds.length}（${validIds[0]}…${validIds[validIds.length - 1]}）\n`);

  const intent = {
    subject: '跑步的人',
    scene: '城市夜路',
    visualIntent: '紧张、速度、霓虹反光',
    mood: 'tense',
    shotCount: 5
  };

  // ===== A4 combine（确定性）=====
  console.log('A4 combine:');
  await test('mock shotsA(真 templateId) + shotsB → 合法 board', () => {
    const shotsA = {
      shots: [
        { templateId: validIds[0], beat: 'establish', description: '建立空间' },
        { templateId: validIds[4], beat: 'build', description: '推进' },
        { templateId: validIds[8], beat: 'climax', description: '高潮' },
        { templateId: validIds[12], beat: 'build', description: '过渡' },
        { templateId: validIds[16], beat: 'close', description: '收束' }
      ]
    };
    const shotsB = { shots: buildFallbackRhythm('tense', 5) };
    const board = combineStoryboard(intent, shotsA, shotsB);

    assert.ok(board.shotCount >= 3 && board.shotCount <= 6, 'shotCount 应在 3~6');
    assert.equal(board.shots.length, board.shotCount, 'shots 长度 = shotCount');
    assert.ok(board.shots.every((s) => !!getById(s.templateId)), '每个 templateId 必须 getById 命中真库');
    assert.ok(distinctCameras(board) <= 3, `distinct(camera) ≤ 3，实际 ${distinctCameras(board)}`);
    // figure 为真原语：含真字段，不含占位字段
    for (const s of board.shots) {
      assert.ok(Array.isArray(s.figure.primitives) && s.figure.primitives.length, 'figure.primitives 非空');
      for (const p of s.figure.primitives) {
        if (p.kind === 'line') { assert.ok(Array.isArray(p.from) && Array.isArray(p.to), 'line.from/to 为真字段'); assert.ok(!('x1' in p), '不应含占位 x1'); }
        if (p.kind === 'rect') { assert.ok(Array.isArray(p.at) && Array.isArray(p.size), 'rect.at/size 为真字段'); assert.ok(!('w' in p), '不应含占位 w'); }
        if (p.kind === 'circle') { assert.ok(Array.isArray(p.at) && Number.isFinite(p.r), 'circle.at/r 为真字段'); assert.ok(!('cx' in p), '不应含占位 cx'); }
        if (p.kind === 'polyline') { assert.ok(Array.isArray(p.points[0]) && p.points[0].length === 2, 'polyline.points=[[x,y]] 为真字段'); }
      }
    }
    // markdown / filmstripModel 结构
    assert.ok(board.markdown.includes('##') && board.markdown.includes('### 分镜数组'), 'markdown 结构正确');
    assert.equal(board.filmstripModel.cells.length, board.shotCount, 'filmstripModel.cells 长度对');
    assert.ok(board.filmstripModel.cells.every((c) => c.figure && Array.isArray(c.figure.primitives)), 'cells 带真 figure');
    assert.equal(board.filmstripModel.cells[board.shotCount - 1].transitionToNext, null, '末镜 transitionToNext = null');
    assert.equal(board.guidance.length, board.shotCount, 'guidance 每镜一条');
  });

  await test('clamp(3,6)：shotCount=9 → 6；shotCount=1 → 3', () => {
    const big = combineStoryboard({ ...intent, shotCount: 9 }, fallbackComposition({ ...intent, shotCount: 9 }), { shots: buildFallbackRhythm('tense', 9) });
    assert.equal(big.shotCount, 6);
    const small = combineStoryboard({ ...intent, shotCount: 1 }, fallbackComposition({ ...intent, shotCount: 1 }), { shots: buildFallbackRhythm('tense', 1) });
    assert.equal(small.shotCount, 3);
  });

  await test('护栏：强行喂多运镜模板，distinct(camera) 仍 ≤ 3', () => {
    // 取库内 6 个尽量不同运镜的模板，验证护栏收敛。
    const cams = new Map();
    for (const t of lib.templates) { if (!cams.has(t.caption.camera)) cams.set(t.caption.camera, t.id); }
    const sixIds = Array.from(cams.values()).slice(0, 6);
    while (sixIds.length < 6) sixIds.push(validIds[sixIds.length]);
    const shotsA = { shots: sixIds.map((id, i) => ({ templateId: id, beat: 'build', description: `镜${i}` })) };
    const board = combineStoryboard({ ...intent, shotCount: 6 }, shotsA, { shots: buildFallbackRhythm('tense', 6) });
    assert.ok(distinctCameras(board) <= 3, `distinct(camera) ≤ 3，实际 ${distinctCameras(board)}`);
    assert.ok(board.shots.every((s) => !!getById(s.templateId)), '护栏替换后仍全命中真库');
  });

  // ===== 渲染器（确定性，stub ctx）=====
  console.log('\n渲染器:');
  const board = combineStoryboard(intent, {
    shots: [
      { templateId: validIds[0], description: 'a' },
      { templateId: validIds[4], description: 'b' },
      { templateId: validIds[8], description: 'c' },
      { templateId: validIds[12], description: 'd' },
      { templateId: validIds[16], description: 'e' }
    ]
  }, { shots: buildFallbackRhythm('tense', 5) });

  await test('stub ctx 喂 filmstripModel：不抛异常、有绘制调用、读真 figure 字段', async () => {
    const ctx = recordingCtx();
    const r = await drawFilmstrip(board.filmstripModel, { wxImpl: { createCanvasContext: () => ctx }, maxRetries: 0 });
    assert.equal(r.ok, true, 'drawFilmstrip 应成功');
    assert.ok(ctx.calls.length > 0, '应有 canvas 调用');
    // 读了真 figure：有 arc / fillRect / moveTo 等几何调用（来自真原语）
    const methods = new Set(ctx.calls.map((c) => c[0]));
    assert.ok(methods.has('moveTo') || methods.has('arc') || methods.has('fillRect'), '应解释真原语几何');
    assert.ok(methods.has('flush') || methods.has('draw'), '应 flush/draw 收尾');
  });

  await test('只用两种颜色字符串 #000 / #40FF5E', async () => {
    const ctx = recordingCtx();
    await drawFilmstrip(board.filmstripModel, { wxImpl: { createCanvasContext: () => ctx }, maxRetries: 0 });
    const colors = new Set(ctx.calls.filter((c) => c[0] === 'fillStyle' || c[0] === 'strokeStyle').map((c) => c[1]));
    for (const col of colors) {
      assert.ok(col === '#000' || col === '#40FF5E', `颜色只能是 #000/#40FF5E，出现了 ${col}`);
    }
    assert.ok(colors.has('#000') && colors.has('#40FF5E'), '两层色都应被使用');
  });

  await test('方法式 ctx（setFillStyle/setStrokeStyle）也支持', async () => {
    const colors = new Set();
    const methodCtx = {
      setFillStyle: (v) => colors.add(v), setStrokeStyle: (v) => colors.add(v),
      setLineWidth() {}, setFontSize() {}, setLineDash() {}, setTextBaseline() {},
      beginPath() {}, moveTo() {}, lineTo() {}, rect() {}, arc() {}, stroke() {}, fill() {},
      fillRect() {}, strokeRect() {}, fillText() {}, closePath() {}, flush() {}
    };
    const r = await drawFilmstrip(board.filmstripModel, { wxImpl: { createCanvasContext: () => methodCtx }, maxRetries: 0 });
    assert.equal(r.ok, true);
    for (const col of colors) assert.ok(col === '#000' || col === '#40FF5E', `颜色只能两色，出现 ${col}`);
  });

  await test('createCanvasContext null → 降级不抛异常', async () => {
    const r = await drawFilmstrip(board.filmstripModel, { wxImpl: { createCanvasContext: () => null }, maxRetries: 0 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'canvas-unavailable');
  });

  // ===== A2（mock session）=====
  console.log('\nA2 composition:');
  await test('mock 返回真 templateId → 输出全部命中真库', async () => {
    const realShots = [
      { templateId: validIds[1], beat: 'establish', description: '一' },
      { templateId: validIds[5], beat: 'build', description: '二' },
      { templateId: validIds[9], beat: 'close', description: '三' }
    ];
    const out = await runComposition({ ...intent, shotCount: 3 }, { LanguageModel: mockLanguageModel('A2', { shots: realShots }), silent: true });
    assert.equal(out.shots.length, 3);
    assert.ok(out.shots.every((s) => !!getById(s.templateId)), '全部命中真库');
  });

  await test('mock 返回非法 id → nearestTemplate 兜底仍全命中真库', async () => {
    const badShots = [
      { templateId: 'ZZZ', beat: 'establish', description: '一' },
      { templateId: 'NOPE99', beat: 'build', description: '二' },
      { templateId: '', beat: 'close', description: '三' }
    ];
    const out = await runComposition({ ...intent, shotCount: 3 }, { LanguageModel: mockLanguageModel('A2', { shots: badShots }), silent: true });
    assert.equal(out.shots.length, 3);
    assert.ok(out.shots.every((s) => !!getById(s.templateId)), '非法 id 经兜底后仍全命中真库');
  });

  await test('A2 session 失败 → fallbackComposition 全命中真库', async () => {
    const out = await runComposition({ ...intent, shotCount: 4 }, { LanguageModel: mockLanguageModel('A2', { fail: true }), silent: true });
    assert.equal(out.shots.length, 4);
    assert.ok(out.shots.every((s) => !!getById(s.templateId)), 'fallback 全命中真库');
  });

  await test('A2 system prompt 注入了真库索引（buildLibraryIndexForPrompt）', async () => {
    const { COMPOSITION_SYSTEM_PROMPT } = await import('../lib/agents/composition.js');
    assert.ok(COMPOSITION_SYSTEM_PROMPT.includes(validIds[0]) && COMPOSITION_SYSTEM_PROMPT.includes('【死模板索引】'), '应注入真库索引');
  });

  // ===== A3（mock 失败 → 模块B 降级）=====
  console.log('\nA3 rhythm:');
  await test('mock 失败 → 模块B 降级出合法弧线（长度=shotCount，词表合法）', async () => {
    const out = await runRhythm({ mood: 'epic', shotCount: 5 }, { LanguageModel: mockLanguageModel('A3', { fail: true }), silent: true });
    assert.equal(out.source, 'fallback');
    assert.equal(out.shots.length, 5);
    const { TRANSITIONS } = await import('../lib/vocab.js');
    for (const s of out.shots) {
      assert.ok(['slow', 'medium', 'fast', 'veryfast'].includes(s.cutSpeed), 'cutSpeed 合法');
      assert.ok(Object.prototype.hasOwnProperty.call(TRANSITIONS, s.transition), 'transition 在真词表');
      assert.ok(s.duration >= 1 && s.duration <= 8, 'duration 合理');
    }
    // 弧线：末镜留白（duration 不至于最短）
    assert.ok(out.shots[out.shots.length - 1].duration >= 4, '收尾留白：末镜时长 ≥ 4');
  });

  await test('A3 无 LanguageModel → 直接降级', async () => {
    const out = await runRhythm({ mood: 'calm', shotCount: 3 }, {});
    assert.equal(out.source, 'fallback');
    assert.equal(out.shots.length, 3);
  });

  // ===== A1（mock session / 解析失败兜底）=====
  console.log('\nA1 intent:');
  await test('MAX_CLARIFY = 2', () => { assert.equal(MAX_CLARIFY, 2); });

  await test('mock session 返回 ready=false → 透出 ask、missing', async () => {
    const session = {
      async prompt() {
        return JSON.stringify({ ready: false, ask: '想要什么情绪？', missing: ['mood'], intent: { subject: '产品', scene: '', visualIntent: '', mood: '', shotCount: 4 } });
      }
    };
    const r = await runIntent('拍个产品', { session, clarifyCount: 0 });
    assert.equal(r.ready, false);
    assert.ok(r.ask);
  });

  await test('解析失败 + 完整描述 → 启发式兜底 ready=true（mood/shotCount 命中真 vocab）', async () => {
    const r = await runIntent('拍摄一个跑步的人在城市夜路，紧张，5镜', { session: { prompt: async () => '这不是 JSON' }, clarifyCount: 0 });
    assert.equal(r.ready, true);
    assert.equal(r.intent.shotCount, 5);
    assert.equal(r.intent.mood, 'tense');
    const { MOODS } = await import('../lib/vocab.js');
    assert.ok(Object.prototype.hasOwnProperty.call(MOODS, r.intent.mood), 'mood ∈ 真 vocab');
    assert.ok(r.intent.shotCount >= 3 && r.intent.shotCount <= 6, 'shotCount ∈ [3,6]');
  });

  await test('达到追问上限 → 强制 ready=true', async () => {
    const r = await runIntent('一些模糊描述', { session: { prompt: async () => '{}' }, clarifyCount: MAX_CLARIFY });
    assert.equal(r.ready, true, '到上限即使缺项也用默认值 ready');
  });

  // ===== index.ink 结构检查 =====
  console.log('\nindex.ink 接线:');
  await test('index.ink：Promise.allSettled([A2,A3]) 且 import 指向本 worktree 真 lib', async () => {
    const ink = await readFile(new URL('../pages/index/index.ink', import.meta.url), 'utf8');
    assert.match(ink, /Promise\.allSettled\(\[/, '应用 Promise.allSettled 跑 A2/A3');
    assert.match(ink, /from '\.\.\/\.\.\/lib\/agents\/combine\.js'/, 'combine import 指向真 lib');
    assert.match(ink, /drawFilmstrip/, '应调 drawFilmstrip');
    assert.doesNotMatch(ink, /TODO\(T14\)|TODO\(T13\)/, 'T14/T13 占位应已替换');
  });

  console.log(`\n========\n通过 ${passed}，失败 ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
