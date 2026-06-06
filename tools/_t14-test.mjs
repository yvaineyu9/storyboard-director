import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  MAX_CLARIFY,
  createIntentSession,
  runIntent
} from '../lib/agents/intent.js';
import {
  fallbackComposition,
  runComposition
} from '../lib/agents/composition.js';
import {
  buildFallbackRhythm,
  runRhythm
} from '../lib/agents/rhythm.js';
import {
  combineStoryboard
} from '../lib/agents/combine.js';
import {
  drawFilmstrip
} from '../lib/renderer/filmstrip.js';

function makeLanguageModel({ failComposition = false, failRhythm = false } = {}) {
  const createCalls = [];
  const sessions = [];

  const LanguageModel = {
    async availability() {
      return 'available';
    },
    async create(options) {
      const id = createCalls.length + 1;
      const system = options?.initialPrompts?.[0]?.content || '';
      createCalls.push({ id, system });
      const session = {
        id,
        destroyed: false,
        async prompt(input) {
          if (system.includes('A1 意图')) {
            return JSON.stringify({
              ready: false,
              ask: '你想拍摄的场景和情绪是什么？',
              missing: ['scene', 'mood'],
              intent: { subject: '一支产品广告', scene: '', visualIntent: input, mood: '', shotCount: 4 }
            });
          }
          if (system.includes('A2 构图')) {
            if (failComposition) throw new Error('composition failed');
            return JSON.stringify({
              shots: [
                { templateId: 'T01', beat: 'establish', description: '用远景建立空间' },
                { templateId: 'T05', beat: 'build', description: '跟随主体推进' },
                { templateId: 'T09', beat: 'close', description: '特写收束情绪' }
              ],
              cameraUsed: ['fixed', 'track', 'dolly']
            });
          }
          if (system.includes('A3 节奏')) {
            if (failRhythm) throw new Error('rhythm failed');
            return JSON.stringify({
              shots: [
                { duration: 4, cutSpeed: 'slow', transition: 'dissolve', pause: false },
                { duration: 3, cutSpeed: 'medium', transition: 'cut', pause: false },
                { duration: 5, cutSpeed: 'slow', transition: 'fade', pause: true }
              ]
            });
          }
          return '{}';
        },
        destroy() {
          this.destroyed = true;
        }
      };
      sessions.push(session);
      return session;
    }
  };

  return { LanguageModel, createCalls, sessions };
}

function makeCtx() {
  const calls = [];
  const ctx = new Proxy({}, {
    get(_, prop) {
      if (prop === 'calls') return calls;
      return (...args) => calls.push([String(prop), ...args]);
    }
  });
  return ctx;
}

function makePlainCtx() {
  const calls = [];
  const ctx = {
    calls,
    beginPath: () => calls.push(['beginPath']),
    moveTo: (...args) => calls.push(['moveTo', ...args]),
    lineTo: (...args) => calls.push(['lineTo', ...args]),
    rect: (...args) => calls.push(['rect', ...args]),
    arc: (...args) => calls.push(['arc', ...args]),
    stroke: () => calls.push(['stroke']),
    fill: () => calls.push(['fill']),
    fillRect: (...args) => calls.push(['fillRect', ...args]),
    fillText: (...args) => calls.push(['fillText', ...args]),
    draw: () => calls.push(['draw'])
  };
  return ctx;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function loadIndexPageFactory(overrides = {}) {
  const indexInk = await readFile(new URL('../pages/index/index.ink', import.meta.url), 'utf8');
  const match = indexInk.match(/<script setup>([\s\S]*?)<\/script>/);
  assert.ok(match, 'index.ink should contain <script setup>');
  const script = match[1]
    .replace(/^import\s+.*;\s*$/gm, '')
    .replace(/export\s+default\s+/, 'return ');
  const factory = new Function(
    'LanguageModel',
    'MAX_CLARIFY',
    'createIntentSession',
    'runIntent',
    'fallbackComposition',
    'runComposition',
    'buildFallbackRhythm',
    'runRhythm',
    'combineStoryboard',
    'drawFilmstrip',
    'wx',
    script
  );
  return factory(
    overrides.LanguageModel,
    overrides.MAX_CLARIFY ?? MAX_CLARIFY,
    overrides.createIntentSession,
    overrides.runIntent,
    overrides.fallbackComposition,
    overrides.runComposition,
    overrides.buildFallbackRhythm,
    overrides.runRhythm,
    overrides.combineStoryboard,
    overrides.drawFilmstrip,
    overrides.wx
  );
}

function instantiatePage(pageDef) {
  const page = {
    data: JSON.parse(JSON.stringify(pageDef.data || {})),
    setData(update) {
      Object.assign(this.data, update || {});
    }
  };
  for (const [key, value] of Object.entries(pageDef)) {
    if (key === 'data') continue;
    page[key] = typeof value === 'function' ? value.bind(page) : value;
  }
  return page;
}

async function main() {
  assert.equal(MAX_CLARIFY, 2, 'A1 clarify cap should be 2');

  {
    const fake = makeLanguageModel();
    const session = await createIntentSession(fake.LanguageModel);
    const result = await runIntent('我想拍一个产品广告', { session, clarifyCount: 0 });
    assert.equal(result.ready, false, 'A1 should be able to stop the pipeline before readiness');
    assert.ok(result.ask, 'A1 not-ready result should include an ask');
    assert.equal(fake.createCalls.length, 1, 'A1 should create exactly one sequential session');
  }

  {
    const result = await runIntent('拍摄一个跑步的人在城市夜路，紧张，5镜', {
      session: { prompt: async () => '这不是 JSON' },
      clarifyCount: 0
    });
    assert.equal(result.ready, true, 'A1 parse failure should fall back to heuristics when input is complete');
    assert.equal(result.intent.shotCount, 5);
    assert.equal(result.intent.mood, 'tense');
  }

  const intent = {
    subject: '跑步的人',
    scene: '城市夜路',
    visualIntent: '紧张、速度、霓虹反光',
    mood: 'tense',
    shotCount: 3
  };

  {
    const fake = makeLanguageModel();
    const [composition, rhythm] = await Promise.allSettled([
      runComposition(intent, { LanguageModel: fake.LanguageModel }),
      runRhythm({ mood: intent.mood, shotCount: intent.shotCount }, { LanguageModel: fake.LanguageModel })
    ]);
    assert.equal(composition.status, 'fulfilled');
    assert.equal(rhythm.status, 'fulfilled');
    assert.equal(fake.createCalls.length, 2, 'A2 and A3 must create two independent sessions');
    assert.notEqual(fake.createCalls[0].id, fake.createCalls[1].id, 'A2/A3 session ids should differ');
  }

  {
    const fake = makeLanguageModel({ failComposition: true, failRhythm: true });
    const composition = await runComposition(intent, { LanguageModel: fake.LanguageModel, silent: true });
    const rhythm = await runRhythm({ mood: intent.mood, shotCount: intent.shotCount }, { LanguageModel: fake.LanguageModel, silent: true });
    assert.equal(composition.shots.length, 3, 'A2 fallback should still produce shotCount shots');
    assert.equal(rhythm.shots.length, 3, 'A3 fallback should still produce shotCount rhythm shots');
  }

  {
    const board = combineStoryboard(
      intent,
      fallbackComposition(intent),
      { shots: buildFallbackRhythm(intent.mood, intent.shotCount) }
    );
    assert.equal(board.shotCount, 3);
    assert.equal(board.shots.length, 3);
    assert.ok(board.markdown.includes('##'));
    assert.equal(board.guidance.length, 3);
    assert.equal(board.filmstripModel.cells.length, 3);

    const ctx = makeCtx();
    const drawResult = await drawFilmstrip(board.filmstripModel, {
      wxImpl: { createCanvasContext: () => ctx },
      maxRetries: 0
    });
    assert.equal(drawResult.ok, true);
    assert.ok(ctx.calls.length > 0, 'drawFilmstrip should issue canvas calls');

    const failedDraw = await drawFilmstrip(board.filmstripModel, {
      wxImpl: { createCanvasContext: () => null },
      maxRetries: 0
    });
    assert.equal(failedDraw.ok, false, 'canvas null should degrade without throwing');

    const plainCtx = makePlainCtx();
    const plainDraw = await drawFilmstrip(board.filmstripModel, {
      wxImpl: { createCanvasContext: () => plainCtx },
      maxRetries: 0
    });
    assert.equal(plainDraw.ok, true);
    assert.equal(plainCtx.fillStyle, '#40FF5E', 'renderer should support property-style canvas APIs');
    assert.equal(plainCtx.strokeStyle, '#40FF5E', 'renderer should support property-style stroke APIs');
  }

  {
    const availability = deferred();
    let runIntentCalls = 0;
    const pageDef = await loadIndexPageFactory({
      LanguageModel: { availability: () => availability.promise },
      createIntentSession: async () => ({ destroy() {} }),
      runIntent: async () => {
        runIntentCalls++;
        return { ready: true, intent };
      },
      fallbackComposition,
      runComposition: async () => fallbackComposition(intent),
      buildFallbackRhythm,
      runRhythm: async () => ({ shots: buildFallbackRhythm(intent.mood, intent.shotCount) }),
      combineStoryboard,
      drawFilmstrip: async () => ({ ok: true }),
      wx: {}
    });
    const page = instantiatePage(pageDef);
    const staleRun = page.runAgent('旧描述');
    page.cancelAgent();
    availability.resolve('available');
    await staleRun;
    assert.equal(runIntentCalls, 0, 'stale runs must not prompt or mutate A1 after cancellation');
  }

  {
    const wxStub = { createCanvasContext: () => makeCtx() };
    const drawCalls = [];
    const pageDef = await loadIndexPageFactory({
      LanguageModel: { availability: async () => 'available' },
      createIntentSession: async () => ({ destroy() {} }),
      runIntent: async () => ({ ready: true, intent }),
      fallbackComposition,
      runComposition: async () => fallbackComposition(intent),
      buildFallbackRhythm,
      runRhythm: async () => ({ shots: buildFallbackRhythm(intent.mood, intent.shotCount) }),
      combineStoryboard,
      drawFilmstrip: async (...args) => {
        drawCalls.push(args);
        return { ok: true };
      },
      wx: wxStub
    });
    const page = instantiatePage(pageDef);
    page._runId = 7;
    page.data.phase = 'result';
    await page.renderFilmstrip({ cells: [] }, 7);
    assert.equal(drawCalls[0][1]?.wxImpl, wxStub, 'page should pass imported wx into drawFilmstrip');
  }

  {
    const indexInk = await readFile(new URL('../pages/index/index.ink', import.meta.url), 'utf8');
    assert.match(indexInk, /Promise\.allSettled\(\[/, 'index.ink should use Promise.allSettled for A2/A3');
    assert.doesNotMatch(indexInk, /TODO\(T14\)|TODO\(T13\)/, 'T14/T13 placeholders should be replaced');
  }
}

main().then(
  () => console.log('T14 orchestration checks passed'),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
