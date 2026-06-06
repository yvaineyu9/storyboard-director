// T15 · 故障注入测试（联调与降级演练）。
//
// 对**真集成版**（main:A1-A4 + 渲染器 + 编排 + 真库全在）做代码级故障注入，
// 逐条对照架构设计 §6.2（能力降级表）、§6.1（JSON 容错）、§6.3（追问规则）、
// §2.1（顺序/并行边界）验证降级逻辑。
//
// 环境限制：无 AIUI 真机/模拟器 → 用 node + mock（mock session / mock canvas ctx /
// 脏输入）做故障注入，验证降级路径不崩、走对兜底；UI 渲染 / LLM 真实输出标注"待真机验"。
//
// 运行：node tools/_t15-faults.mjs

import assert from 'node:assert/strict';

import { MAX_CLARIFY, runIntent } from '../lib/agents/intent.js';
import { fallbackComposition, runComposition } from '../lib/agents/composition.js';
import { buildFallbackRhythm, runRhythm } from '../lib/agents/rhythm.js';
import { combineStoryboard } from '../lib/agents/combine.js';
import { drawFilmstrip } from '../lib/renderer/filmstrip.js';
import { getById, loadLibrary } from '../lib/library.js';
import { rescueJSON } from '../lib/json-rescue.js';
import { MOODS, SHOT_SIZES, CAMERA_MOVES, COMPOSITIONS, TRANSITIONS } from '../lib/vocab.js';

let passed = 0;
let failed = 0;
const matrix = [];

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; matrix.push(['PASS', name]); console.log(`  PASS  ${name}`); })
    .catch((err) => { failed++; matrix.push(['FAIL', name, err.message]); console.error(`  FAIL  ${name}\n        ${err.message}`); });
}

// —— 真库为唯一契约：所有 templateId 必须 getById 命中真库 ——
const lib = loadLibrary();
const validIds = lib.templates.map((t) => t.id);

function allHitLibrary(shots) {
  return shots.every((s) => !!getById(s.templateId));
}
function distinctCameras(board) {
  return new Set(board.shots.map((s) => s.camera.id)).size;
}
function isBoardValid(board) {
  assert.ok(board.shotCount >= 3 && board.shotCount <= 6, `shotCount ∈[3,6]，实际 ${board.shotCount}`);
  assert.equal(board.shots.length, board.shotCount, 'shots 长度 = shotCount');
  assert.ok(allHitLibrary(board.shots), '每镜 templateId 命中真库');
  assert.ok(distinctCameras(board) <= 3, `distinct(camera) ≤ 3，实际 ${distinctCameras(board)}`);
  for (const s of board.shots) {
    assert.ok(Object.prototype.hasOwnProperty.call(MOODS, board.mood.id), 'mood 合法');
    assert.ok(Object.prototype.hasOwnProperty.call(SHOT_SIZES, s.shotSize.id), 'shotSize 合法');
    assert.ok(Object.prototype.hasOwnProperty.call(COMPOSITIONS, s.composition.id), 'composition 合法');
    assert.ok(Object.prototype.hasOwnProperty.call(CAMERA_MOVES, s.camera.id), 'camera 合法');
    assert.ok(Object.prototype.hasOwnProperty.call(TRANSITIONS, s.transition.id), 'transition 合法');
    assert.ok(s.duration >= 1 && s.duration <= 8, 'duration ∈[1,8]');
    assert.ok(Array.isArray(s.figure?.primitives) && s.figure.primitives.length, 'figure 真原语非空');
  }
  // 单 mood 护栏：board.mood 唯一
  assert.ok(board.mood && board.mood.id, '单一 mood');
}

// —— mock session（A2/A3）：可注入失败 / 脏 JSON / 越界长度 / 越界 id ——
function mockSession(raw, opts = {}) {
  return {
    destroyed: false,
    async prompt() {
      if (opts.fail) throw new Error('session prompt failed (injected)');
      return typeof raw === 'function' ? raw() : raw;
    },
    destroy() { this.destroyed = true; }
  };
}
function mockLM(raw, opts = {}) {
  return {
    async availability() { return opts.availability || 'available'; },
    async create() {
      if (opts.createFail) throw new Error('LanguageModel.create failed (injected)');
      return mockSession(raw, opts);
    }
  };
}

// —— 模拟 index.ink 编排的 availability 闸门（§2.1 顺序/并行边界）——
// 真编排在 index.ink 行 261-267；此处抽出等价的纯逻辑做 node 级断言。
async function orchestrateGate(LanguageModel) {
  // 复刻 index.ink：A1 启动前检测 availability，非 available 直接 error、不进入并行。
  if (!LanguageModel || typeof LanguageModel.availability !== 'function') {
    return { phase: 'error', errorText: 'AI 运行时暂不可用', enteredParallel: false };
  }
  let availability;
  try {
    availability = await LanguageModel.availability();
  } catch (e) {
    return { phase: 'error', errorText: 'AI 运行时暂不可用', enteredParallel: false };
  }
  if (availability !== 'available') {
    return { phase: 'error', errorText: 'AI 运行时暂不可用', enteredParallel: false };
  }
  return { phase: 'analyzing', enteredParallel: true };
}

const intent = {
  subject: '跑步的人',
  scene: '城市夜路',
  visualIntent: '紧张、速度、霓虹反光',
  mood: 'tense',
  shotCount: 5
};

function recordingCtx() {
  const calls = [];
  const ctx = {
    calls,
    set fillStyle(v) { calls.push(['fillStyle', v]); },
    set strokeStyle(v) { calls.push(['strokeStyle', v]); },
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

async function main() {
  console.log(`真库模板数：${validIds.length}（${validIds[0]}…${validIds[validIds.length - 1]}）\n`);

  // ===========================================================================
  // §6.2 行2：LanguageModel.availability() !== 'available' → error，不进入并行
  // ===========================================================================
  console.log('§6.2 行2 · LanguageModel 不可用 → error/降级，不进入并行:');

  await test('F1 availability="unavailable" → error，不进入并行', async () => {
    const g = await orchestrateGate(mockLM('{}', { availability: 'unavailable' }));
    assert.equal(g.phase, 'error');
    assert.equal(g.enteredParallel, false, '不可用绝不进入 A2/A3 并行');
    assert.equal(g.errorText, 'AI 运行时暂不可用');
  });

  await test('F2 availability="downloadable"（非 available）→ error，不进入并行', async () => {
    const g = await orchestrateGate(mockLM('{}', { availability: 'downloadable' }));
    assert.equal(g.phase, 'error');
    assert.equal(g.enteredParallel, false);
  });

  await test('F3 无 LanguageModel（undefined）→ error，不进入并行，不崩', async () => {
    const g = await orchestrateGate(undefined);
    assert.equal(g.phase, 'error');
    assert.equal(g.enteredParallel, false);
  });

  await test('F4 availability() 自身抛错 → 被吞，error，不进入并行', async () => {
    const badLM = { async availability() { throw new Error('boom'); }, async create() { return mockSession('{}'); } };
    const g = await orchestrateGate(badLM);
    assert.equal(g.phase, 'error');
    assert.equal(g.enteredParallel, false);
  });

  // 进一步：A2/A3 模块在「无 LM」时各自走纯领域回退，仍出合法结果（即便编排误放行也不崩）
  await test('F5 无 LM 传入 A2 → fallbackComposition 全命中真库（模块级双保险）', async () => {
    const out = await runComposition(intent, { LanguageModel: undefined, silent: true });
    assert.equal(out.source, 'fallback');
    assert.equal(out.shots.length, 5);
    assert.ok(allHitLibrary(out.shots), '无 LM 兜底仍全命中真库');
  });

  await test('F6 无 LM 传入 A3 → 模块B 降级（source=fallback）', async () => {
    const out = await runRhythm({ mood: 'tense', shotCount: 5 }, { LanguageModel: undefined });
    assert.equal(out.source, 'fallback');
    assert.equal(out.shots.length, 5);
  });

  // ===========================================================================
  // §6.2 行3：A2/A3 单路失败（Promise.allSettled）→ 失败路领域回退，另一路正常
  // ===========================================================================
  console.log('\n§6.2 行3 · A2/A3 单路失败（allSettled 不连坐）:');

  await test('F7 A2 单路失败 + A3 正常 → A2 走 nearestTemplate 真库兜底，A4 出合法 board', async () => {
    const [a2, a3] = await Promise.allSettled([
      runComposition(intent, { LanguageModel: mockLM(null, { fail: true }), silent: true }),
      runRhythm({ mood: intent.mood, shotCount: intent.shotCount }, {
        LanguageModel: mockLM(JSON.stringify({ shots: buildFallbackRhythm('tense', 5) }))
      })
    ]);
    // allSettled 内 runComposition 已自带 try/catch → 不会 rejected，而是 fulfilled+fallback
    const composition = a2.status === 'fulfilled' ? a2.value : fallbackComposition(intent);
    const rhythm = a3.status === 'fulfilled' ? a3.value : { shots: buildFallbackRhythm(intent.mood, intent.shotCount) };
    assert.equal(composition.source, 'fallback', 'A2 失败 → fallback');
    assert.ok(allHitLibrary(composition.shots), 'A2 兜底全命中真库（nearestTemplate）');
    const board = combineStoryboard(intent, composition, rhythm);
    isBoardValid(board);
    assert.ok(board.shotCount >= 3 && board.shotCount <= 6);
  });

  await test('F8 A3 单路失败 + A2 正常 → A3 走模块B 弧线，A4 出合法 board', async () => {
    const realShots = [
      { templateId: validIds[1], beat: 'establish', description: '一' },
      { templateId: validIds[5], beat: 'build', description: '二' },
      { templateId: validIds[9], beat: 'climax', description: '三' },
      { templateId: validIds[13], beat: 'build', description: '四' },
      { templateId: validIds[17], beat: 'close', description: '五' }
    ];
    const [a2, a3] = await Promise.allSettled([
      runComposition(intent, { LanguageModel: mockLM(JSON.stringify({ shots: realShots, cameraUsed: [] })), silent: true }),
      runRhythm({ mood: intent.mood, shotCount: intent.shotCount }, { LanguageModel: mockLM(null, { fail: true }), silent: true })
    ]);
    const composition = a2.value;
    const rhythm = a3.value;
    assert.equal(rhythm.source, 'fallback', 'A3 失败 → 模块B 降级');
    assert.equal(rhythm.shots.length, 5, 'A3 弧线长度=shotCount');
    const board = combineStoryboard(intent, composition, rhythm);
    isBoardValid(board);
  });

  await test('F9 A2 与 A3 双路同时失败 → A4 两路全回退仍出合法 board', async () => {
    const [a2, a3] = await Promise.allSettled([
      runComposition(intent, { LanguageModel: mockLM(null, { fail: true }), silent: true }),
      runRhythm({ mood: intent.mood, shotCount: intent.shotCount }, { LanguageModel: mockLM(null, { fail: true }), silent: true })
    ]);
    const board = combineStoryboard(intent, a2.value, a3.value);
    isBoardValid(board);
  });

  await test('F10 LanguageModel.create 抛错（会话创建失败）→ A2/A3 catch 后回退', async () => {
    const a2 = await runComposition(intent, { LanguageModel: mockLM(null, { createFail: true }), silent: true });
    const a3 = await runRhythm({ mood: intent.mood, shotCount: intent.shotCount }, { LanguageModel: mockLM(null, { createFail: true }), silent: true });
    assert.equal(a2.source, 'fallback');
    assert.ok(allHitLibrary(a2.shots));
    assert.equal(a3.source, 'fallback');
  });

  // ===========================================================================
  // §6.1 JSON 容错：脏 JSON（围栏 / 尾逗号 / 截断 / 单引号 / 全角）→ rescue + 字段清洗
  // ===========================================================================
  console.log('\n§6.1 · 脏 JSON → json-rescue + 字段清洗恢复或安全兜底:');

  await test('F11 围栏 ```json + 尾逗号 → rescueJSON 恢复', () => {
    const dirty = '```json\n{"ready":true,"intent":{"mood":"tense","shotCount":5,},}\n```';
    const parsed = rescueJSON(dirty);
    assert.ok(parsed && parsed.intent, 'rescue 应恢复对象');
    assert.equal(parsed.intent.mood, 'tense');
  });

  await test('F12 散文前缀 + 单引号 + 全角引号 → rescueJSON 恢复', () => {
    const dirty = "好的，结果是：{'mood'：'epic', “shotCount”：4}";
    const parsed = rescueJSON(dirty);
    assert.ok(parsed, 'rescue 应恢复');
    assert.equal(parsed.mood, 'epic');
    assert.equal(parsed.shotCount, 4);
  });

  await test('F13 截断 JSON（不平衡花括号）→ rescueJSON 返回 null（不抛）', () => {
    const truncated = '{"shots":[{"templateId":"T01","description":"未完成的';
    const parsed = rescueJSON(truncated);
    assert.equal(parsed, null, '截断应安全返回 null');
  });

  await test('F14 A2 收到脏 JSON（围栏+尾逗号，含真 id）→ 经 rescue+清洗全命中真库', async () => {
    const dirty = '```json\n{"shots":[{"templateId":"' + validIds[0] + '","beat":"establish","description":"建立",},{"templateId":"' + validIds[3] + '","description":"推进",},{"templateId":"' + validIds[7] + '","description":"收尾",}],"cameraUsed":[],}\n```';
    const out = await runComposition({ ...intent, shotCount: 3 }, { LanguageModel: mockLM(dirty), silent: true });
    assert.equal(out.shots.length, 3);
    assert.ok(allHitLibrary(out.shots), '脏 JSON 恢复后全命中真库');
  });

  await test('F15 A3 收到截断脏 JSON（rescue→null）→ 模块B 安全兜底', async () => {
    const out = await runRhythm({ mood: 'epic', shotCount: 4 }, { LanguageModel: mockLM('{"shots":[{"duration":5,"cutSpeed":"slow"'), silent: true });
    assert.equal(out.source, 'fallback', 'rescue 失败 → 模块B 兜底');
    assert.equal(out.shots.length, 4);
  });

  await test('F16 A1 收到非 JSON 散文 + 完整描述 → 启发式兜底 ready=true，命中真 vocab', async () => {
    const r = await runIntent('拍摄一个跑步的人在城市夜路，紧张，5镜', {
      session: { prompt: async () => '抱歉我无法用 JSON 回答你' }, clarifyCount: 0
    });
    assert.equal(r.ready, true);
    assert.equal(r.intent.mood, 'tense');
    assert.equal(r.intent.shotCount, 5);
    assert.ok(Object.prototype.hasOwnProperty.call(MOODS, r.intent.mood), 'mood ∈ 真 vocab');
  });

  // ===========================================================================
  // §6.1 字段清洗 + §2.5 A4：越界 id / 越界 shotCount / 两路长度不一致
  // ===========================================================================
  console.log('\n§6.1/§2.5 · 越界 id / 越界 shotCount / 两路长度不一致 → vocab.pick / nearestTemplate / clamp(3,6):');

  await test('F17 A2 返回全越界 templateId（ZZZ/NOPE99/空）→ nearestTemplate 兜底全命中真库', async () => {
    const bad = JSON.stringify({ shots: [
      { templateId: 'ZZZ', description: '一' },
      { templateId: 'NOPE99', description: '二' },
      { templateId: '', description: '三' }
    ], cameraUsed: [] });
    const out = await runComposition({ ...intent, shotCount: 3 }, { LanguageModel: mockLM(bad), silent: true });
    assert.equal(out.shots.length, 3);
    assert.ok(allHitLibrary(out.shots), '越界 id 经 nearestTemplate 兜底全命中真库');
  });

  await test('F18 越界 shotCount=9 → clamp 到 6；shotCount=0 → clamp 到 3', () => {
    const big = combineStoryboard({ ...intent, shotCount: 9 }, fallbackComposition({ ...intent, shotCount: 9 }), { shots: buildFallbackRhythm('tense', 9) });
    assert.equal(big.shotCount, 6, 'clamp 上界 6');
    isBoardValid(big);
    const small = combineStoryboard({ ...intent, shotCount: 0 }, fallbackComposition({ ...intent, shotCount: 0 }), { shots: buildFallbackRhythm('tense', 0) });
    assert.equal(small.shotCount, 3, 'clamp 下界 3');
    isBoardValid(small);
  });

  await test('F19 越界 shotCount=NaN/负数 → clamp 兜底 + board 合法', () => {
    for (const bad of [NaN, -5, 'abc', undefined, 100]) {
      const board = combineStoryboard({ ...intent, shotCount: bad }, fallbackComposition({ ...intent, shotCount: bad }), { shots: buildFallbackRhythm('tense', 4) });
      isBoardValid(board);
    }
  });

  await test('F20 两路长度不一致（A2=6镜 / A3=2镜，intent=5）→ A4 按 shotCount=5 对齐补齐', () => {
    const shotsA = { shots: [0, 4, 8, 12, 16, 20].map((n, i) => ({ templateId: validIds[n], description: `镜${i}` })) }; // 6
    const shotsB = { shots: buildFallbackRhythm('tense', 2) }; // 2
    const board = combineStoryboard({ ...intent, shotCount: 5 }, shotsA, shotsB);
    assert.equal(board.shotCount, 5, '以 intent.shotCount 为镜数真相');
    assert.equal(board.shots.length, 5);
    isBoardValid(board);
  });

  await test('F21 两路都空数组（A2=[] / A3=[]）→ A4 全回退补齐出合法 board', () => {
    const board = combineStoryboard({ ...intent, shotCount: 4 }, { shots: [] }, { shots: [] });
    assert.equal(board.shotCount, 4);
    isBoardValid(board);
  });

  await test('F22 A2 越界运镜泛滥（强喂多 camera 模板）→ A4 护栏 distinct(camera) ≤ 3', () => {
    const cams = new Map();
    for (const t of lib.templates) if (!cams.has(t.caption.camera)) cams.set(t.caption.camera, t.id);
    const sixIds = Array.from(cams.values()).slice(0, 6);
    while (sixIds.length < 6) sixIds.push(validIds[sixIds.length]);
    const shotsA = { shots: sixIds.map((id, i) => ({ templateId: id, description: `镜${i}` })) };
    const board = combineStoryboard({ ...intent, shotCount: 6 }, shotsA, { shots: buildFallbackRhythm('tense', 6) });
    assert.ok(distinctCameras(board) <= 3, `护栏后 distinct(camera) ≤ 3，实际 ${distinctCameras(board)}`);
    assert.ok(allHitLibrary(board.shots), '护栏替换后仍全命中真库');
    isBoardValid(board);
  });

  await test('F23 A3 越界 duration / 非法 cutSpeed / 非法 transition → 字段清洗', async () => {
    const dirty = JSON.stringify({ shots: [
      { duration: 999, cutSpeed: 'hyperfast', transition: 'teleport', pause: 'yes' },
      { duration: -3, cutSpeed: 123, transition: 'WARP', pause: 1 },
      { duration: 'x', cutSpeed: 'slow', transition: 'cut', pause: false },
      { duration: 4, cutSpeed: 'fast', transition: 'whip', pause: true }
    ] });
    const out = await runRhythm({ mood: 'tense', shotCount: 4 }, { LanguageModel: mockLM(dirty), silent: true });
    assert.equal(out.shots.length, 4);
    for (const s of out.shots) {
      assert.ok(s.duration >= 1 && s.duration <= 8, `duration 清洗到 [1,8]，实际 ${s.duration}`);
      assert.ok(['slow', 'medium', 'fast', 'veryfast'].includes(s.cutSpeed), `cutSpeed 清洗，实际 ${s.cutSpeed}`);
      assert.ok(Object.prototype.hasOwnProperty.call(TRANSITIONS, s.transition), `transition 清洗到真词表，实际 ${s.transition}`);
      assert.equal(typeof s.pause, 'boolean', 'pause 布尔化');
    }
  });

  await test('F24 A1 越界 mood（不在 vocab）+ 越界 shotCount → pick 默认 + clamp', async () => {
    const dirty = JSON.stringify({ ready: true, intent: { subject: '猫', scene: '客厅', visualIntent: '', mood: 'spooky', shotCount: 42 } });
    const r = await runIntent('拍只猫在客厅', { session: { prompt: async () => dirty }, clarifyCount: 0 });
    assert.ok(Object.prototype.hasOwnProperty.call(MOODS, r.intent.mood), `越界 mood 回退到合法值，实际 ${r.intent.mood}`);
    assert.ok(r.intent.shotCount >= 3 && r.intent.shotCount <= 6, `shotCount clamp，实际 ${r.intent.shotCount}`);
  });

  // ===========================================================================
  // §6.2 行4：canvas createCanvasContext 返回 null → 重试后降级，不抛
  // ===========================================================================
  console.log('\n§6.2 行4 · canvas createCanvasContext 返回 null → 重试后降级不抛:');

  const goodBoard = combineStoryboard(intent, {
    shots: [0, 4, 8, 12, 16].map((n, i) => ({ templateId: validIds[n], description: `c${i}` }))
  }, { shots: buildFallbackRhythm('tense', 5) });

  await test('F25 createCanvasContext 恒 null → 重试 maxRetries 次后降级 {ok:false}', async () => {
    let attempts = 0;
    const r = await drawFilmstrip(goodBoard.filmstripModel, {
      wxImpl: { createCanvasContext: () => { attempts++; return null; } },
      maxRetries: 5, retryDelay: 1
    });
    assert.equal(r.ok, false, '应降级返回 ok:false');
    assert.equal(r.reason, 'canvas-unavailable');
    assert.equal(attempts, 6, '应尝试 maxRetries+1=6 次（含首次）');
  });

  await test('F26 createCanvasContext 前几次 null、第 N 次就绪 → 重试后成功绘制', async () => {
    let attempts = 0;
    const ctx = recordingCtx();
    const r = await drawFilmstrip(goodBoard.filmstripModel, {
      wxImpl: { createCanvasContext: () => { attempts++; return attempts >= 3 ? ctx : null; } },
      maxRetries: 5, retryDelay: 1
    });
    assert.equal(r.ok, true, '重试到就绪应成功');
    assert.ok(ctx.calls.length > 0, '应有真实绘制调用');
    const methods = new Set(ctx.calls.map((c) => c[0]));
    assert.ok(methods.has('flush') || methods.has('draw'), '应 flush/draw 收尾');
  });

  await test('F27 wx 缺失 createCanvasContext 方法 → 降级不抛', async () => {
    const r = await drawFilmstrip(goodBoard.filmstripModel, { wxImpl: {}, maxRetries: 0 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'canvas-unavailable');
  });

  await test('F28 ctx 方法残缺（无 flush/无 arc）→ 渲染器内部 call 守卫，不抛', async () => {
    // 只提供属性式颜色 setter，缺大量绘制方法 → call() 守卫应静默跳过、不崩。
    const calls = [];
    const partialCtx = {
      set fillStyle(v) { calls.push(v); },
      set strokeStyle(v) { calls.push(v); },
      set lineWidth(v) {},
      fillRect() {}, strokeRect() {} // 缺 beginPath/arc/moveTo/flush 等
    };
    const r = await drawFilmstrip(goodBoard.filmstripModel, { wxImpl: { createCanvasContext: () => partialCtx }, maxRetries: 0 });
    assert.equal(r.ok, true, '残缺 ctx 也应走完 render 不抛');
    for (const col of calls) assert.ok(col === '#000' || col === '#40FF5E', `颜色只能两色，出现 ${col}`);
  });

  // ===========================================================================
  // §6.3 追问规则：缺关键三项 → ready=false 定向追问；达上限强制 ready=true
  // ===========================================================================
  console.log('\n§6.3 · 追问触发与上限:');

  await test('F29 缺 scene/mood（信息不足）+ clarify<上限 → ready=false 定向追问', async () => {
    const r = await runIntent('帮我做点东西', { session: { prompt: async () => '{}' }, clarifyCount: 0 });
    assert.equal(r.ready, false, '信息不足应追问');
    assert.ok(r.ask && r.ask.length > 0, '应给出定向追问话术');
    assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(r.ask), '追问话术无 emoji');
  });

  await test('F30 达到 MAX_CLARIFY 上限仍缺项 → 强制 ready=true 用默认值进并行', async () => {
    const r = await runIntent('模糊描述', { session: { prompt: async () => '{}' }, clarifyCount: MAX_CLARIFY });
    assert.equal(r.ready, true, '到上限强制 ready=true');
    assert.ok(Object.prototype.hasOwnProperty.call(MOODS, r.intent.mood), 'mood 用合法默认值');
    assert.ok(r.intent.shotCount >= 3 && r.intent.shotCount <= 6, 'shotCount 默认值合法');
  });

  await test('F31 A1 session 自身 prompt 抛错 → 视为解析失败走启发式，不崩', async () => {
    const r = await runIntent('拍一个海边的人，史诗壮阔，4镜', {
      session: { prompt: async () => { throw new Error('LM prompt failed'); } }, clarifyCount: 0
    });
    // 启发式：海边=scene，史诗=epic，4镜=shotCount，subject 启发式抽取 → ready
    assert.ok(Object.prototype.hasOwnProperty.call(MOODS, r.intent.mood), 'mood 合法');
    assert.ok(r.intent.shotCount >= 3 && r.intent.shotCount <= 6);
  });

  await test('F32 A1 无 session（session 缺失）→ 不抛，走启发式兜底', async () => {
    const r = await runIntent('拍跑步的人在公路，紧张，5镜', { clarifyCount: 0 });
    assert.equal(r.intent.mood, 'tense');
    assert.equal(r.intent.shotCount, 5);
  });

  // ===========================================================================
  // 端到端降级链路：最恶劣组合（LM 全脏 + canvas null）仍出合法 board + 文字降级
  // ===========================================================================
  console.log('\n端到端 · 最恶劣组合降级:');

  await test('F33 A2 脏+越界 / A3 截断 / canvas null 同时发生 → board 合法 + 胶片条文字降级', async () => {
    const dirtyA2 = '```json\n{"shots":[{"templateId":"BAD1",},{"templateId":"BAD2",},{"templateId":"BAD3",},{"templateId":"BAD4",},{"templateId":"BAD5",}],}\n```';
    const [a2, a3] = await Promise.allSettled([
      runComposition(intent, { LanguageModel: mockLM(dirtyA2), silent: true }),
      runRhythm({ mood: intent.mood, shotCount: intent.shotCount }, { LanguageModel: mockLM('{"shots":[{"duration":'), silent: true })
    ]);
    const composition = a2.status === 'fulfilled' ? a2.value : fallbackComposition(intent);
    const rhythm = a3.status === 'fulfilled' ? a3.value : { shots: buildFallbackRhythm(intent.mood, intent.shotCount) };
    const board = combineStoryboard(intent, composition, rhythm);
    isBoardValid(board);
    // markdown 含构图/景别/运镜/时长/转场（canvas 降级时文字版仍可读 §6.2 行4）
    assert.ok(board.markdown.includes('## ') && board.markdown.includes('转场'), 'markdown 文字版完整');
    const render = await drawFilmstrip(board.filmstripModel, { wxImpl: { createCanvasContext: () => null }, maxRetries: 1, retryDelay: 1 });
    assert.equal(render.ok, false, 'canvas 降级');
    // 文字降级仍可展示 board.markdown，不阻断结果
    assert.ok(board.markdown.length > 0, '文字降级仍有内容可展示');
  });

  // ===========================================================================
  console.log(`\n========\n通过 ${passed}，失败 ${failed}`);
  console.log('\n故障矩阵概览:');
  for (const [status, name] of matrix) console.log(`  [${status}] ${name}`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
