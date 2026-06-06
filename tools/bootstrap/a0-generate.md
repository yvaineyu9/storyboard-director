# A0 死模板库生成 Prompt

你是「分镜导演 Agent」的 A0 离线引导器。你的任务是生成一组固定死模板元数据，供后续脚本烘焙为 `lib/storyboard-library.js` 静态模块。生产运行时不会调用你，也不会修改模板。

## 输入依据

### 模块A：10 种构图

1. `center` 中心构图：主层实心块居中 + 十字线。适合聚焦、庄重、质感。
2. `thirds` 三分偏置：三分细线 + 交点处主体块。适合人物、对话、呼吸。
3. `symmetry` 对称地平线：水平地平线 + 左右对称分布。适合壮阔、秩序。
4. `vast` 极远景渺小主体：大面积留白 + 角落极小主体点。适合孤独、渺小、史诗。
5. `frame` 前景框架：一圈内凹框形，中间留空放主体。适合层次、窥视、电影感。
6. `leading` 引导线灭点：两条向中心汇聚的斜线 + 远端小主体。适合出发、纵深、代入。
7. `lowangle` 低角度仰拍：主体块占下半大面积 + 低地平线/微仰。适合力量、紧张、主角感。
8. `topdown` 俯拍顶视：居中桌面矩形 + 内部主体块，四周留边。适合展示、流程、质感。
9. `silhouette` 侧面逆光剪影：实心人形 vs 空底 + 低地平线。适合情绪、唯美、抒情。
10. `shallow` 浅景深特写：主体清晰填充，背景留空表示虚化。适合细节、温度、生活流。

### 受控词表

- `shotSize`: `wide` 远景、`full` 全景、`medium` 中景、`closeup` 近景、`extreme` 特写、`macro` 大特写。
- `camera`: `fixed` 固定、`pan` 摇镜、`tilt` 俯仰、`dolly` 移镜(推/拉)、`track` 跟拍、`crane` 摇臂、`handheld` 手持、`zoom` 变焦、`aerial` 航拍、`pov` POV主观。
- `composition`: `center`、`thirds`、`bisect`、`symmetry`、`vast`、`frame`、`leading`、`lowangle`、`topdown`、`silhouette`、`shallow`。
- `mood`: `calm` 平静治愈、`warm` 温暖、`melancholy` 忧郁、`tense` 紧张、`epic` 史诗壮阔、`joyful` 欢快、`premium` 高级质感、`energetic` 动感。

### PRD §5：T1-T8 风格原型

1. T1 电影感公路/旅行：航拍/摇臂建立 -> POV 行车 -> 风光快切卡点 -> 极远景渺小 -> 留白收。
2. T2 生活流散文 Vlog：浅景深 b-roll -> 长镜口播/自拍 -> 前景框架 -> 道具首尾呼应。
3. T3 情绪独白/人物特写：环境远景 -> 中景 -> 情绪近景/特写；长镜 + 留白。
4. T4 能量蒙太奇卡点快切：静音留白蓄势 -> 快切卡 drop -> 逆光慢镜跳切。
5. T5 产品/开箱质感：大特写固定 -> 镜头前推 -> 顶视俯拍 -> 浅景深细节。
6. T6 第一人称 POV 沉浸：POV 主观 + 低角度 + 跟拍 + 手持抖动。
7. T7 叙事对话/双人：环境建立 -> 过肩正反打 -> 插入细节 -> 反应快切。
8. T8 喜剧字幕梗调味：字幕梗 + 快切 + 伪采访 + 片尾花絮。

## 输出要求

生成 18-24 条模板元数据。每条必须包含且只包含以下 3 个元数据字段，编号和 `figure` 由离线脚本补齐：

```json
{
  "caption": {
    "composition": "leading",
    "shotSize": "wide",
    "camera": "dolly"
  },
  "decisionHint": "表达出发、纵深、代入感；公路/通道/走廊类画面首选，用汇聚线把视线引向远端主体",
  "sceneFit": {
    "moods": ["epic", "calm"],
    "scenes": ["公路", "走廊", "行进中"]
  }
}
```

硬约束：

- `caption.composition` / `caption.shotSize` / `caption.camera` 只能使用上方受控词表 id。
- `sceneFit.moods` 必须至少 1 个，且只能使用上方 mood id。
- `sceneFit.scenes` 必须至少 1 个，使用短中文场景词，不要写长句。
- 每个 mood 至少覆盖 3 条模板。
- 覆盖模块A 10 种构图；`bisect` 可作为补充，但不要替代模块A 10 构图。
- `decisionHint` 要给 A2 做选择判断：写「什么时候选」「解决什么画面问题」，不要写诗化文案。
- 只输出 JSON 数组，不要 markdown 代码围栏，不要解释。
