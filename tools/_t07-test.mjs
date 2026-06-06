// T07 临时测试脚本（不进生产包；仅手动 node 实跑用）
// 覆盖 ≥10 个脏样本，验证：不抛异常、合法样本得对象、不可解析样本得 null。
import { rescueJSON, rescueJSONOr } from '../lib/json-rescue.js';

let pass = 0;
let fail = 0;

/**
 * @param {string} name
 * @param {*} input
 * @param {(r:any)=>boolean} check 返回 true 表示通过
 */
function t(name, input, check) {
  let result;
  let threw = false;
  try {
    result = rescueJSON(input);
  } catch (e) {
    threw = true;
    result = '__THREW__: ' + e;
  }
  const ok = !threw && check(result);
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}  => ${JSON.stringify(result)}`);
  }
}

const isObj = (r) => r !== null && typeof r === 'object' && !Array.isArray(r);
const isNull = (r) => r === null;

console.log('T07 json-rescue 脏样本测试\n');

// 1. 纯净 JSON
t('纯净 JSON', '{"ready":true,"shotCount":5}', (r) => isObj(r) && r.ready === true && r.shotCount === 5);

// 2. 带 ```json 围栏
t('```json 围栏', '```json\n{"mood":"epic","shots":[1,2,3]}\n```', (r) => isObj(r) && r.mood === 'epic' && r.shots.length === 3);

// 3. 裸 ``` 围栏（无 info 串）
t('``` 围栏(无 info)', '```\n{"a":1}\n```', (r) => isObj(r) && r.a === 1);

// 4. 前后有散文
t('前后散文', '好的，这是结果：\n{"title":"黄昏公路","shotCount":4}\n希望对你有帮助！', (r) => isObj(r) && r.shotCount === 4);

// 5. 尾逗号 ,} 和 ,]
t('尾逗号', '{"shots":[1,2,3,],"ready":true,}', (r) => isObj(r) && r.shots.length === 3 && r.ready === true);

// 6. 单引号
t('单引号', "{'mood':'calm','ask':'再说说？'}", (r) => isObj(r) && r.mood === 'calm' && r.ask === '再说说？');

// 7. 被截断（不平衡括号）→ null
t('被截断(不平衡)→null', '{"ready":true,"intent":{"subject":"女孩"', isNull);

// 8. 空串 → null
t('空串→null', '', isNull);

// 9. 嵌套对象
t('嵌套对象', '{"intent":{"subject":"女孩","scene":"公路","mood":"epic"},"ready":true}', (r) => isObj(r) && r.intent.scene === '公路' && r.ready === true);

// 10. 数组在内
t('数组在内', '{"templates":["T07","T02","T11"],"cameraUsed":["fixed","dolly"]}', (r) => isObj(r) && r.templates.length === 3 && r.cameraUsed[1] === 'dolly');

// 11. 含中文
t('含中文', '{"title":"独自旅行的女孩·黄昏出发","desc":"镜头缓慢前推{留白}"}', (r) => isObj(r) && r.title.includes('女孩') && r.desc.includes('{留白}'));

// 12. 全角引号
t('全角引号', '{“mood”：“epic”，“shotCount”：6}', (r) => isObj(r) && r.mood === 'epic' && r.shotCount === 6);

// 13. 字符串内含花括号与转义（栈匹配不应被骗）
t('字符串内花括号/转义', '{"a":"含 } 和 { 的字符串","b":"引号\\"内嵌\\"","c":1}', (r) => isObj(r) && r.a.includes('}') && r.b.includes('"') && r.c === 1);

// 14. 多个对象，只取第一个平衡的
t('取第一个平衡对象', '{"first":1} 噪声 {"second":2}', (r) => isObj(r) && r.first === 1 && r.second === undefined);

// 15. 完全不是 JSON（散文）→ null
t('纯散文→null', '我不知道你想拍什么，能再说说吗？', isNull);

// 16. 单引号 + 尾逗号 + 围栏混合
t('混合脏(围栏+单引号+尾逗号)', "```json\n{'shots':[{'duration':5,},{'duration':3,}],'ready':true,}\n```", (r) => isObj(r) && r.shots.length === 2 && r.shots[0].duration === 5);

// 17. 顶层是数组 → 应得数组对象（typeof object）
t('顶层数组(被{包裹场景外)', '{"list":[{"id":"T07"},{"id":"T02"}]}', (r) => isObj(r) && Array.isArray(r.list) && r.list[1].id === 'T02');

// 18. null 输入 → null（不抛）
t('null 输入→null', null, isNull);

// 19. 字符串内的单引号在双引号串里不被破坏
t('双引号串内含单引号', `{"ask":"it's fine","ok":true}`, (r) => isObj(r) && r.ask === "it's fine" && r.ok === true);

// 20. 单引号串内含双引号（需转义）
t('单引号串内含双引号', `{'quote':'她说"你好"'}`, (r) => isObj(r) && r.quote === '她说"你好"');

console.log('\n--- rescueJSONOr 便捷版 ---');
{
  const r1 = rescueJSONOr('不是 JSON', { ready: false });
  console.log(r1 && r1.ready === false ? '  PASS  fallback 生效' : '  FAIL  fallback');
  if (r1 && r1.ready === false) pass++; else fail++;

  const r2 = rescueJSONOr('{"ready":true}');
  console.log(r2 && r2.ready === true ? '  PASS  合法时返回解析对象' : '  FAIL  合法返回');
  if (r2 && r2.ready === true) pass++; else fail++;
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
