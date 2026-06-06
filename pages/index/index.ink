<script def>
{
  "navigationBarTitleText": "分镜导演"
}
</script>

<script setup>
// 脚手架空壳（T01）：仅「待命」卡片。
// 状态机 / 语音管线 / Agent 编排 / Canvas 渲染均留给后续任务（T08+）。
export default {
  data: {
    hintText: '语音描述你想拍的画面与情绪'
  },

  onMicTap() {
    // TODO(T08): 接入语音识别与状态机，进入意图分析编排。
  }
}
</script>

<page>
  <view class="app">
    <view class="card">
      <view class="card-body">
        <text class="hint-text">{{hintText}}</text>
      </view>
      <button class="mic-btn" bindtap="onMicTap">说话</button>
    </view>
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
  gap: var(--spacing-md, 12px);
}

.card-body {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm, 8px);
}

.hint-text {
  color: var(--color-text-secondary, #888888);
  font-size: 14px;
  line-height: 20px;
}

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
</style>
