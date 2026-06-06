/**
 * T02 · 受控词表 vocab.js — 单一词表真相（PRD §10 为唯一真相）。
 *
 * 本模块是 A0、A1、A2、A3、A4、渲染器、Markdown 的**单一词表真相**：
 * 所有 LLM 输出只能吐这里的 id，不得发明新值。
 *
 * 仅复用 ~/AIUI/samples/voice-agent/lib/storyboard-templates.js 的
 * **函数 / 结构形态**（SHOT_SIZES/CAMERA_MOVES/COMPOSITIONS/TRANSITIONS/MOODS
 * 的对象结构 + pick/listVocab 写法）承载；**取值全部按 PRD §10 重建**。
 */

// ---------------------------------------------------------------------------
// 1. 受控词表（取值 = PRD §10）
// ---------------------------------------------------------------------------

// 景别 shotSize（6 个）。scale = 主体块大小（0~1 升序），供 figure / renderer 用。
// 远景 / 全景 / 中景 / 近景 / 特写 / 大特写
export const SHOT_SIZES = {
  wide:    { label: '远景',   scale: 0.16 },
  full:    { label: '全景',   scale: 0.30 },
  medium:  { label: '中景',   scale: 0.48 },
  closeup: { label: '近景',   scale: 0.66 },
  extreme: { label: '特写',   scale: 0.86 },
  macro:   { label: '大特写', scale: 1.00 }
};

// 镜头调度语言 camera（10 个）。arrow 供渲染器画运动标注。
// 固定 / 摇镜 / 俯仰 / 移镜(推/拉) / 跟拍 / 摇臂 / 手持 / 变焦 / 航拍 / POV主观
export const CAMERA_MOVES = {
  fixed:    { label: '固定',      arrow: 'none',     desc: '机位锁定，画面稳定，强调构图与主体' },
  pan:      { label: '摇镜',      arrow: 'pan',      desc: '机身不动、镜头水平转动，展开空间' },
  tilt:     { label: '俯仰',      arrow: 'tilt',     desc: '镜头垂直俯仰，揭示高度或上下关系' },
  dolly:    { label: '移镜(推/拉)', arrow: 'dolly',   desc: '机身推近/拉远，制造纵深与靠近感' },
  track:    { label: '跟拍',      arrow: 'track',    desc: '跟随主体运动，主体始终在框内' },
  crane:    { label: '摇臂',      arrow: 'crane',    desc: '升降摇臂大幅运动，营造气势与上帝视角' },
  handheld: { label: '手持',      arrow: 'handheld', desc: '轻微晃动，纪实、临场或紧张感' },
  zoom:     { label: '变焦',      arrow: 'zoom',     desc: '焦段变化，快速聚焦或拉远情绪' },
  aerial:   { label: '航拍',      arrow: 'aerial',   desc: '高空俯瞰大幅平移，建立壮阔环境与上帝视角' },
  pov:      { label: 'POV主观',   arrow: 'pov',      desc: '第一人称主观视角，强代入与沉浸' }
};

// 构图法则 composition（11 个，对齐 PRD §10 + 模块A 10 种构图）。
// focus = 主体归一化默认位置（0~1，由构图决定）；overlay = 短 id（供 T03 figure / T13 渲染器 keying）。
// 中心 / 三分 / 二分 / 对称地平线 / 极远景渺小主体 / 前景框架 / 引导线灭点 /
// 低角度仰拍 / 俯拍顶视 / 侧面逆光剪影 / 浅景深特写
export const COMPOSITIONS = {
  center:     { label: '中心',         focus: { x: 0.50, y: 0.50 }, overlay: 'cross'      },
  thirds:     { label: '三分',         focus: { x: 0.34, y: 0.36 }, overlay: 'thirds'     },
  bisect:     { label: '二分',         focus: { x: 0.50, y: 0.50 }, overlay: 'bisect'     },
  symmetry:   { label: '对称/地平线',   focus: { x: 0.50, y: 0.55 }, overlay: 'horizon'    },
  vast:       { label: '极远景渺小主体', focus: { x: 0.78, y: 0.74 }, overlay: 'speck'      },
  frame:      { label: '前景框架',      focus: { x: 0.50, y: 0.50 }, overlay: 'frame'      },
  leading:    { label: '引导线/灭点',   focus: { x: 0.52, y: 0.44 }, overlay: 'leading'    },
  lowangle:   { label: '低角度仰拍',    focus: { x: 0.50, y: 0.66 }, overlay: 'lowangle'   },
  topdown:    { label: '俯拍顶视',      focus: { x: 0.50, y: 0.50 }, overlay: 'topdown'    },
  silhouette: { label: '侧面逆光剪影',  focus: { x: 0.40, y: 0.58 }, overlay: 'silhouette' },
  shallow:    { label: '浅景深特写',    focus: { x: 0.50, y: 0.50 }, overlay: 'shallow'    }
};

// 转场 / 剪辑 transition（8 个）。
// 硬切 / 叠化 / 淡入淡出 / 匹配剪辑 / 甩切 / 卡点快切 / J切 / L切
export const TRANSITIONS = {
  cut:      { label: '硬切',     desc: '直接切换，节奏利落' },
  dissolve: { label: '叠化',     desc: '两镜重叠溶解，柔和过渡时间/情绪' },
  fade:     { label: '淡入淡出', desc: '黑场进出，段落起止' },
  match:    { label: '匹配剪辑', desc: '形状/动作相似处衔接，顺滑连贯' },
  whip:     { label: '甩切',     desc: '快速甩动模糊衔接，强动感' },
  beatcut:  { label: '卡点快切', desc: '踩节拍点的高频快切，强节奏与爆发' },
  jcut:     { label: 'J切',      desc: '下一镜声音先进入，预告' },
  lcut:     { label: 'L切',      desc: '上一镜声音延留，情绪延续' }
};

// 情绪基调 mood（8 个，已剔除样例多出的 dreamy/梦幻）。
// 平静治愈 / 温暖 / 忧郁 / 紧张 / 史诗壮阔 / 欢快 / 高级质感 / 动感
export const MOODS = {
  calm:       { label: '平静治愈' },
  warm:       { label: '温暖' },
  melancholy: { label: '忧郁' },
  tense:      { label: '紧张' },
  epic:       { label: '史诗壮阔' },
  joyful:     { label: '欢快' },
  premium:    { label: '高级质感' },
  energetic:  { label: '动感' }
};

// ---------------------------------------------------------------------------
// 2. 工具函数
// ---------------------------------------------------------------------------

/**
 * 从词表 map 取一项，缺失或非法 id 回退到 fallback。
 * 返回 { id, ...项 }，便于直接取 label / scale / arrow 等。
 */
export function pick(map, id, fallback) {
  if (id && Object.prototype.hasOwnProperty.call(map, id)) return { id, ...map[id] };
  return { id: fallback, ...map[fallback] };
}

/** 把一张词表拼成 `id(label)、id(label)…` 的中文短串，供 prompt 注入。 */
export function listVocab(map) {
  return Object.keys(map)
    .map((id) => `${id}(${map[id].label})`)
    .join('、');
}

/**
 * 把全部受控词表拼成可注入 system prompt 的中文文本块，
 * 列出各 id + label，供 A1–A4 约束取值（只能吐下列 id，不得发明新值）。
 */
export function buildVocabContext() {
  return [
    '【受控词表 · 输出只能使用下列 id，不得发明新值或新增中文标签】',
    `景别 shotSize（6）：${listVocab(SHOT_SIZES)}`,
    `镜头调度 camera（10）：${listVocab(CAMERA_MOVES)}`,
    `构图 composition（11）：${listVocab(COMPOSITIONS)}`,
    `转场 transition（8）：${listVocab(TRANSITIONS)}`,
    `情绪 mood（8）：${listVocab(MOODS)}`
  ].join('\n');
}
