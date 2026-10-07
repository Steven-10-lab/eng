#!/usr/bin/env node
/* P0 跟读反馈精简 —— DOM/视图回归（纯 Node，无浏览器依赖）
 * 覆盖：全对 / 1错1漏1多 / 连续重复问题合并 ×N / 不铺正确词 /
 *       详情与历史默认折叠 / 异常文案 / 儿童文案无术语外泄。
 *
 * 运行：node test-shadowing-dom.cjs
 * 说明：feedbackView/buildProblemList 为 shadowing.js core 导出的纯函数；
 *       DOM 层断言通过对 shadowing.js 源码的静态检查完成（与 test-p0-update.cjs 同风格）。
 */
'use strict';

const fs = require('fs');
const path = require('path');

let C;
try {
  C = require('../source/shadowing.js');
} catch (e) {
  console.error('✗ 无法加载 shadowing.js：' + e.message);
  process.exit(1);
}

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.error('  ✗ ' + name); }
}
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.error('  ✗ ' + name + '\n        got=' + g + '\n        want=' + w); }
}

const src = fs.readFileSync(path.join(__dirname, '..', 'source', 'shadowing.js'), 'utf8');

/* ============ 1. 纯函数存在性 ============ */
console.log('\n[1] 反馈纯函数已导出');
ok('buildProblemList 是函数', typeof C.buildProblemList === 'function');
ok('feedbackView 是函数', typeof C.feedbackView === 'function');

if (typeof C.feedbackView !== 'function' || typeof C.buildProblemList !== 'function') {
  console.error('\n（feedbackView/buildProblemList 未导出，先落 JS 补丁再跑本测试）');
  console.log('\n== ' + pass + ' 通过, ' + fail + ' 失败 ==');
  process.exit(1);
}

/* ============ 2. 全对：无问题、无详情、只一句式 ============ */
console.log('\n[2] 全对句子');
{
  const ref = 'In a field, an ant worked hard all summer.';
  const res = C.alignWords(ref, ref);
  res.hyp = ref;
  const v = C.feedbackView(res, ref);
  eq('score=100', v.score, 100);
  eq('allGood=true', v.allGood, true);
  eq('problems 为空', v.problems, []);
  eq('计数 错/漏/多 均为 0',
    { w: v.counts.wrong, m: v.counts.missing, x: v.counts.extra },
    { w: 0, m: 0, x: 0 });
  ok('原句为纯文本（无 HTML 标签）', !/<[a-z]/.test(v.plainSentence));
}

/* ============ 3. 1错1漏1多 ============ */
console.log('\n[3] 错词 / 漏词 / 多词 三类问题 chip');
{
  // 错词：cat→dog（正确 5，错 1）
  const rw = C.alignWords('the cat sat on the mat', 'the dog sat on the mat');
  rw.hyp = 'the dog sat on the mat';
  const vw = C.feedbackView(rw, 'The cat sat on the mat.');
  eq('错词 allGood=false', vw.allGood, false);
  eq('错词计数 wrong=1', vw.counts.wrong, 1);
  eq('错词 chip 目标 cat → 识别 dog',
    vw.problems.map(p => ({ type: p.type, target: p.target, heard: p.heard, count: p.count })),
    [{ type: 'wrong', target: 'cat', heard: 'dog', count: 1 }]);

  // 漏词：friend 没读出来（正确 2，漏 1）
  const rm = C.alignWords('good morning friend', 'good morning');
  rm.hyp = 'good morning';
  const vm = C.feedbackView(rm, 'Good morning friend.');
  eq('漏词 chip 目标 friend',
    vm.problems.map(p => ({ type: p.type, target: p.target, count: p.count })),
    [{ type: 'missing', target: 'friend', count: 1 }]);

  // 多词：多读了 everybody（正确 2，多 1）
  const rx = C.alignWords('good morning', 'good morning everybody');
  rx.hyp = 'good morning everybody';
  const vx = C.feedbackView(rx, 'Good morning.');
  eq('多词 chip 多读 everybody',
    vx.problems.map(p => ({ type: p.type, heard: p.heard, count: p.count })),
    [{ type: 'extra', heard: 'everybody', count: 1 }]);
}

/* ============ 4. 连续相同问题合并 ×N ============ */
console.log('\n[4] 连续重复问题合并');
{
  // 连续多读 and and and → 合并为 1 条 count=3
  const res = C.alignWords('good morning', 'good morning and and and');
  res.hyp = 'good morning and and and';
  const v = C.feedbackView(res, 'Good morning.');
  eq('多读 and 合并为 1 条', v.problems.filter(p => p.type === 'extra').length, 1);
  const x = v.problems.find(p => p.type === 'extra');
  eq('合并后 count=3', { heard: x.heard, count: x.count }, { heard: 'and', count: 3 });

  // 连续错词合并：cat cat sat → dog dog sat（两个相邻 cat→dog 替换）
  const res2 = C.alignWords('cat cat sat', 'dog dog sat');
  res2.hyp = 'dog dog sat';
  const v2 = C.feedbackView(res2, 'Cat cat sat.');
  const w2 = v2.problems.filter(p => p.type === 'wrong');
  eq('连续错词 cat→dog 合并为 1 条 count=2',
    w2.map(p => ({ target: p.target, heard: p.heard, count: p.count })),
    [{ target: 'cat', heard: 'dog', count: 2 }]);
  eq('sat 正确 → 无漏/多', v2.counts.missing + v2.counts.extra, 0);
}

/* ============ 5. 不铺正确词 ============ */
console.log('\n[5] 原文只显示一次、不逐个铺正确词');
{
  const res = C.alignWords('the cat sat on the mat', 'the dog sat on mat and');
  res.hyp = 'the dog sat on mat and';
  const v = C.feedbackView(res, 'The cat sat on the mat.');
  ok('plainSentence 不含 span/div（无逐词铺色）',
    !/<(span|div|b|i)\b/.test(v.plainSentence));
  ok('plainSentence 等于原始句字符串', v.plainSentence === 'The cat sat on the mat.');
  // 源码：句子容器用 textContent 写原句，不再逐词 createElement 铺 ops
  ok('源码渲染原句用 textContent（不铺正确词 span）',
    /box\.textContent\s*=\s*s/.test(src) &&
    !/cur\.ops\.forEach[\s\S]{0,120}createElement\('span'\)/.test(src));
}

/* ============ 6. 详情 / 历史默认折叠 ============ */
console.log('\n[6] 详情与历史默认折叠');
ok('详情 details 无默认 open（源码）',
  !/<details[^>]*data-ref="detail"[^>]*\bopen\b/.test(src) &&
  !/data-ref="detail"[^>]*\bopen\b/.test(src));
ok('历史容器默认带 hidden（源码）', src.includes('sh-history hidden'));
ok('切换历史按钮存在', src.includes('data-act="toggle-history"'));
// 运行时：feedbackView 不提供任何 open 标记
{
  const res = C.alignWords('a b', 'a');
  res.hyp = 'a';
  const v = C.feedbackView(res, 'A b.');
  ok('视图模型不包含 open 字段（默认关闭详情）', !('open' in v));
}

/* ============ 7. 异常状态文案 ============ */
console.log('\n[7] 异常状态儿童文案');
ok('源码包含「识别结果异常，请重试，本次不计分」',
  src.includes('识别结果异常，请重试，本次不计分'));
ok('全对提示「本句内容完整准确，可以进入下一句」',
  src.includes('本句内容完整准确，可以进入下一句'));

/* ============ 8. 儿童文案：无 WER/hyp/ref 术语外泄 ============ */
console.log('\n[8] 儿童文案不含术语');
// 只检查 _renderAll 里实际盖到 DOM 的反馈模板（fb.innerHTML 块），
// 不检查 _buildDom 的 data-ref 内部属性（那不是儿童可见文案）。
const fbTpl = (src.match(/fb\.innerHTML\s*=\s*([\s\S]*?)sh-countline/) || ['',''])[1];
ok('反馈模板不出现 WER', !/WER/.test(fbTpl));
ok('反馈模板不出现 hyp/ref 变量名', !/\b(hyp|ref)\b/.test(fbTpl));
ok('计数行用「对/错/漏/多」中文', /对 <b>/.test(src) && /错 <b>/.test(src) && /漏 <b>/.test(src) && /多 <b>/.test(src));
ok('问题 chip 用儿童词「错词/漏词/多读」',
  src.includes('错词「') && src.includes('漏词「') && src.includes('多读「'));
ok('不向儿童显示「按单词对比，不评判发音/音素」长括注',
  !src.includes('按单词对比，不评判发音/音素'));

/* ============ 汇总 ============ */
console.log('\n========================================');
console.log('结果：' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
