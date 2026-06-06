<script def>
{
  "navigationBarTitleText": "分镜导演"
}
</script>

<script setup>
// 防御式全局引用：macOS demo 运行时不提供 'language-model' 模块（端侧 LLM 只在眼镜真机），
// LanguageModel 挂在 globalThis 上。裸 import 会触发 Module not found 整页崩溃。
const LanguageModel = (typeof globalThis !== 'undefined' && globalThis.LanguageModel) || (typeof window !== 'undefined' && window.LanguageModel) || null;
import wx from 'wx';
import { MAX_CLARIFY, createIntentSession, runIntent } from '../../lib/agents/intent.js';
import { fallbackComposition, runComposition } from '../../lib/agents/composition.js';
import { buildFallbackRhythm, runRhythm } from '../../lib/agents/rhythm.js';
import { combineStoryboard } from '../../lib/agents/combine.js';
import { drawFilmstrip } from '../../lib/renderer/filmstrip.js';

// T14：A1→[A2‖A3]→A4→streamdown/canvas 编排接线。

// 六态总览：idle | listening | clarifying | analyzing | result | error
// analyzing 子阶段：intent | parallel | combine

// 顶部状态点文案（中文、无 emoji）。参样例 STATUS_TEXT 思路。
const STATUS_TEXT = {
  idle: '轻触下方按钮，说出你想拍的画面',
  listening: '聆听中…',
  clarifying: '需要再确认一下',
  analyzing: '分析中…',
  result: '分镜已生成',
  error: '出错了'
};

// 麦克风按钮文案。参样例 MIC_LABEL 思路。
const MIC_LABEL = {
  idle: '说话',
  listening: '停止',
  clarifying: '补充',
  analyzing: '取消',
  result: '再拍一条',
  error: '重试'
};

// analyzing 子阶段进度文案（意图→并行→组合）。
const STAGE_TEXT = {
  intent: '正在理解你的意图…',
  parallel: '正在并行推演构图与剪辑节奏…',
  combine: '正在组合分镜…'
};

// 官方 SpeechRecognition 的 result 事件（apis-ai.md）暴露 resultIndex / results / sessionId。
// 运行时已完成识别、直接给文字——不做 Web Speech 的 alternatives（result[0]）嵌套解析。
// 兼容 results 为：字符串 / 文本数组 / RecognitionResult({transcript|text, isFinal}) 数组。
function readRecognizedText(event) {
  if (!event) return { text: '', isFinal: false };
  let r = event.results;
  if (Array.isArray(r)) r = r.length ? r[r.length - 1] : '';
  if (typeof r === 'string') {
    return { text: r.trim(), isFinal: event.isFinal !== false };
  }
  if (r && typeof r === 'object') {
    const raw = typeof r.transcript === 'string' ? r.transcript
              : typeof r.text === 'string' ? r.text : '';
    const isFinal = r.isFinal != null ? !!r.isFinal
                  : event.isFinal != null ? !!event.isFinal : true;
    return { text: raw.trim(), isFinal };
  }
  return { text: '', isFinal: false };
}

export default {
  data: {
    // —— 状态机 ——
    phase: 'idle',
    stage: '',                 // analyzing 子阶段：intent|parallel|combine
    statusText: STATUS_TEXT.idle,
    stageText: '',
    micLabel: MIC_LABEL.idle,

    // —— 语音 ——
    displayQuery: '',          // listening 实时转写

    // —— clarifying（追问）——
    ask: '',                   // A1 追问话术

    // —— result（结果）——
    markdown: '',              // <streamdown> 卡片内容
    isStreaming: false,
    filmstripCells: [],        // Canvas 胶片条模型 cells
    filmstripFailed: false,    // Canvas 失败时隐藏胶片条，保留 Markdown 文字版
    guidance: [],              // 逐镜指引列表

    // —— error ——
    errorText: '',

    // —— idle 提示 ——
    hintText: '语音描述你想拍的画面与情绪'
  },

  onLoad() {
    // 能力降级：运行时不支持语音识别 → 直接进 error 态。
    if (typeof SpeechRecognition === 'undefined') {
      this.setPhase('error', { errorText: '当前运行时不支持语音输入' });
    }
  },

  onUnload() {
    this.teardown();
  },

  // 眼镜硬件键切麦，等价于点按钮。复用样例 onKeyDown。
  onKeyDown() {
    this.onMicTap();
  },

  // 统一状态切换：写入 phase + 派生文案，再合并额外字段。
  setPhase(phase, extra) {
    const next = Object.assign({
      phase,
      statusText: STATUS_TEXT[phase] || '',
      micLabel: MIC_LABEL[phase] || '说话'
    }, extra || {});
    // 非 analyzing 态清空子阶段文案，避免残留。
    if (phase !== 'analyzing' && !('stage' in next)) {
      next.stage = '';
      next.stageText = '';
    }
    this.setData(next);
  },

  // analyzing 子阶段切换（intent→parallel→combine），驱动进度文案。
  setStage(stage) {
    this.setData({ stage, stageText: STAGE_TEXT[stage] || '' });
  },

  // 麦克风/主按钮统一入口，按当前 phase 分派。
  onMicTap() {
    const phase = this.data.phase;
    if (phase === 'listening') {
      this.stopListening();
      return;
    }
    if (phase === 'analyzing') {
      this.cancelAgent();
      return;
    }
    // idle / clarifying / result / error 均以「开始聆听」收口
    // （result 的「再拍一条」、error 的「重试」、clarifying 的「补充」都回到 listening）。
    this.startListening();
  },

  startListening() {
    if (typeof SpeechRecognition === 'undefined') {
      this.setPhase('error', { errorText: '当前运行时不支持语音输入' });
      return;
    }

    const isClarifyFollowup = this.data.phase === 'clarifying';
    if (!isClarifyFollowup) {
      this.resetAgentState();
    }
    this._isClarifyFollowup = isClarifyFollowup;

    this.disposeRecognition();
    this._finalText = '';

    let recognition;
    try {
      recognition = new SpeechRecognition();
    } catch (error) {
      console.error('Failed to create SpeechRecognition', error);
      this.setPhase('error', { errorText: '无法启动语音识别' });
      return;
    }

    recognition.lang = 'zh-CN';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const { text, isFinal } = readRecognizedText(event);
      if (text) {
        this.setData({ displayQuery: text });
      }
      if (isFinal && text) {
        this._finalText = text;
      }
    };

    recognition.onerror = (event) => {
      console.error('Recognition error', event && event.error);
      this._finalText = '';
      this.disposeRecognition();
      this.setPhase('error', { errorText: '没听清，请再试一次' });
    };

    recognition.onend = () => {
      this.disposeRecognition();
      if (this.data.phase !== 'listening') {
        return;
      }
      const finalText = this._finalText || this.data.displayQuery;
      if (finalText) {
        this.runAgent(finalText);
      } else {
        this.setPhase('idle');
      }
    };

    try {
      // start() 需要交互式调用点；此处由 tap / 硬件键事件触发。
      recognition.start();
      this._recognition = recognition;
      this.setPhase('listening', {
        displayQuery: '',
        ask: isClarifyFollowup ? this.data.ask : '',
        markdown: '',
        errorText: '',
        isStreaming: false,
        filmstripFailed: false,
        filmstripCells: [],
        guidance: []
      });
    } catch (error) {
      console.error('recognition.start() failed', error);
      this.disposeRecognition();
      this.setPhase('idle', { errorText: '此处无法使用麦克风' });
    }
  },

  stopListening() {
    if (this._recognition) {
      try {
        this._recognition.stop();
      } catch (error) {
        console.error('recognition.stop() failed', error);
      }
    }
  },

  // 拿到 ASR final 文本后的编排入口。
  async runAgent(query) {
    const runId = (this._runId || 0) + 1;
    this._runId = runId;
    if (!this._intentInputs) this._intentInputs = [];
    this._intentInputs.push(query);

    this.setPhase('analyzing', {
      displayQuery: query,
      markdown: '',
      ask: '',
      errorText: '',
      isStreaming: false,
      filmstripFailed: false,
      filmstripCells: [],
      guidance: []
    });
    this.setStage('intent');

    try {
      // 计算 LLM 是否真正可用：模块缺失（macOS demo）或 availability 非 available 时降级。
      const useLLM = !!(LanguageModel) && (await LanguageModel.availability().catch(() => 'unavailable')) === 'available';
      if (this._runId !== runId) return;

      if (!useLLM) {
        // 确定性兜底：无端侧 LLM 也能出分镜（启发式意图 + 兜底构图/节奏）。
        const fallbackIntentText = (this._intentInputs || [])
          .map((text, index) => `${index === 0 ? '初始描述' : `补充${index}`}：${text}`)
          .join('\n');
        const intentResult = await runIntent(fallbackIntentText, {
          clarifyCount: this._clarifyCount || 0
        });
        if (this._runId !== runId) return;
        // macOS demo 无法多轮 LLM 追问：即使 ready=false 也直接用其 intent 继续。
        const intent = intentResult.intent;
        this.setStage('parallel');
        const composition = fallbackComposition(intent);
        const rhythm = {
          shots: buildFallbackRhythm(intent.mood, intent.shotCount),
          source: 'fallback'
        };
        if (this._runId !== runId) return;
        this.setStage('combine');
        const board = combineStoryboard(intent, composition, rhythm);
        this._latestFilmstripModel = board.filmstripModel;
        this.setPhase('result', {
          displayQuery: query,
          markdown: board.markdown,
          isStreaming: false,
          errorText: '',
          ask: '',
          filmstripFailed: false,
          filmstripCells: board.filmstripModel.cells,
          guidance: board.guidance
        });
        this.clearConversationState();
        this.renderFilmstrip(board.filmstripModel, runId);
        return;
      }

      let intentSession = this._intentSession;
      if (!intentSession) {
        intentSession = await createIntentSession(LanguageModel, {
          onSession: (session) => this.trackSession(session)
        });
        if (this._runId !== runId) {
          this.releaseSession(intentSession);
          if (intentSession && typeof intentSession.destroy === 'function') {
            intentSession.destroy();
          }
          return;
        }
        this._intentSession = intentSession;
      }

      if (this._runId !== runId) return;
      const intentText = (this._intentInputs || [])
        .map((text, index) => `${index === 0 ? '初始描述' : `补充${index}`}：${text}`)
        .join('\n');
      const intentResult = await runIntent(intentText, {
        session: intentSession,
        clarifyCount: this._clarifyCount || 0
      });
      if (this._runId !== runId) return;

      if (!intentResult.ready && (this._clarifyCount || 0) < MAX_CLARIFY) {
        this._clarifyCount = (this._clarifyCount || 0) + 1;
        this.setPhase('clarifying', {
          ask: intentResult.ask,
          markdown: intentResult.ask,
          isStreaming: false,
          errorText: ''
        });
        return;
      }

      const intent = intentResult.intent;
      this.disposeIntentSession();
      this.setStage('parallel');

      const [compositionSettled, rhythmSettled] = await Promise.allSettled([
        runComposition(intent, {
          LanguageModel,
          onSession: (session) => this.trackSession(session)
        }),
        runRhythm({ mood: intent.mood, shotCount: intent.shotCount }, {
          LanguageModel,
          onSession: (session) => this.trackSession(session)
        })
      ]);
      if (this._runId !== runId) return;

      const composition = compositionSettled.status === 'fulfilled'
        ? compositionSettled.value
        : fallbackComposition(intent);
      const rhythm = rhythmSettled.status === 'fulfilled'
        ? rhythmSettled.value
        : { shots: buildFallbackRhythm(intent.mood, intent.shotCount), source: 'fallback' };

      this.setStage('combine');
      const board = combineStoryboard(intent, composition, rhythm);
      this._latestFilmstripModel = board.filmstripModel;
      this.setPhase('result', {
        displayQuery: query,
        markdown: board.markdown,
        isStreaming: false,
        errorText: '',
        ask: '',
        filmstripFailed: false,
        filmstripCells: board.filmstripModel.cells,
        guidance: board.guidance
      });
      this.clearConversationState();
      this.renderFilmstrip(board.filmstripModel, runId);
    } catch (error) {
      console.error('Storyboard orchestration failed', error);
      if (this._runId === runId) {
        this.disposeSession();
        this.setPhase('error', { isStreaming: false, errorText: '出了点问题，请重试' });
      }
    }
  },

  async renderFilmstrip(model, runId) {
    const result = await drawFilmstrip(model, { wxImpl: wx });
    if (this._runId !== runId || this.data.phase !== 'result') return;
    if (!result.ok) {
      this.setData({ filmstripFailed: true });
    }
  },

  // 取消分析（analyzing 态点按钮）。
  cancelAgent() {
    this._runId = (this._runId || 0) + 1;
    this.disposeSession();
    this.setPhase('idle', { isStreaming: false });
  },

  trackSession(session) {
    if (!session) return () => {};
    if (!this._sessions) this._sessions = [];
    if (!this._sessions.includes(session)) {
      this._sessions.push(session);
    }
    return () => this.releaseSession(session);
  },

  releaseSession(session) {
    if (!this._sessions) return;
    this._sessions = this._sessions.filter((item) => item !== session);
  },

  disposeIntentSession() {
    const session = this._intentSession;
    this._intentSession = null;
    this.releaseSession(session);
    if (session && typeof session.destroy === 'function') {
      try {
        session.destroy();
      } catch (error) {
        console.error('intent session destroy failed', error);
      }
    }
  },

  clearConversationState() {
    this._intentInputs = [];
    this._clarifyCount = 0;
    this._isClarifyFollowup = false;
  },

  resetAgentState() {
    this._runId = (this._runId || 0) + 1;
    this.disposeSession();
    this.clearConversationState();
    this._latestFilmstripModel = null;
  },

  disposeRecognition() {
    if (this._recognition) {
      const recognition = this._recognition;
      this._recognition = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
    }
  },

  disposeSession() {
    const sessions = this._sessions || [];
    for (const session of sessions) {
      try {
        if (session && typeof session.destroy === 'function') session.destroy();
      } catch (error) {
        console.error('session.destroy() failed', error);
      }
    }
    this._sessions = [];
    this._intentSession = null;
    this.clearConversationState();
  },

  teardown() {
    if (this._recognition) {
      try {
        this._recognition.abort();
      } catch (error) {
        console.error('recognition.abort() failed', error);
      }
    }
    this.disposeRecognition();
    this.disposeSession();
  }
}
</script>

<page>
  <view class="app">
    <view class="card">
      <view class="card-header">
        <text class="status-dot status-{{phase}}"></text>
        <text class="status-text">{{statusText}}</text>
      </view>

      <scroll-view scroll-y class="body">
        <!-- idle：提示语（麦克风按钮在卡片外，全局共用） -->
        <view class="hint" ink:if="{{phase === 'idle'}}">
          <text class="hint-text">{{hintText}}</text>
        </view>

        <!-- listening：实时转写（状态点已在 header 体现聆听） -->
        <view class="query" ink:if="{{phase === 'listening'}}">
          <text class="query-label">聆听中</text>
          <text class="query-text">{{displayQuery}}</text>
        </view>

        <!-- clarifying：A1 追问 + 补充按钮 -->
        <view class="clarify" ink:if="{{phase === 'clarifying'}}">
          <streamdown class="ask" content="{{ask}}"></streamdown>
          <button class="ghost-btn" bindtap="onMicTap">补充说明</button>
        </view>

        <!-- analyzing：三段进度文案随 stage 变 -->
        <view class="analyzing" ink:if="{{phase === 'analyzing'}}">
          <view class="stage-row stage-{{stage === 'intent' ? 'active' : 'idle'}}">
            <text class="stage-dot"></text>
            <text class="stage-label">理解意图</text>
          </view>
          <view class="stage-row stage-{{stage === 'parallel' ? 'active' : 'idle'}}">
            <text class="stage-dot"></text>
            <text class="stage-label">并行：构图 + 剪辑节奏</text>
          </view>
          <view class="stage-row stage-{{stage === 'combine' ? 'active' : 'idle'}}">
            <text class="stage-dot"></text>
            <text class="stage-label">组合分镜</text>
          </view>
          <text class="stage-text" ink:if="{{stageText}}">{{stageText}}</text>
        </view>

        <!-- result：Markdown 卡片 + 横向胶片条 + 逐镜指引列表 -->
        <view class="result" ink:if="{{phase === 'result'}}">
          <streamdown class="markdown" content="{{markdown}}" streaming="{{isStreaming}}"></streamdown>

          <!-- 胶片条：单 canvas 放进横向 scroll-view -->
          <scroll-view scroll-x class="filmstrip-scroll" ink:if="{{filmstripFailed === false}}">
            <canvas id="filmstrip" class="filmstrip" canvas-id="filmstrip"></canvas>
          </scroll-view>
          <text class="filmstrip-fallback" ink:if="{{filmstripFailed}}">胶片条绘制不可用，已保留文字版分镜。</text>

          <!-- 逐镜指引列表 -->
          <view class="guidance" ink:if="{{guidance.length}}">
            <text class="guidance-title">分镜指引</text>
            <view class="guidance-item" ink:for="{{guidance}}" ink:key="index">
              <text class="guidance-text">{{item}}</text>
            </view>
          </view>
        </view>

        <!-- error：错误提示 + 重试（重试按钮即卡片外主按钮） -->
        <error-state ink:if="{{phase === 'error'}}" text="{{errorText}}"></error-state>
      </scroll-view>
    </view>

    <!-- 全局主按钮：idle 说话 / listening 停止 / analyzing 取消 / result 再拍一条 / error 重试 -->
    <button class="mic-btn mic-{{phase}}" bindtap="onMicTap">{{micLabel}}</button>
  </view>
</page>

<style>
.app {
  width: var(--app-width, 480px);
  min-height: var(--app-height-min, 120px);
  box-sizing: border-box;
  padding: var(--spacing-md, 12px);
  background-color: var(--color-background, #000000);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md, 12px);
}

.card {
  box-sizing: border-box;
  background-color: var(--color-surface, #0b0b0b);
  border: 2px solid var(--card-border-color, var(--color-primary, #40FF5E));
  border-radius: 12px;
  padding: var(--card-padding, 12px);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm, 8px);
}

.card-header {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 12px;
  background-color: var(--color-text-secondary, #888888);
}

.status-listening {
  background-color: var(--color-primary, #40FF5E);
}

.status-analyzing,
.status-clarifying {
  background-color: var(--color-secondary, #40FF5E);
}

.status-result {
  background-color: var(--color-primary, #40FF5E);
}

.status-error {
  background-color: var(--border-color-danger, #ff5555);
}

.status-text {
  color: var(--color-text-secondary, #aaaaaa);
  font-size: 14px;
  line-height: 18px;
}

.body {
  max-height: 320px;
}

/* idle 提示 */
.hint-text {
  color: var(--color-text-secondary, #888888);
  font-size: 14px;
  line-height: 20px;
}

/* listening 实时转写 */
.query {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.query-label {
  color: var(--color-primary, #40FF5E);
  font-size: 12px;
  line-height: 16px;
}

.query-text {
  color: var(--color-text-primary, #ffffff);
  font-size: 16px;
  line-height: 22px;
}

/* clarifying 追问 */
.clarify {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm, 8px);
}

.ask {
  color: var(--color-text-primary, #ffffff);
  font-size: 15px;
  line-height: 22px;
}

.ghost-btn {
  box-sizing: border-box;
  width: 100%;
  color: var(--color-primary, #40FF5E);
  background-color: transparent;
  border: 2px solid var(--color-primary, #40FF5E);
  border-radius: 12px;
  padding: 8px;
  text-align: center;
  font-size: 14px;
  line-height: 20px;
}

/* analyzing 进度 */
.analyzing {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm, 8px);
}

.stage-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

.stage-dot {
  width: 8px;
  height: 8px;
  border-radius: 12px;
  background-color: var(--color-text-secondary, #888888);
}

.stage-active .stage-dot {
  background-color: var(--color-primary, #40FF5E);
}

.stage-label {
  color: var(--color-text-secondary, #888888);
  font-size: 14px;
  line-height: 20px;
}

.stage-active .stage-label {
  color: var(--color-text-primary, #ffffff);
}

.stage-text {
  color: var(--color-primary, #40FF5E);
  font-size: 13px;
  line-height: 18px;
}

/* result 结果 */
.result {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md, 12px);
}

.markdown {
  color: var(--color-text-primary, #ffffff);
  font-size: 15px;
  line-height: 22px;
}

.filmstrip-scroll {
  width: 100%;
  white-space: nowrap;
}

.filmstrip {
  /* 固定最大 backing：6 镜上限 STRIP_W_MAX≈894 × STRIP_H_MAX≈190（架构设计 §4.1） */
  width: 894px;
  height: 190px;
}

.filmstrip-fallback {
  color: var(--color-text-secondary, #aaaaaa);
  font-size: 12px;
  line-height: 18px;
}

.guidance {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.guidance-title {
  color: var(--color-primary, #40FF5E);
  font-size: 12px;
  line-height: 16px;
}

.guidance-item {
  padding: 4px 0;
}

.guidance-text {
  color: var(--color-text-primary, #ffffff);
  font-size: 14px;
  line-height: 20px;
}

/* 主按钮 */
.mic-btn {
  box-sizing: border-box;
  width: 100%;
  color: var(--color-primary, #40FF5E);
  background-color: transparent;
  border: 2px solid var(--color-primary, #40FF5E);
  border-radius: 12px;
  padding: 10px;
  text-align: center;
  font-size: 16px;
  line-height: 22px;
}

.mic-listening {
  color: var(--color-background, #000000);
  background-color: var(--color-primary, #40FF5E);
}

.mic-error {
  color: var(--border-color-danger, #ff5555);
  border-color: var(--border-color-danger, #ff5555);
}
</style>
