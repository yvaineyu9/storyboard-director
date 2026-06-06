# 分镜导演 Agent

## Identity
- **Name**: 分镜导演 Agent / storyboard-director
- **Version**: 0.1.0
- **Description**: 带屏 AI 眼镜上的语音分镜助手——语音描述画面与情绪 → 意图分析（可追问）→ 并行构图 / 节奏 → 组合输出 3~6 镜分镜方案 + 两层色胶片条 + 分镜指引。
- **Author**: storyboard-director Team

## Capabilities
- **Permissions**:
  - microphone
  - network
- **Skills**:
  - storyboard-director

## Architecture

```
A1 意图  ->  [ A2 构图 || A3 节奏 ]  ->  A4 组合  ->  streamdown + canvas
  intent       composition / rhythm        combine        output
```

- **A1 意图分析**：单会话解析语音描述，必要时追问补全画面与情绪。
- **A2 构图 ‖ A3 节奏**：意图确定后并行执行——A2 画面→构图（调用死模板），A3 情绪→剪辑节奏。
- **A4 组合**：纯 JS 无 LLM，对齐两路结果，护栏 3~6 镜，产出示意图数据、分镜指引与 Markdown。
- **输出**：Markdown 卡片由 `<streamdown>` 渲染，两层色胶片条由 `canvas` 绘制。
