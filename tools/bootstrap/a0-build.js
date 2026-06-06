/**
 * T04 · A0 离线构建脚本。
 *
 * 本环境不调用真实 LLM。这里使用按 a0-generate.md 约束手写的 24 条模板
 * 元数据，再通过 lib/figure.js 烘焙出可绘制 figure，输出同构中间 JSON。
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildFigureForCaption } from '../../lib/figure.js';

export const INTERMEDIATE_LIBRARY_URL = new URL('./storyboard-library.generated.json', import.meta.url);
export const INTERMEDIATE_LIBRARY_PATH = fileURLToPath(INTERMEDIATE_LIBRARY_URL);

export const TEMPLATE_METADATA = [
  {
    caption: { composition: 'center', shotSize: 'medium', camera: 'fixed' },
    decisionHint: '需要把注意力锁在核心主体、产品或片头符号时选用；中心块和十字线让画面稳定、庄重、易识别',
    sceneFit: { moods: ['premium', 'calm'], scenes: ['产品特写', '静物', '片头'] }
  },
  {
    caption: { composition: 'center', shotSize: 'closeup', camera: 'zoom' },
    decisionHint: '需要快速压向关键道具、眼神或危险线索时选用；变焦把观众注意力拉到唯一焦点',
    sceneFit: { moods: ['tense', 'premium', 'energetic'], scenes: ['关键道具', '表情', '线索揭示'] }
  },
  {
    caption: { composition: 'thirds', shotSize: 'medium', camera: 'fixed' },
    decisionHint: '人物口播、采访或 Vlog 自述首选；三分偏置给主体留出视线空间和呼吸感',
    sceneFit: { moods: ['warm', 'calm', 'joyful'], scenes: ['人物口播', 'Vlog', '采访'] }
  },
  {
    caption: { composition: 'thirds', shotSize: 'closeup', camera: 'handheld' },
    decisionHint: '需要保留人物真实情绪和轻微不稳定感时选用；偏置近景适合独白、回忆、脆弱时刻',
    sceneFit: { moods: ['melancholy', 'warm'], scenes: ['独白', '树下', '自述'] }
  },
  {
    caption: { composition: 'symmetry', shotSize: 'wide', camera: 'crane' },
    decisionHint: '建立宏大环境、秩序感或仪式感时选用；对称地平线配合摇臂能提供开场气势',
    sceneFit: { moods: ['epic', 'calm', 'premium'], scenes: ['雪山', '建筑', '湖面'] }
  },
  {
    caption: { composition: 'symmetry', shotSize: 'full', camera: 'aerial' },
    decisionHint: '需要从高处交代空间格局与人群/建筑关系时选用；对称结构能稳定复杂环境',
    sceneFit: { moods: ['epic', 'calm'], scenes: ['风光', '城市', '广场'] }
  },
  {
    caption: { composition: 'vast', shotSize: 'wide', camera: 'aerial' },
    decisionHint: '表达渺小、孤独或史诗留白时选用；大面积空底和角落小主体能把人物压进环境',
    sceneFit: { moods: ['melancholy', 'epic', 'calm'], scenes: ['山野', '桥边', '荒原'] }
  },
  {
    caption: { composition: 'vast', shotSize: 'full', camera: 'fixed' },
    decisionHint: '需要段落停顿、等待或空旷压迫感时选用；固定机位让留白成为叙事压力',
    sceneFit: { moods: ['melancholy', 'tense'], scenes: ['空旷空间', '崖边', '等待'] }
  },
  {
    caption: { composition: 'frame', shotSize: 'medium', camera: 'fixed' },
    decisionHint: '居家、门框、窗边等有天然前景时选用；框景增加层次，并让主体像被观察',
    sceneFit: { moods: ['warm', 'premium', 'melancholy'], scenes: ['居家', '门框', '窗边'] }
  },
  {
    caption: { composition: 'frame', shotSize: 'closeup', camera: 'dolly' },
    decisionHint: '需要窥视、靠近秘密或镜面反射时选用；前景框架配合前推能制造电影感压迫',
    sceneFit: { moods: ['tense', 'premium'], scenes: ['窥视', '门缝', '镜面'] }
  },
  {
    caption: { composition: 'leading', shotSize: 'wide', camera: 'dolly' },
    decisionHint: '公路、走廊、通道类画面首选；汇聚线把视线推向远端主体，表达出发和纵深',
    sceneFit: { moods: ['epic', 'energetic', 'calm'], scenes: ['公路', '走廊', '通道'] }
  },
  {
    caption: { composition: 'leading', shotSize: 'medium', camera: 'pov' },
    decisionHint: '第一人称穿越狭窄路径或危险通道时选用；POV 与灭点线强化代入和方向感',
    sceneFit: { moods: ['tense', 'energetic', 'epic'], scenes: ['枕木桥', '巷道', '行进中'] }
  },
  {
    caption: { composition: 'lowangle', shotSize: 'medium', camera: 'handheld' },
    decisionHint: '需要主角感、对抗感或临场压力时选用；低角度和手持让主体压住画面下半区',
    sceneFit: { moods: ['tense', 'energetic'], scenes: ['追逐', '自拍', '对抗'] }
  },
  {
    caption: { composition: 'lowangle', shotSize: 'full', camera: 'crane' },
    decisionHint: '主角登场、舞台或高大建筑仰视时选用；低角度配合升降带来力量和仪式感',
    sceneFit: { moods: ['epic', 'premium'], scenes: ['主角登场', '舞台', '建筑'] }
  },
  {
    caption: { composition: 'topdown', shotSize: 'macro', camera: 'fixed' },
    decisionHint: '开箱、咖啡注液、手作步骤等流程展示首选；顶视让桌面关系清晰、质感稳定',
    sceneFit: { moods: ['premium', 'warm'], scenes: ['开箱', '咖啡', '料理'] }
  },
  {
    caption: { composition: 'topdown', shotSize: 'closeup', camera: 'dolly' },
    decisionHint: '需要从桌面流程推进到结果物时选用；前推让观众进入物品细节和手部动作',
    sceneFit: { moods: ['premium', 'joyful'], scenes: ['手作', '桌面流程', '礼物'] }
  },
  {
    caption: { composition: 'silhouette', shotSize: 'wide', camera: 'track' },
    decisionHint: '黄昏逆光、奔跑或看台侧影时选用；剪影让情绪先于细节出现，跟拍保留运动',
    sceneFit: { moods: ['melancholy', 'warm', 'calm'], scenes: ['逆光奔跑', '看台', '黄昏'] }
  },
  {
    caption: { composition: 'silhouette', shotSize: 'full', camera: 'handheld' },
    decisionHint: '街头、演出或冲突瞬间需要强烈图底反差时选用；手持让剪影动作更直接',
    sceneFit: { moods: ['energetic', 'tense'], scenes: ['演出', '对抗', '街头'] }
  },
  {
    caption: { composition: 'shallow', shotSize: 'closeup', camera: 'fixed' },
    decisionHint: '生活流 b-roll、手部细节或道具情绪特写首选；浅景深让背景退后、温度前置',
    sceneFit: { moods: ['warm', 'calm', 'premium'], scenes: ['手部细节', 'Vlog', '道具'] }
  },
  {
    caption: { composition: 'shallow', shotSize: 'macro', camera: 'dolly' },
    decisionHint: '产品质感、开箱细节或材质展示时选用；微距浅景深配合前推能突出触感',
    sceneFit: { moods: ['premium', 'warm'], scenes: ['产品', '开箱', '细节'] }
  },
  {
    caption: { composition: 'center', shotSize: 'macro', camera: 'fixed' },
    decisionHint: '需要把核心物、徽章、机械部件或危险细节钉在画面中心时选用；大特写减少干扰',
    sceneFit: { moods: ['premium', 'tense'], scenes: ['心脏', '徽章', '核心物'] }
  },
  {
    caption: { composition: 'thirds', shotSize: 'full', camera: 'pan' },
    decisionHint: '旅行、街头或集体互动需要从主体带到环境时选用；摇镜让偏置主体自然展开空间',
    sceneFit: { moods: ['joyful', 'warm', 'energetic'], scenes: ['旅行Vlog', '街头', '集体互动'] }
  },
  {
    caption: { composition: 'leading', shotSize: 'full', camera: 'track' },
    decisionHint: '运动、骑行或穿越场景需要连续方向感时选用；跟拍沿引导线推进，保持节奏冲刺',
    sceneFit: { moods: ['energetic', 'joyful'], scenes: ['运动', '骑行', '穿越'] }
  },
  {
    caption: { composition: 'frame', shotSize: 'wide', camera: 'crane' },
    decisionHint: '大厅、舞台、遗迹等大空间需要框出主角与环境关系时选用；摇臂让框景更有开场感',
    sceneFit: { moods: ['epic', 'melancholy', 'premium'], scenes: ['舞台', '大厅', '遗迹'] }
  }
];

function templateId(index) {
  return `T${String(index + 1).padStart(2, '0')}`;
}

function cloneCaption(caption) {
  return {
    composition: caption.composition,
    shotSize: caption.shotSize,
    camera: caption.camera
  };
}

function cloneSceneFit(sceneFit) {
  return {
    moods: [...sceneFit.moods],
    scenes: [...sceneFit.scenes]
  };
}

export function buildStoryboardLibrary(metadata = TEMPLATE_METADATA) {
  return {
    schemaVersion: 1,
    generatedBy: 'A0-bootstrap-handwritten-v1',
    palette: { bg: '#000', fg: '#40FF5E' },
    templates: metadata.map((template, index) => {
      const caption = cloneCaption(template.caption);
      return {
        id: templateId(index),
        figure: buildFigureForCaption(caption),
        caption,
        decisionHint: template.decisionHint,
        sceneFit: cloneSceneFit(template.sceneFit)
      };
    })
  };
}

export function stableStringify(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function writeIntermediateLibrary(outputPath = INTERMEDIATE_LIBRARY_PATH) {
  const library = buildStoryboardLibrary();
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, stableStringify(library), 'utf8');
  return { outputPath, library };
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';

if (import.meta.url === invokedPath) {
  const { outputPath, library } = await writeIntermediateLibrary();
  console.log(`A0 intermediate library written: ${outputPath}`);
  console.log(`templates: ${library.templates.length}`);
}
