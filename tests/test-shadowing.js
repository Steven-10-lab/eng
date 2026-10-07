/* shadowing 纯状态/纯函数回归测试：node test-shadowing.js */
'use strict';
const C = require('../source/shadowing.js');
let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        got=' + g + '\n        want=' + w); }
}

console.log('# version');
eq('VERSION exposed', typeof C.VERSION === 'string' && C.VERSION.length > 0, true);

console.log('# two-gesture state machine (nextPhase)');
eq('idle --startDemo--> demo', C.nextPhase('idle', 'startDemo'), 'demo');
eq('idle --other--> idle', C.nextPhase('idle', 'startRec'), 'idle');
eq('demo --startRec--> recognizing', C.nextPhase('demo', 'startRec'), 'recognizing');
eq('demo --cancelDemo--> idle', C.nextPhase('demo', 'cancelDemo'), 'idle');
eq('demo --leave--> idle', C.nextPhase('demo', 'leave'), 'idle');
eq('recognizing --result--> processing', C.nextPhase('recognizing', 'result'), 'processing');
eq('recognizing --manualStop--> processing', C.nextPhase('recognizing', 'manualStop'), 'processing');
eq('recognizing --timeout--> processing', C.nextPhase('recognizing', 'timeout'), 'processing');
eq('recognizing --leave--> idle', C.nextPhase('recognizing', 'leave'), 'idle');
eq('processing --settle--> idle', C.nextPhase('processing', 'settle'), 'idle');
eq('processing --leave--> idle', C.nextPhase('processing', 'leave'), 'idle');

console.log('# settleDecision (grace/force/onend 统一收口)');
eq('settle has text -> score', C.settleDecision({settled:false,leaving:false}, 'the cat'), 'score');
eq('settle empty text -> noresult', C.settleDecision({settled:false,leaving:false}, ''), 'noresult');
eq('settle already settled -> ignore', C.settleDecision({settled:true,leaving:false}, 'x'), 'ignore');
eq('settle leaving -> ignore', C.settleDecision({settled:false,leaving:true}, 'x'), 'ignore');

console.log('# decideResult 保持');
eq('decide score', C.decideResult({settled:false,leaving:false}, 'hi'), 'score');
eq('decide empty -> noresult', C.decideResult({settled:false,leaving:false}, ''), 'noresult');

console.log('# hard timeout window [10s,15s]');
[0,1,3,10,20,40].forEach(w => {
  const ms = C.recLimitMsFor(w);
  if (ms < 10000 || ms > 15000) fail++;
});
eq('recLimit small sentence = 10000', C.recLimitMsFor(3), 10000);
eq('recLimit big sentence = 15000', C.recLimitMsFor(40), 15000);

console.log('# WER 口径回归 (alignWords)');
eq('perfect score=100', C.scoreSentence('The cat sat on the mat', 'The cat sat on the mat'), 100);
eq('one wrong word (1/3 err -> 67)', C.scoreSentence('the cat sat', 'the dog sat'), 67); // 1 S of N=3
{
  const r = C.alignWords('the cat sat', 'the dog sat');
  console.log('       (the cat sat vs the dog sat: score=' + r.score + ' correct=' + r.correct + ' wrong=' + r.wrong + ' missing=' + r.missing + ' extra=' + r.extra + ')');
}
eq('extra word penalty (+1 extra of 2 -> 50)', C.scoreSentence('good morning', 'good morning everybody'), 50); // 1 I of N=2
eq('missing word penalty (-1 missing of 3 -> 67)', C.scoreSentence('good morning friend', 'good morning'), 67); // 1 D of N=3
eq('empty hyp -> 0', C.scoreSentence('hello world', ''), 0);
{
  const r = C.alignWords("Don't stop", "dont stop");
  eq('apostrophe-normalize equal (100)', r.score, 100);
}

console.log('# scorePassage 各句等权平均');
eq('sentence avg ((100+50)/2=75)', C.scorePassage([100, 50], ['a b c', 'd']), 75);
{
  const p = C.scorePassage([100, 50], ['a b c', 'd']);
  console.log('       sentence-average [100, 50] = ' + p);
}

/* =========================================================
 * P0 resultMap 修复回归：完整复刻 "In a field…"
 * interim 逐步扩展 → final 完整句
 * ========================================================= */
const basePass = pass, baseFail = fail;
console.log('\n# P0 resultMap: reduceOnResult 按 index 替换，不追加');

// 构造一个浏览器 onresult 事件：results[i] = [alt]，带 .isFinal
function ev(list) {
  return {
    resultIndex: 0,
    results: list.map(function (r) {
      var res = [{ transcript: r.t }];
      res.isFinal = !!r.f;
      return res;
    })
  };
}
const REF = 'In a field, an ant worked hard all summer.';

// 1) interim 逐步扩展（都在 index 0，interim），最后 final 一次性完整句
{
  const map = {};
  const snapshots = [
    'In ', 'In a ', 'In a field ', 'In a field an ', 'In a field an ant ',
    'In a field an ant worked ', 'In a field an ant worked hard ',
    'In a field an ant worked hard all ', 'In a field an ant worked hard all summer '
  ];
  let prevLen = 0, accumulates = false;
  snapshots.forEach(function (s) {
    C.reduceOnResult(map, ev([{ t: s, f: false }]));
    const built = C.buildSessionTranscript(map);
    // interim 应是「最后一张快照」，绝不把上一段累加上来
    if (built.interimText.indexOf(s.trim()) === -1) accumulates = true;
    if (built.interimText.split(/\s+/).length > s.trim().split(/\s+/).length) accumulates = true;
    prevLen = built.interimText.length;
  });
  eq('interim 逐步扩展=替换而非累加', accumulates, false);

  // final：同一 index 0 变为完整 final 句
  C.reduceOnResult(map, ev([{ t: 'In a field, an ant worked hard all summer. ', f: true }]));
  const built = C.buildSessionTranscript(map);
  eq('final 候选=完整句(一次)', built.finalsText, REF);
  eq('interim 已被 final 取代=空', built.interimText, '');

  const res = C.alignWords(REF, built.finalsText);
  eq('完整句 score=100', res.score, 100);
  eq('完整句 多词=0', res.extra, 0);
  eq('完整句 候选词数=9', res.hypWords, 9);

  // 2) 重复 final 回调幂等：再发一次相同 final，候选不追加
  C.reduceOnResult(map, ev([{ t: 'In a field, an ant worked hard all summer. ', f: true }]));
  const built2 = C.buildSessionTranscript(map);
  const res2 = C.alignWords(REF, built2.finalsText);
  eq('重复 final 不追加：候选仍=完整句', built2.finalsText, REF);
  eq('重复 final 不追加：多词仍=0', res2.extra, 0);
  eq('重复 final 不追加：词数仍=9', res2.hypWords, 9);
}

// 3) 手动停止、无 final：只用最后一张 interim 快照（一次）
{
  const map = {};
  C.reduceOnResult(map, ev([{ t: 'In a field an ', f: false }]));
  C.reduceOnResult(map, ev([{ t: 'In a field an ant worked ', f: false }]));
  const built = C.buildSessionTranscript(map);
  eq('无 final 时 finalsText=空', built.finalsText, '');
  eq('手动 stop 只用最后 interim 快照', built.interimText, 'In a field an ant worked');
  // 结算文本 = final 优先，否则 interim；这里应等于最后 interim，且无前缀串联
  const text = (built.finalsText || built.interimText);
  // 上一段 interim 为 "In a field an"(4词)，最后快照为 6 词；
  // 若错误累加应为 4+6=10。这里必须等于最后快照 6 词，无前缀串联。
  eq('手动 stop 候选词数=6（最后快照，无前缀累加）', C.normalizeText(text).length, 6);
}

// 4) 会话间不串：新会话 resultMap 清空
{
  const map = {};
  C.reduceOnResult(map, ev([{ t: 'leftover ', f: true }]));
  const fresh = {}; // 新 attempt
  const built = C.buildSessionTranscript(fresh);
  eq('新会话 resultMap 空→finals/interim 均空', built.finalsText + '|' + built.interimText, '|');
}

// 5) 合法重复词保留（不被判异常、不被粗暴 Set 去重）
{
  const repRef = 'I saw that that was really true';
  const repHyp = 'I saw that that was really true';
  const w = C.normalizeText(repHyp);
  const abn = C.isAbnormalRecognition(w, C.normalizeText(repRef).length);
  eq('合法重复词(that that)不判异常', abn.abnormal, false);
  eq('合法重复词保留→score=100', C.scoreSentence(repRef, repHyp), 100);
}

// 6) 异常串联判无分：连续重复片段
{
  const loopHyp = 'in a field and in a field and in a field and';
  const w = C.normalizeText(loopHyp);
  const abn = C.isAbnormalRecognition(w, C.normalizeText(REF).length);
  eq('连续重复片段→异常', abn.abnormal, true);
  eq('重复片段原因=loop', abn.reason, 'loop');
}

// 7) 异常串联判无分：词数 > 标准 2 倍
{
  // 标准 9 词，构造 20 个不构成重复块的词
  const longHyp = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu xi omicron pi rho sigma tau upsilon phi';
  const w = C.normalizeText(longHyp);
  const abn = C.isAbnormalRecognition(w, C.normalizeText(REF).length);
  eq('词数>2x 标准→异常', abn.abnormal, true);
  eq('超长原因=oversize', abn.reason, 'oversize');
}

// 8) 边界：正常长度内不判 oversize
{
  const w = C.normalizeText('in a field an ant');
  eq('正常长度不判异常', C.isAbnormalRecognition(w, 9).abnormal, false);
}

const newPass = pass - basePass, newFail = fail - baseFail;
console.log('\n-- P0 resultMap 回归：新增 ' + newPass + ' 通过, ' + newFail + ' 失败 --');

console.log('\n== ' + pass + ' passed, ' + fail + ' failed ==');
console.log('   (既有 27 项 + 新增 ' + newPass + ' 项)');
process.exit(fail ? 1 : 0);
