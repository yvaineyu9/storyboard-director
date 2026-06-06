// T04/T05 · 死模板库静态模块。
// 生产运行时只 import 本模块，不读写 JSON，不生成或改写模板。

function subjectBox(x, y, w, h, fill = false) {
  return { kind: 'rect', x, y, w, h, fill };
}

function horizon(y) {
  return { kind: 'line', x1: 0.05, y1: y, x2: 0.95, y2: y };
}

export const STORYBOARD_LIBRARY = {
  schemaVersion: '1.0.0',
  palette: { bg: '#000000', fg: '#40FF5E' },
  templates: [
    {
      id: 'T01',
      caption: { shotSize: 'wide', composition: 'symmetry', camera: 'fixed' },
      decisionHint: '先用稳定远景交代空间关系，适合建立段落。',
      sceneFit: { moods: ['calm', 'warm', 'premium'], scenes: ['室内', '街道', '展厅', '日常'] },
      figure: { viewBox: [1, 1], primitives: [horizon(0.56), subjectBox(0.45, 0.42, 0.10, 0.20), { kind: 'line', x1: 0.50, y1: 0.16, x2: 0.50, y2: 0.86 }] }
    },
    {
      id: 'T02',
      caption: { shotSize: 'wide', composition: 'leading', camera: 'dolly' },
      decisionHint: '用引导线把视线推向主体，适合出发、抵达、进入。',
      sceneFit: { moods: ['epic', 'melancholy', 'energetic'], scenes: ['公路', '走廊', '桥', '街道'] },
      figure: { viewBox: [1, 1], primitives: [horizon(0.44), { kind: 'line', x1: 0.12, y1: 0.90, x2: 0.52, y2: 0.44 }, { kind: 'line', x1: 0.88, y1: 0.90, x2: 0.52, y2: 0.44 }, subjectBox(0.49, 0.40, 0.06, 0.13)] }
    },
    {
      id: 'T03',
      caption: { shotSize: 'full', composition: 'thirds', camera: 'track' },
      decisionHint: '主体落三分位并跟随运动，适合人物行动和产品使用。',
      sceneFit: { moods: ['joyful', 'energetic', 'warm'], scenes: ['街道', '运动', '户外', '店铺'] },
      figure: { viewBox: [1, 1], primitives: [{ kind: 'line', x1: 0.33, y1: 0.08, x2: 0.33, y2: 0.92 }, { kind: 'line', x1: 0.66, y1: 0.08, x2: 0.66, y2: 0.92 }, { kind: 'line', x1: 0.08, y1: 0.36, x2: 0.92, y2: 0.36 }, subjectBox(0.28, 0.42, 0.13, 0.30)] }
    },
    {
      id: 'T04',
      caption: { shotSize: 'medium', composition: 'center', camera: 'fixed' },
      decisionHint: '中心构图直接交代主体，适合作为信息明确的主镜头。',
      sceneFit: { moods: ['premium', 'calm', 'warm'], scenes: ['产品', '人物', '室内', '采访'] },
      figure: { viewBox: [1, 1], primitives: [{ kind: 'line', x1: 0.50, y1: 0.10, x2: 0.50, y2: 0.90 }, { kind: 'line', x1: 0.10, y1: 0.50, x2: 0.90, y2: 0.50 }, subjectBox(0.38, 0.30, 0.24, 0.40)] }
    },
    {
      id: 'T05',
      caption: { shotSize: 'medium', composition: 'frame', camera: 'pan' },
      decisionHint: '用前景框架包住主体，再横摇展示环境。',
      sceneFit: { moods: ['melancholy', 'premium', 'tense'], scenes: ['窗边', '门口', '店铺', '室内'] },
      figure: { viewBox: [1, 1], primitives: [{ kind: 'rect', x: 0.10, y: 0.12, w: 0.80, h: 0.76, fill: false }, { kind: 'rect', x: 0.17, y: 0.20, w: 0.66, h: 0.60, fill: false }, subjectBox(0.43, 0.36, 0.16, 0.32)] }
    },
    {
      id: 'T06',
      caption: { shotSize: 'closeup', composition: 'shallow', camera: 'fixed' },
      decisionHint: '浅景深近景聚焦细节，适合质感、表情、手部动作。',
      sceneFit: { moods: ['warm', 'premium', 'melancholy'], scenes: ['产品', '手部', '表情', '餐桌'] },
      figure: { viewBox: [1, 1], primitives: [{ kind: 'circle', cx: 0.50, cy: 0.50, r: 0.28, fill: false }, subjectBox(0.30, 0.26, 0.40, 0.48), { kind: 'line', x1: 0.08, y1: 0.18, x2: 0.24, y2: 0.18 }, { kind: 'line', x1: 0.76, y1: 0.82, x2: 0.92, y2: 0.82 }] }
    },
    {
      id: 'T07',
      caption: { shotSize: 'macro', composition: 'center', camera: 'zoom' },
      decisionHint: '大特写强调一个关键物件或表情变化。',
      sceneFit: { moods: ['tense', 'premium', 'warm'], scenes: ['产品', '眼神', '按钮', '细节'] },
      figure: { viewBox: [1, 1], primitives: [{ kind: 'circle', cx: 0.50, cy: 0.50, r: 0.36, fill: false }, subjectBox(0.18, 0.18, 0.64, 0.64)] }
    },
    {
      id: 'T08',
      caption: { shotSize: 'wide', composition: 'vast', camera: 'aerial' },
      decisionHint: '高空远景让主体显小，适合孤独、壮阔或规模感。',
      sceneFit: { moods: ['epic', 'melancholy', 'calm'], scenes: ['山野', '海边', '城市', '公路'] },
      figure: { viewBox: [1, 1], primitives: [horizon(0.34), { kind: 'polyline', points: [{ x: 0.08, y: 0.72 }, { x: 0.32, y: 0.58 }, { x: 0.55, y: 0.70 }, { x: 0.92, y: 0.48 }] }, subjectBox(0.75, 0.70, 0.04, 0.07, true)] }
    },
    {
      id: 'T09',
      caption: { shotSize: 'full', composition: 'lowangle', camera: 'tilt' },
      decisionHint: '低角度仰拍强化力量与压迫，适合英雄感或紧张对峙。',
      sceneFit: { moods: ['epic', 'tense', 'energetic'], scenes: ['人物', '建筑', '舞台', '运动'] },
      figure: { viewBox: [1, 1], primitives: [{ kind: 'line', x1: 0.16, y1: 0.90, x2: 0.50, y2: 0.24 }, { kind: 'line', x1: 0.84, y1: 0.90, x2: 0.50, y2: 0.24 }, subjectBox(0.38, 0.32, 0.24, 0.48)] }
    },
    {
      id: 'T10',
      caption: { shotSize: 'wide', composition: 'topdown', camera: 'crane' },
      decisionHint: '俯拍顶视梳理路径和群体关系，适合转场或段落总结。',
      sceneFit: { moods: ['calm', 'premium', 'epic'], scenes: ['餐桌', '街区', '房间', '队形'] },
      figure: { viewBox: [1, 1], primitives: [{ kind: 'circle', cx: 0.50, cy: 0.50, r: 0.34, fill: false }, subjectBox(0.46, 0.46, 0.08, 0.08, true), { kind: 'rect', x: 0.18, y: 0.22, w: 0.18, h: 0.15, fill: false }, { kind: 'rect', x: 0.64, y: 0.63, w: 0.18, h: 0.15, fill: false }] }
    },
    {
      id: 'T11',
      caption: { shotSize: 'medium', composition: 'silhouette', camera: 'fixed' },
      decisionHint: '逆光剪影减少细节，突出轮廓和情绪。',
      sceneFit: { moods: ['melancholy', 'epic', 'tense'], scenes: ['黄昏', '窗边', '舞台', '门口'] },
      figure: { viewBox: [1, 1], primitives: [horizon(0.48), { kind: 'circle', cx: 0.80, cy: 0.25, r: 0.10, fill: false }, subjectBox(0.32, 0.38, 0.18, 0.42, true)] }
    },
    {
      id: 'T12',
      caption: { shotSize: 'full', composition: 'bisect', camera: 'handheld' },
      decisionHint: '二分构图制造选择或对照，手持增加临场感。',
      sceneFit: { moods: ['tense', 'melancholy', 'energetic'], scenes: ['对峙', '街道', '室内', '后台'] },
      figure: { viewBox: [1, 1], primitives: [{ kind: 'line', x1: 0.50, y1: 0.08, x2: 0.50, y2: 0.92 }, subjectBox(0.22, 0.36, 0.16, 0.34), subjectBox(0.62, 0.36, 0.16, 0.34)] }
    },
    {
      id: 'T13',
      caption: { shotSize: 'wide', composition: 'thirds', camera: 'pan' },
      decisionHint: '横摇扫过三分位主体，适合展示空间变化。',
      sceneFit: { moods: ['joyful', 'calm', 'warm'], scenes: ['旅行', '店铺', '展台', '自然'] },
      figure: { viewBox: [1, 1], primitives: [horizon(0.40), { kind: 'line', x1: 0.33, y1: 0.08, x2: 0.33, y2: 0.92 }, { kind: 'line', x1: 0.66, y1: 0.08, x2: 0.66, y2: 0.92 }, subjectBox(0.62, 0.46, 0.12, 0.25)] }
    },
    {
      id: 'T14',
      caption: { shotSize: 'medium', composition: 'leading', camera: 'pov' },
      decisionHint: '主观视角沿线索前进，适合沉浸式探索。',
      sceneFit: { moods: ['tense', 'energetic', 'joyful'], scenes: ['走廊', '街道', '运动', '探索'] },
      figure: { viewBox: [1, 1], primitives: [horizon(0.46), { kind: 'line', x1: 0.20, y1: 0.92, x2: 0.50, y2: 0.46 }, { kind: 'line', x1: 0.80, y1: 0.92, x2: 0.50, y2: 0.46 }, { kind: 'circle', cx: 0.50, cy: 0.76, r: 0.08, fill: false }] }
    },
    {
      id: 'T15',
      caption: { shotSize: 'closeup', composition: 'thirds', camera: 'handheld' },
      decisionHint: '近景三分位配轻微手持，适合真实的人物反应。',
      sceneFit: { moods: ['warm', 'tense', 'melancholy'], scenes: ['人物', '采访', '街头', '后台'] },
      figure: { viewBox: [1, 1], primitives: [{ kind: 'line', x1: 0.33, y1: 0.08, x2: 0.33, y2: 0.92 }, subjectBox(0.25, 0.22, 0.34, 0.56), { kind: 'circle', cx: 0.42, cy: 0.38, r: 0.11, fill: false }] }
    },
    {
      id: 'T16',
      caption: { shotSize: 'wide', composition: 'frame', camera: 'crane' },
      decisionHint: '从框景内升起，逐步揭示更大的场面。',
      sceneFit: { moods: ['epic', 'premium', 'warm'], scenes: ['建筑', '门口', '舞台', '展厅'] },
      figure: { viewBox: [1, 1], primitives: [{ kind: 'rect', x: 0.08, y: 0.12, w: 0.84, h: 0.76, fill: false }, horizon(0.55), subjectBox(0.46, 0.44, 0.10, 0.22)] }
    },
    {
      id: 'T17',
      caption: { shotSize: 'medium', composition: 'topdown', camera: 'fixed' },
      decisionHint: '顶视静物排列，适合产品拆解、流程和选择。',
      sceneFit: { moods: ['premium', 'calm', 'joyful'], scenes: ['产品', '桌面', '菜单', '手作'] },
      figure: { viewBox: [1, 1], primitives: [{ kind: 'rect', x: 0.18, y: 0.18, w: 0.64, h: 0.64, fill: false }, subjectBox(0.38, 0.38, 0.24, 0.24), { kind: 'circle', cx: 0.26, cy: 0.72, r: 0.06, fill: false }] }
    },
    {
      id: 'T18',
      caption: { shotSize: 'full', composition: 'shallow', camera: 'dolly' },
      decisionHint: '从环境推到主体，让背景逐步虚化，适合情绪落点。',
      sceneFit: { moods: ['warm', 'melancholy', 'premium'], scenes: ['人物', '餐厅', '房间', '夜景'] },
      figure: { viewBox: [1, 1], primitives: [{ kind: 'circle', cx: 0.50, cy: 0.52, r: 0.30, fill: false }, subjectBox(0.40, 0.30, 0.20, 0.44), { kind: 'line', x1: 0.12, y1: 0.22, x2: 0.26, y2: 0.22 }, { kind: 'line', x1: 0.74, y1: 0.78, x2: 0.88, y2: 0.78 }] }
    }
  ]
};

export default STORYBOARD_LIBRARY;
