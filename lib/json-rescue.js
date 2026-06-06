// T07 · 稳健 JSON 解析 json-rescue.js
// 端侧 LanguageModel 无结构化 tool-call（架构 OQ-4），Agent 全靠文本→JSON。
// 本模块提供稳健解析管线（架构 §6.1）：剥代码围栏 → 栈匹配截取首个平衡 {…}
// → JSON.parse，失败则尝试常见修复（去尾逗号 / 单引号→双引号 / 全角引号→半角）
// → 仍失败返回 null。全程绝不抛异常。

/**
 * 去除 ```json / ``` 代码围栏与首尾噪声/散文。
 * 仅做轻量清洗；真正的边界判定交给栈匹配（extractBalancedObject）。
 * @param {string} text
 * @returns {string}
 */
function stripFences(text) {
  let s = String(text);
  // 去 BOM
  s = s.replace(/^﻿/, '');
  // 优先抠出第一段 ```...``` 围栏内部内容（兼容 ```json / ```JSON / ``` 等）。
  // 用非贪婪匹配，捕获围栏内文本；info 串（如 json）紧跟在起始 ``` 后同一行。
  const fenceMatch = s.match(/```[^\n`]*\r?\n([\s\S]*?)```/);
  if (fenceMatch) {
    s = fenceMatch[1];
  } else {
    // 没有成对围栏时，直接抹掉散落的 ``` 标记（含可能的 info 串）。
    s = s.replace(/```[^\n`]*/g, '');
  }
  return s.trim();
}

/**
 * 用栈匹配截取**第一个平衡**的 `{ … }` 子串。
 * 正确处理字符串内的花括号与转义（字符串内的 { } 不计入栈）。
 * @param {string} text
 * @returns {string|null} 平衡子串，或在找不到/不平衡时返回 null
 */
function extractBalancedObject(text) {
  const s = String(text);
  const start = s.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let quote = '';   // 当前字符串使用的引号字符（" 或 '）
  let escaped = false;

  for (let i = start; i < s.length; i++) {
    const ch = s[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        inString = false;
      }
      continue;
    }

    // 不在字符串中
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      continue;
    }
    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return s.slice(start, i + 1);
      }
    }
  }

  // 遍历结束仍未闭合 → 被截断/不平衡
  return null;
}

/**
 * 去除尾逗号：`,}` / `,]`（含其间的空白/换行）。
 * 注意：仅在字符串外才生效，避免破坏字符串内容。
 * @param {string} text
 * @returns {string}
 */
function removeTrailingCommas(text) {
  const s = String(text);
  let out = '';
  let inString = false;
  let quote = '';
  let escaped = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        inString = false;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      out += ch;
      continue;
    }

    if (ch === ',') {
      // 向前看：跳过空白后若是 } 或 ]，则丢弃这个逗号
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j++;
      if (j < s.length && (s[j] === '}' || s[j] === ']')) {
        continue; // 丢弃尾逗号
      }
    }
    out += ch;
  }
  return out;
}

/**
 * 全角引号/标点 → 半角，便于后续解析。
 * 仅替换会破坏 JSON 结构的全角符号；不动字符串语义内容中的中文文字。
 * 全角双引号 “ ” → "，全角单引号 ‘ ’ → '，全角冒号/逗号 ： ， → : ,
 * @param {string} text
 * @returns {string}
 */
function normalizeFullWidth(text) {
  return String(text)
    .replace(/[“”〝〞＂]/g, '"') // “ ” 〝 〞 ＂ → "
    .replace(/[‘’＇]/g, "'")             // ‘ ’ ＇ → '
    .replace(/：/g, ':')                           // ： → :
    .replace(/，/g, ',');                          // ， → ,
}

/**
 * 单引号字符串 → 双引号字符串。
 * 逐字符扫描：在结构层把单引号包裹的字符串改写为合法 JSON 双引号字符串，
 * 同时转义其内部出现的双引号、保留已有的双引号字符串原样（不破坏其内部的单引号）。
 * @param {string} text
 * @returns {string}
 */
function singleToDoubleQuotes(text) {
  const s = String(text);
  let out = '';
  let i = 0;

  while (i < s.length) {
    const ch = s[i];

    // 已是双引号字符串：原样拷贝，跳过其内部（处理转义），内部单引号不动
    if (ch === '"') {
      out += ch;
      i++;
      while (i < s.length) {
        const c = s[i];
        out += c;
        if (c === '\\') {
          // 把转义对一起拷过去
          if (i + 1 < s.length) {
            out += s[i + 1];
            i += 2;
            continue;
          }
        }
        i++;
        if (c === '"') break;
      }
      continue;
    }

    // 单引号字符串：改写为双引号
    if (ch === "'") {
      out += '"';
      i++;
      while (i < s.length) {
        const c = s[i];
        if (c === '\\') {
          // 保留转义对（如 \' → 输出 ' ；\" / \\ 等原样）
          const nxt = i + 1 < s.length ? s[i + 1] : '';
          if (nxt === "'") {
            out += "'";          // \' 在双引号串里无需转义
          } else {
            out += '\\' + nxt;   // 其余转义对原样保留
          }
          i += 2;
          continue;
        }
        if (c === '"') {
          out += '\\"';          // 内部裸双引号需转义
          i++;
          continue;
        }
        if (c === "'") {
          out += '"';            // 结束单引号 → 双引号
          i++;
          break;
        }
        out += c;
        i++;
      }
      continue;
    }

    out += ch;
    i++;
  }
  return out;
}

/**
 * 主函数：稳健解析 LLM 文本输出为 JS 对象。
 * 管线（架构 §6.1）：
 *   1. 剥 ```json / ``` 代码围栏与首尾噪声/散文 + 全角引号→半角
 *   2. 栈匹配截取第一个平衡的 { … } 子串（处理字符串内花括号与转义）
 *   3. JSON.parse；失败则依次尝试常见修复（去尾逗号、单引号→双引号）
 *   4. 仍失败 → 返回 null（绝不抛异常）
 * @param {string} text LLM 原始文本
 * @returns {object|null} 解析得到的对象，或 null
 */
export function rescueJSON(text) {
  if (text == null) return null;
  if (typeof text !== 'string') {
    // 已是对象/数组：直接放行（容忍上游已解析的情况）
    if (typeof text === 'object') return text;
    return null;
  }

  let candidate;
  try {
    const cleaned = normalizeFullWidth(stripFences(text));
    candidate = extractBalancedObject(cleaned);
  } catch (_) {
    return null;
  }

  if (candidate == null) return null;

  // 依次尝试：原样 → 去尾逗号 → 单引号转双引号 → 二者叠加
  const attempts = [
    (s) => s,
    (s) => removeTrailingCommas(s),
    (s) => singleToDoubleQuotes(s),
    (s) => removeTrailingCommas(singleToDoubleQuotes(s)),
  ];

  for (const fix of attempts) {
    try {
      const parsed = JSON.parse(fix(candidate));
      // 只接受对象（含数组）；标量解析结果视为无效，继续尝试
      if (parsed !== null && typeof parsed === 'object') {
        return parsed;
      }
    } catch (_) {
      // 忽略，尝试下一种修复
    }
  }

  return null;
}

/**
 * 便捷版：解析失败时返回给定默认值（而非 null）。
 * @template T
 * @param {string} text
 * @param {T} [fallback=null]
 * @returns {object|T}
 */
export function rescueJSONOr(text, fallback = null) {
  const result = rescueJSON(text);
  return result == null ? fallback : result;
}

export default rescueJSON;
