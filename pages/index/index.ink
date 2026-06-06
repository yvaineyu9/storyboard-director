<script def>
{
  "navigationBarTitleText": "分镜导演"
}
</script>

<script setup>
// T08：UI 状态机骨架 + 语音管线。
// 状态机壳 + SpeechRecognition 全生命周期已落地；真实 Agent 编排（A1→[A2‖A3]→A4）、
// Canvas 胶片条绘制、死模板库/词表均为 stub，留待后续任务（T13 Canvas / T14 Agent）。
//
// 注意（范围限制）：本文件刻意不 import lib 下尚未实现的 stub（vocab/agents/renderer）。
// 语言模型相关 import 也暂不引入（runAgent 留 mock）。

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

// 防御式地从识别结果事件里取最新转写文本与 final 标记。复用样例 extractTranscript。
function extractTranscript(event) {
  const results = event && event.results;
  if (!results || !results.length) {
    return { text: '', isFinal: false };
  }
  let text = '';
  let isFinal = false;
  const start = typeof event.resultIndex === 'number' ? event.resultIndex : 0;
  for (let i = start; i < results.length; i++) {
    const result = results[i];
    const alternative = result && result[0];
    if (alternative && alternative.transcript) {
      text += alternative.transcript;
    }
    if (result && result.isFinal) {
      isFinal = true;
    }
  }
  return { text: text.trim(), isFinal };
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
    ask: '',                   // A1 追问话术；T14 前用占位

    // —— result（结果）——
    markdown: '',              // <streamdown> 卡片内容；T14 前用 mock 转写占位
    isStreaming: false,
    filmstripCells: [],        // Canvas 胶片条数据占位（T13 才真正绘制）
    guidance: [],              // 逐镜指引列表占位

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
      const { text, isFinal } = extractTranscript(event);
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
        ask: '',
        markdown: '',
        errorText: '',
        isStreaming: false,
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
  // T14 前为 mock：不调真实 A1–A4，直接把转写塞进 result 占位展示。
  async runAgent(query) {
    // TODO(T14): 接入 A1→[A2‖A3]→A4 真实流水线。
    //   1) setPhase('analyzing') + setStage('intent')，调 A1 意图分析（含追问循环）。
    //      A1 ready=false → setPhase('clarifying', { ask })，按钮回 listening 回灌同一会话（≤2 轮）。
    //   2) ready=true → setStage('parallel')，Promise.allSettled([A2 构图, A3 节奏])。
    //   3) setStage('combine')，A4 纯 JS 组合 → board。
    //   4) setPhase('result', { markdown: buildMarkdown(board),
    //        filmstripCells: filmstripModel.cells, guidance: board.guidance })，
    //      并在 result 渲染帧后由 T13 渲染器绘制 <canvas id="filmstrip">。
    //   能力降级见架构设计 §6.2（LanguageModel.availability、单路失败回退等）。

    // —— 以下为 T08 mock 串通：idle↔listening↔(mock)result 走通即可 ——
    const mockMarkdown = [
      '## 分镜（占位）',
      '',
      '> 真实分镜流水线（A1→[A2‖A3]→A4）尚未接入（T14）。',
      '',
      '**你说的画面：**',
      '',
      query,
      '',
      '- 情绪基调：占位',
      '- 分镜数量：占位（3~6）',
      '- 模板编号：占位'
    ].join('\n');

    this.setPhase('result', {
      displayQuery: query,
      markdown: mockMarkdown,
      isStreaming: false,
      errorText: '',
      ask: '',
      // 占位胶片条数据（不绘制 Canvas，T13 才接渲染器）。
      filmstripCells: [
        { index: 1 },
        { index: 2 },
        { index: 3 }
      ],
      // 占位逐镜指引（T14 由 A4 buildGuidance 产出）。
      guidance: [
        '镜1 · 指引占位：景别/构图/运镜/时长/转场（T14 接入）',
        '镜2 · 指引占位：景别/构图/运镜/时长/转场（T14 接入）',
        '镜3 · 指引占位：景别/构图/运镜/时长/转场（T14 接入）'
      ]
    });

    // TODO(T13): 切到 result 态、节点挂载后调用胶片条渲染器
    //   wx.createCanvasContext('filmstrip') → drawFilmstrip(filmstripModel)（两色写死 #000/#40FF5E）。
  },

  // 取消分析（analyzing 态点按钮）。T14 接入后需 destroy 在途会话。
  cancelAgent() {
    // TODO(T14): destroy 在途的 A1/A2/A3 LanguageModel 会话。
    this.disposeSession();
    this.setPhase('idle', { isStreaming: false });
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
    // TODO(T14): 真实接入后，遍历销毁 A1/A2/A3 会话实例。
    if (this._session) {
      try {
        this._session.destroy();
      } catch (error) {
        console.error('session.destroy() failed', error);
      }
      this._session = null;
    }
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

        <!-- clarifying：A1 追问 + 补充按钮（ask 占位，T14 接入真实话术） -->
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

          <!-- 胶片条：单 canvas 放进横向 scroll-view（T13 才真正绘制） -->
          <scroll-view scroll-x class="filmstrip-scroll">
            <canvas id="filmstrip" class="filmstrip" canvas-id="filmstrip"></canvas>
          </scroll-view>

          <!-- 逐镜指引列表（占位数据） -->
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
  /* 固定最大 backing：6 镜上限 ≈ 894×180（架构设计 §4.1）；T13 才绘制 */
  width: 894px;
  height: 180px;
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
