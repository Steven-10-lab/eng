/* =========================================================
 * shadowing.js — 逐句跟读评分独立模块
 * 纯原生 JS，零外部依赖。
 * 浏览器：Shadowing.mount(container, options) 动态渲染 UI
 * Node  ：module.exports 导出全部纯函数，可直接测试
 * 存储 ：独立 localStorage 命名空间 eng30_shadowing_v1，
 *        绝不读写 eng30_state_v1
 *
 * 主按钮状态机：idle → demo(示范) → recognizing(跟读) → processing → idle
 *  - demo 中点同一按钮 = 停止示范：取消 TTS，绝不启动识别；
 *  - recognizing 中点同一按钮 = 停止跟读：recognition.stop()（graceful，
 *    可能 flush 出 final），只有切句/离开/重读才 abort()；
 *  - final transcript 只判分一次；onresult 后 stop，onend 兜底；
 *  - 无结果不计分；识别最长时限 = clamp(句长估时, 8s, 15s)；
 *  - Web Speech 不可用或失败时保存录音并标记待重试，不提供手动自评；
 *  - 历史按 day 分组，每天最近 20 次；整篇完成自动算总分，
 *    保存按钮一次成；重做后可再保存一次新 attempt。
 * ========================================================= */
(function (global) {
  'use strict';

  /* 版本标识：发布时同步 +1。用于核对线上静态响应是否为最新代码。 */
  var VERSION = '2.2.0-p0-resultmap';

  /* ================= 纯函数核心（Node 可测） ================= */

  // 常见句点缩写（点号不算句末边界）
  var ABBREV = {
    mr: 1, mrs: 1, ms: 1, dr: 1, prof: 1, sr: 1, jr: 1, st: 1,
    vs: 1, etc: 1, eg: 1, ie: 1, inc: 1, ltd: 1, gov: 1, no: 1,
    a: 1, b: 1, c: 1, d: 1, e: 1, f: 1, g: 1, h: 1, i: 1, j: 1,
    k: 1, l: 1, m: 1, n: 1, o: 1, p: 1, q: 1, r: 1, s: 1, t: 1,
    u: 1, v: 1, w: 1, x: 1, y: 1, z: 1
  };

  /**
   * 科学切句：按 . ! ? 切句，但
   *  - 缩写点号（Mr. / Dr. / U.S.）不切；
   *  - 句末标点后若紧跟引号+小写（对话归属语 "…," he said.）不切；
   *  - 句末标点后是大写字母或新开引号才切。
   */
  function splitSentences(text) {
    if (!text || typeof text !== 'string') return [];
    var n = text.length;
    var out = [];
    var start = 0;
    var depth = 0; // 引号嵌套深度：引号内部的句号不切句
    for (var i = 0; i < n; i++) {
      var ch = text[i];
      if (ch === '\u201C') depth++;
      else if (ch === '\u201D') { if (depth > 0) depth--; }
      else if (ch === '"') depth = depth ? 0 : 1;
      if (ch !== '.' && ch !== '!' && ch !== '?') continue;

      // 缩写判定：点号前的连续字母词
      var j = i - 1;
      while (j >= 0 && /[A-Za-z]/.test(text[j])) j--;
      var word = text.slice(j + 1, i).toLowerCase();
      if (word && ABBREV[word]) continue;

      // 跳过句末后的右引号再跳过空白；同时计算紧跟其后收尾引号数，
      // 用来推导「句末后是否已在引号外」（主循环尚未扫到这些引号，depth 是滞后值）
      var closeCount = 0;
      var k = i + 1;
      while (k < n && (text[k] === '"' || text[k] === '\u201D')) { closeCount++; k++; }
      while (k < n && /\s/.test(text[k])) k++;

      var end = i + 1;
      if (text[end] === '"' || text[end] === '\u201D') end++;

      if (k >= n) {
        out.push(text.slice(start, end).trim());
        start = n;
        break;
      }
      var next = text[k];
      var effDepth = Math.max(0, depth - closeCount);
      // 新句开始：大写字母，或新开引号；且句末后已在引号外
      var startsNew = (next === '"' || next === '\u201C' || /[A-Z]/.test(next));
      if (startsNew && effDepth === 0) {
        out.push(text.slice(start, end).trim());
        start = k;
        // 注意：不再手动 depth++，循环后续扫到该引号时自然翻转
      }
      // 否则是 "...," he said. 或引号内句点，不切
    }
    if (start < n) {
      var tail = text.slice(start).trim();
      if (tail) out.push(tail);
    }
    return out.filter(Boolean);
  }

  // 弯引号/弯撇号 → 直引号
  function fixQuotes(s) {
    return String(s)
      .replace(/[\u2018\u2019\u02BC\u0060]/g, "'")
      .replace(/[\u201C\u201D]/g, '"');
  }

  // ASR 常见变体等价表（归一化后做单词映射）
  var WORD_ALIAS = {
    ok: 'okay', okeh: 'okay', okey: 'okay',
    thru: 'through', altho: 'although', tho: 'though',
    cuz: 'because', ya: 'you', wanna: 'want',
    gimme: 'give', gotta: 'got'
  };

  /**
   * 单词归一化：
   *  - 大小写无关
   *  - 弯/直撇号统一并去除（don't == dont == dont）
   *  - 去掉所有其他标点（逗号/引号/连字符…）
   *  - 常见 ASR 缩写/口语变体等价
   */
  function normalizeWord(w) {
    if (w == null) return '';
    var s = fixQuotes(w).toLowerCase();
    s = s.replace(/'/g, '');            // 撇号全部去掉
    s = s.replace(/[^a-z0-9]/g, '');    // 其余标点全去掉
    if (WORD_ALIAS[s]) s = WORD_ALIAS[s];
    return s;
  }

  // 整句归一化：返回归一化后的词数组（丢弃空词）
  function normalizeText(text) {
    if (!text) return [];
    var raw = String(text).split(/\s+/);
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var w = normalizeWord(raw[i]);
      if (w) out.push(w);
    }
    return out;
  }

  /**
   * 按词序对齐（Needleman-Wunsch 风格 DP）。
   * @param {string} refText  标准句原文
   * @param {string} hypText  语音识别得到的文本
   * @returns {
   *   ops: [{ref:'the', status:'correct'|'wrong'|'missing', heard:'a'|null}],
   *   extras: [{heard:'uh'}],
   *   correct, wrong, missing, extra, score:0-100
   * }
   */
  function alignWords(refText, hypText) {
    var refRawAll = String(refText || '').split(/\s+/);
    var hypRawAll = String(hypText || '').split(/\s+/);
    // 归一化并丢弃空词（修复 '' .split(/\s+) === [''] 的边界 bug）
    var A = [], refRaw = [];
    refRawAll.forEach(function (w) { var n = normalizeWord(w); if (n) { A.push(n); refRaw.push(w); } });
    var B = [], hypRaw = [];
    hypRawAll.forEach(function (w) { var n = normalizeWord(w); if (n) { B.push(n); hypRaw.push(w); } });
    var n = A.length, m = B.length;

    // dp[i][j] = 对齐 A[0..i) 与 B[0..j) 的最小编辑距离
    var dp = [], bt = [];
    for (var i = 0; i <= n; i++) { dp.push(new Array(m + 1).fill(0)); bt.push(new Array(m + 1).fill('')); }
    for (var i2 = 0; i2 <= n; i2++) { dp[i2][0] = i2; bt[i2][0] = 'U'; }
    for (var j2 = 0; j2 <= m; j2++) { dp[0][j2] = j2; bt[0][j2] = 'L'; }

    for (var i3 = 1; i3 <= n; i3++) {
      for (var j3 = 1; j3 <= m; j3++) {
        var matchCost = (A[i3 - 1] === B[j3 - 1]) ? 0 : 1;
        var sub = dp[i3 - 1][j3 - 1] + matchCost;
        var del = dp[i3 - 1][j3] + 1;   // ref 有、hyp 漏
        var ins = dp[i3][j3 - 1] + 1;   // hyp 多说
        var best = sub, dir = 'D';
        if (del < best) { best = del; dir = 'U'; }
        if (ins < best) { best = ins; dir = 'L'; }
        dp[i3][j3] = best; bt[i3][j3] = dir;
      }
    }

    // 回溯
    var ops = [], extras = [];
    var x = n, y = m;
    while (x > 0 || y > 0) {
      var d = bt[x][y];
      if (d === 'D') {
        if (A[x - 1] === B[y - 1]) {
          ops.unshift({ ref: refRaw[x - 1], status: 'correct', heard: hypRaw[y - 1] });
        } else {
          ops.unshift({ ref: refRaw[x - 1], status: 'wrong', heard: hypRaw[y - 1] });
        }
        x--; y--;
      } else if (d === 'U') {
        ops.unshift({ ref: refRaw[x - 1], status: 'missing', heard: null });
        x--;
      } else {
        extras.unshift({ heard: hypRaw[y - 1] });
        y--;
      }
    }

    var correct = 0, wrong = 0, missing = 0;
    ops.forEach(function (o) {
      if (o.status === 'correct') correct++;
      else if (o.status === 'wrong') wrong++;
      else missing++;
    });
    var extra = extras.length;

    // 朗读文本准确度：WER 思想，accuracy=max(0,100*(1-(S+D+I)/N))。
    // S=wrong, D=missing, I=extra, N=标准词数；不使用识别置信度作发音分。
    var errors = wrong + missing + extra;
    var score = n > 0 ? Math.round(Math.max(0, 100 * (1 - errors / n))) : 0;
    if (score > 100) score = 100;

    return {
      ops: ops, extras: extras,
      correct: correct, wrong: wrong, missing: missing, extra: extra,
      refWords: n, hypWords: m, score: score
    };
  }

  // 句分便捷封装
  function scoreSentence(refText, hypText) {
    return alignWords(refText, hypText).score;
  }

  /**
   * 整篇加权：按目标词数加权平均
   * @param {number[]} scores    每句得分（0-100），null 表示未测
   * @param {string[]} sentences 原始句子文本
   */
  function scorePassage(scores, sentences) {
    var wSum = 0, sSum = 0;
    for (var i = 0; i < sentences.length; i++) {
      if (scores[i] == null) continue;
      var w = normalizeText(sentences[i]).length;
      if (w <= 0) w = 1;
      sSum += scores[i] * w;
      wSum += w;
    }
    if (wSum === 0) return 0;
    return Math.round(sSum / wSum);
  }

  /* ---------- 以下为本轮新增：状态机 / 等级 / 按天历史 / 守卫（Node 可测） ---------- */

  /** 主按钮状态机：idle → demo(听示范) → recognizing(跟读) → processing → idle */
  var PHASES = ['idle', 'demo', 'recognizing', 'processing'];

  /**
   * 纯状态机：当前 phase + 发生的动作 → 下一 phase。
   * 两步手势（P0 修复核心）：
   *  - idle 下点主按钮 = startDemo：只播 TTS 示范，绝不自动起麦克风；
   *  - demo 下点主按钮 = startRec：第二次真实手势，在点击同步上下文里
   *    直接 recognition.start()（getUserMedia/rec.start 需要用户手势激活）；
   *  - 绝不在 TTS onend 里自动启动识别。
   * actions:
   *  - 'startDemo'   idle 下点主按钮开始（播示范）
   *  - 'cancelDemo'  demo 下放弃示范回 idle
   *  - 'startRec'    demo 下点主按钮（第二次手势）直接启动识别
   *  - 'result'      识别出 final transcript（要判分）
   *  - 'manualStop'  识别中点「停止跟读」= rec.stop() + 2s grace
   *  - 'timeout'     10-15s 硬超时 = rec.stop() + 2s 强制收尾
   *  - 'settle'      grace/force/onend 完成结算（回 idle）
   *  - 'leave'       切句/重读/离开 = rec.abort()，不判分
   */
  function nextPhase(current, action) {
    switch (current) {
      case 'idle':
        return action === 'startDemo' ? 'demo' : 'idle';
      case 'demo':
        if (action === 'leave' || action === 'cancelDemo') return 'idle';
        if (action === 'startRec') return 'recognizing';
        return 'demo';
      case 'recognizing':
        if (action === 'leave') return 'idle';
        if (action === 'result' || action === 'manualStop' || action === 'timeout') return 'processing';
        return 'recognizing';
      case 'processing':
        if (action === 'settle' || action === 'leave') return 'idle';
        return 'processing';
      default:
        return 'idle';
    }
  }

  /**
   * 结算判决（纯函数）：manualStop / hard-timeout / onend 统一收口时用。
   * @param {{settled:boolean, leaving:boolean}} attempt
   * @param {string} text 本次累计可用文本（final 优先，其次 interim）
   * @returns {'score'|'noresult'|'ignore'}
   *   - score    有文本 → 按词序对齐判分（WER 口径不变）
   *   - noresult 无文本 → 不计分，明确提示 + 重试 / 录音自评
   *   - ignore   已离开 / 已结算 → 忽略（token 迟到事件）
   */
  function settleDecision(attempt, text) {
    if (!attempt || attempt.leaving || attempt.settled) return 'ignore';
    return text ? 'score' : 'noresult';
  }

  /**
   * onresult 判决：本次 transcript 是否要判分（只判一次）。
   * @param {{settled:boolean, leaving:boolean}} attempt 本次尝试状态
   * @param {string} text 识别到的文本（已 trim）
   * @returns {'score'|'noresult'|'ignore'}
   *   - score    正常判分
   *   - noresult 收到空文本，onend 兜底收尾，不计分
   *   - ignore   已判过分 / 已离开，直接忽略（防重复）
   */
  function decideResult(attempt, text) {
    if (!attempt || attempt.leaving) return 'ignore';
    if (attempt.settled) return 'ignore';
    if (!text) return 'noresult';
    return 'score';
  }

  /**
   * 纯 reducer：把一次 Recognition onresult 事件并入 resultMap。
   * P0 核心修复：Web Speech 的 results 是「按 index 累积」的列表，同一 index 上
   * 的 transcript 会被识别引擎原地刷新（interim 前缀不断变长）。旧实现把每次事件
   * 的 interim 字符串继续 append 到上一次，导致前缀被反复累加（截图里 45 个多词）。
   * 正确做法：以 result index 为键，每次「替换」该 index 的内容，绝不追加。
   *  - final index 只记录一次；同一 final 重复回调只是覆盖成相同值 → 幂等。
   * @param {Object} resultMap 既有 map：{ [index]: {transcript, isFinal} }（原地更新并返回）
   * @param {{results: Array}} e onresult 事件（results 为 SpeechRecognitionResultList）
   * @returns {Object} resultMap
   */
  function reduceOnResult(resultMap, e) {
    resultMap = resultMap || {};
    var results = (e && e.results) || [];
    for (var i = 0; i < results.length; i++) {
      var res = results[i];
      var alt = (res && res[0]) || {};
      resultMap[i] = { transcript: alt.transcript || '', isFinal: !!(res && res.isFinal) };
    }
    return resultMap;
  }

  /**
   * 由 resultMap 派生本次会话文本（continuous=false 口径）：
   *  - finalsText  = 所有 isFinal 项按 index 顺序拼接（优先使用）；
   *  - interimText = 末尾唯一活跃 interim（最高 index 的非 final 项），
   *                  因为它在 map 里被不断替换，这里拿到的就是「最后一张快照」，
   *                  手动停止且无 final 时只用它一次。
   * @param {Object} resultMap
   * @returns {{finalsText:string, interimText:string}}
   */
  function buildSessionTranscript(resultMap) {
    resultMap = resultMap || {};
    var idxs = Object.keys(resultMap).map(Number).sort(function (a, b) { return a - b; });
    var finals = [];
    var lastInterim = '';
    idxs.forEach(function (i) {
      var entry = resultMap[i] || {};
      if (entry.isFinal) finals.push(entry.transcript || '');
      else lastInterim = entry.transcript || ''; // 末尾活跃 interim 不断被替换 = 最后一张快照
    });
    return {
      finalsText: finals.join('').trim(),
      interimText: lastInterim.trim()
    };
  }

  /**
   * 防御性「连续重复片段」检测（ASR 串联死循环回退保护）。
   * 重要：不做粗暴 Set 去重——合法重复词（the the / had had）必须保留交给 WER 评分。
   * 只识别「同一个 ≥2 词的块在词序列中连续重复 ≥2 次，且覆盖 ≥ 半数词」这种
   * 典型 ASR 串联（如 "in a field and in a field and ..."）。
   * @param {string[]} words 已归一化的词数组
   * @returns {boolean}
   */
  function detectLoopFragment(words) {
    var n = (words && words.length) || 0;
    if (n < 6) return false; // 太短不判，避免误伤正常短句
    var half = Math.ceil(n / 2);
    for (var L = 2; L <= 6; L++) {
      for (var start = 0; start + 2 * L <= n; start++) {
        var reps = 1;
        for (var p = start; p + 2 * L <= n; p += L) {
          var same = true;
          for (var k = 0; k < L; k++) {
            if (words[p + k] !== words[p + L + k]) { same = false; break; }
          }
          if (same) reps++; else break;
        }
        if (reps >= 2 && reps * L >= half) return true;
      }
    }
    return false;
  }

  /**
   * 识别结果是否异常（本次不计分）。两类信号：
   *  - loop:    防御性连续重复片段（ASR 串联死循环）；
   *  - oversize:最终词数 > 标准词数 2 倍（异常爆炸）。
   * 不做粗暴 Set 去重；合法重复词照常进入 WER 评分。
   * @param {string[]} hypWords  已归一化的识别词数组
   * @param {number} refWordCount 标准句词数
   * @returns {{abnormal:boolean, reason:('loop'|'oversize'|null)}}
   */
  function isAbnormalRecognition(hypWords, refWordCount) {
    var n = (hypWords && hypWords.length) || 0;
    if (detectLoopFragment(hypWords)) return { abnormal: true, reason: 'loop' };
    if (refWordCount > 0 && n > refWordCount * 2) return { abnormal: true, reason: 'oversize' };
    return { abnormal: false, reason: null };
  }

  /**
   * 识别硬超时：按句长估算，夹在 [10s, 15s]。
   * 到点即 rec.stop()，并在 2s 后强制收尾（即便 onresult/onend 不回调）。
   */
  function recLimitMsFor(wordCount) {
    var w = Math.max(1, wordCount || 0);
    return Math.max(10000, Math.min(15000, Math.round(w * 550)));
  }

  /** 句分/篇分等级文案（非音素、词级对齐分的描述） */
  function gradeForScore(score) {
    if (score == null || !isFinite(score)) return { label: '未测', cls: 'g-none', emoji: '·' };
    if (score >= 90) return { label: '准确', cls: 'g-a', emoji: '' };
    if (score >= 80) return { label: '基本准确', cls: 'g-b', emoji: '' };
    if (score >= 60) return { label: '错漏较多', cls: 'g-c', emoji: '' };
    return { label: '建议先听再练', cls: 'g-d', emoji: '' };
  }

  /**
   * 问题词清单（P0 精简反馈，纯函数，不改对齐算法）：
   *  - 错词  {type:'wrong',   target:'ant', heard:'an'}
   *  - 漏词  {type:'missing', target:'summer'}
   *  - 多词  {type:'extra',   heard:'and'}
   * 每个问题按位置只列一次；连续相同（同 type + 同词）合并为 count 次（×N）。
   */
  function buildProblemList(res) {
    var out = [];
    function push(type, target, heard) {
      var key = type + '|' + (target || '') + '|' + (heard || '');
      var last = out[out.length - 1];
      if (last && last._key === key) { last.count++; return; }
      out.push({ type: type, target: target || null, heard: heard || null, count: 1, _key: key });
    }
    (res.ops || []).forEach(function (op) {
      if (op.status === 'wrong') push('wrong', op.ref, op.heard);
      else if (op.status === 'missing') push('missing', op.ref, null);
    });
    (res.extras || []).forEach(function (ex) { push('extra', null, ex.heard); });
    out.forEach(function (o) { delete o._key; });
    return out;
  }

  /**
   * 反馈视图模型（纯函数）：_renderAll 只负责把它盖到 DOM。
   * allGood 时 problems=[]，调用方不渲染详情/红色问题清单。
   */
  function feedbackView(res, sentenceText) {
    var g = gradeForScore(res.score);
    return {
      score: res.score,
      gradeLabel: g.label,
      gradeCls: g.cls,
      counts: { correct: res.correct, wrong: res.wrong, missing: res.missing, extra: res.extra },
      problems: buildProblemList(res),
      allGood: res.wrong === 0 && res.missing === 0 && res.extra === 0,
      plainSentence: sentenceText || '',
      hyp: res.hyp || ''
    };
  }

  /** 历史按 day 分组：{ day: [record,...] } */
  function groupHistoryByDay(records) {
    var out = {};
    (records || []).forEach(function (r) {
      if (!r || r.day == null) return;
      (out[r.day] = out[r.day] || []).push(r);
    });
    return out;
  }

  /**
   * 追加一条记录，每天只保留最近 maxPerDay 次（默认 20）。
   * 返回新数组（不修改入参）。day 缺失的记录丢弃。
   */
  function pushRecordPerDay(records, rec, maxPerDay) {
    maxPerDay = maxPerDay || 20;
    if (!rec || rec.day == null) return (records || []).slice();
    var byDay = {};
    var order = [];
    (records || []).forEach(function (r) {
      if (!r || r.day == null) return;
      if (!byDay[r.day]) { byDay[r.day] = []; order.push(r.day); }
      byDay[r.day].push(r);
    });
    if (!byDay[rec.day]) { byDay[rec.day] = []; order.push(rec.day); }
    byDay[rec.day].push(rec);
    var out = [];
    order.forEach(function (d) {
      byDay[d].slice(-maxPerDay).forEach(function (r) { out.push(r); });
    });
    return out;
  }

  /** 旧接口兼容：全局保留最近 max 次 */
  function pushRecord(records, rec, max) {
    max = max || 20;
    var list = (records || []).concat([rec]);
    return list.slice(-max);
  }

  /**
   * 「保存本次成绩」一次性守卫：保存按钮只允许成功一次，
   * 重做（redo）后 reset() 可再保存一次新 attempt。
   */
  function makeSaveGuard() {
    return {
      saved: false,
      trySave: function () {
        if (this.saved) return false;
        this.saved = true;
        return true;
      },
      reset: function () { this.saved = false; }
    };
  }

  var core = {
    splitSentences: splitSentences,
    normalizeWord: normalizeWord,
    normalizeText: normalizeText,
    alignWords: alignWords,
    scoreSentence: scoreSentence,
    scorePassage: scorePassage,
    pushRecord: pushRecord,
    fixQuotes: fixQuotes,
    // 本轮新增
    VERSION: VERSION,
    PHASES: PHASES,
    nextPhase: nextPhase,
    decideResult: decideResult,
    settleDecision: settleDecision,
    reduceOnResult: reduceOnResult,
    buildSessionTranscript: buildSessionTranscript,
    detectLoopFragment: detectLoopFragment,
    isAbnormalRecognition: isAbnormalRecognition,
    buildProblemList: buildProblemList,
    feedbackView: feedbackView,
    recLimitMsFor: recLimitMsFor,
    gradeForScore: gradeForScore,
    groupHistoryByDay: groupHistoryByDay,
    pushRecordPerDay: pushRecordPerDay,
    makeSaveGuard: makeSaveGuard
  };

  /* ================= 浏览器 UI 层 ================= */

  var HIST_KEY = 'eng30_shadowing_v1';
  var instance = null;

  /* 可见状态机的短文案（每一步都显示 + 计时） */
  var STATUS_LABELS = {
    idle:       '待命',
    permission: '请求麦克风权限…',
    starting:   '启动识别…',
    audio:      '音频已开始，正在收音',
    speech:     '检测到说话',
    heard:      '收到识别文本',
    grace:      '收尾中，等待最终结果…',
    nospeech:   '无匹配 / 未听到内容',
    error:      '识别出错',
    ended:      '识别结束'
  };
  var GRACE_MS = 2000;   // 手动 stop / 硬超时后的宽限：等 final flush
  var FORCE_MS = 2000;   // 硬超时后强制收尾兜底（即便 onresult/onend 不回调）

  function safeGetDayText() {
    try {
      if (typeof DAYS !== 'undefined' && typeof state !== 'undefined' && DAYS && state) {
        var d = null;
        for (var i = 0; i < DAYS.length; i++) if (DAYS[i].day === state.currentDay) { d = DAYS[i]; break; }
        if (d && d.text) return { text: d.text, day: state.currentDay };
      }
    } catch (e) { /* ignore */ }
    return { text: '', day: null };
  }

  function ShadowingBox(container, options) {
    var self = this;
    this.container = typeof container === 'string' ? document.getElementById(container) : container;
    if (!this.container) throw new Error('[shadowing] 挂载容器不存在');
    this.opts = options || {};
    this.getDayText = this.opts.getDayText || safeGetDayText;

    this.recCtor = window.SpeechRecognition || window.webkitSpeechRecognition || null;
    this.rec = null;
    this.recSupported = !!this.recCtor;
    this.recPermissionDenied = false;
    // file:// 禁用自动评分（浏览器安全策略），强制降级自评
    this.isFileProtocol = (typeof location !== 'undefined' && location.protocol === 'file:');
    this.isInsecureContext = location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1';
    this.noAuto = !this.recSupported || this.isFileProtocol || this.isInsecureContext;

    this.micStream = null;
    this.mediaRec = null;
    this.recChunks = [];
    this.audioURL = null;

    this.sentences = [];
    this.idx = 0;
    this.scores = [];   // null | {score, ops, extras, hyp, ...}
    this.busy = false;

    // 主按钮状态机：idle → demo → recognizing → processing → idle
    this.phase = 'idle';
    this.attempt = null;   // {idx,token,settled,leaving,startTs,interimText,finalText,errStatus,timedOut,hardTimer,graceTimer,forceTimer}
    this._tokSeq = 0;
    this.hardTimer = null;
    this.graceTimer = null;
    this.forceTimer = null;
    this.ttsKickoffTimer = null; // 仅用于「听示范」后回到待命，不再自动起麦克风
    this._statusStep = 'idle';
    this._statusTicker = null;
    this._saveGuard = makeSaveGuard();
    this._pendingListener = function () { self._refreshPending(); };
    window.addEventListener('eng30-pending-speech-scan', this._pendingListener);
    window.addEventListener('eng30-pending-speech-change', this._pendingListener);

    this._buildDom();
    this._bind();
    this.reload();
  }

  ShadowingBox.prototype.reload = function () {
    this._abortAll(); // 切文章 = 离开当前活动
    var info = this.getDayText();
    this.dayInfo = info;
    this.sentences = splitSentences(info.text || '');
    this.idx = 0;
    this.scores = new Array(this.sentences.length).fill(null);
    this.sentenceAttempts = new Array(this.sentences.length).fill(0);
    this.phase = 'idle';
    this.attempt = null;
    this.busy = false;
    this._saveGuard = makeSaveGuard();
    this._clearHeard();
    this._renderNotice();
    this._renderAll();
    this._refreshPending();
    this._renderMainBtn();
    this._setStatus('idle', true);
  };

  ShadowingBox.prototype._buildDom = function () {
    var c = this.container;
    c.classList.add('sh-box');
    c.innerHTML =
      '<div class="sh-head"><h3>朗读文本准确度</h3>' +
      '<button type="button" class="sh-mini" data-act="reload">重读今日文章</button></div>' +
      '<p class="sh-note">按词序对比识别结果（正确/错/漏/多词），<b>非专业音素/发音评分</b>，仅作跟读参考。</p>' +
      '<div class="sh-warn hidden" data-ref="warn"></div>' +
      '<div class="sh-progress-row">' +
        '<span class="sh-step" data-ref="step">已完成 0 / 0 句</span>' +
        '<div class="sh-bar"><div class="sh-bar-fill" data-ref="barfill"></div></div>' +
        '<span class="sh-cur" data-ref="curscore">--</span>' +
      '</div>' +
      // 可见状态条：每步短文案 + 计时
      '<div class="sh-status hidden" data-ref="status">' +
        '<span class="sh-status-dot"></span>' +
        '<span class="sh-status-step" data-ref="statusStep">待命</span>' +
        '<span class="sh-status-time" data-ref="statusTime"></span>' +
      '</div>' +
      '<div class="sh-feedback hidden" data-ref="feedback"></div>' +
      '<div class="sh-sentence" data-ref="sentence"></div>' +
      '<details class="sh-detail hidden" data-ref="detail"><summary>查看识别详情</summary><div class="sh-detail-text" data-ref="detailtext"></div></details>' +
      '<div class="sh-heard hidden" data-ref="heard"></div>' +
      '<div class="sh-nextstep" data-ref="nextstep">点「开始跟读」，先听标准朗读再跟读</div>' +
      '<div class="sh-actions">' +
        '<button type="button" class="sh-btn" data-act="prev">‹ 上一句</button>' +
        // 唯一主按钮：data-ref 固定为 mainBtn，文案/行为随 phase 切换
        '<button type="button" class="sh-btn primary sh-main" data-ref="mainBtn">开始跟读</button>' +
        '<button type="button" class="sh-btn" data-act="listen">▶ 听标准朗读</button>' +
        '<button type="button" class="sh-btn" data-act="next">下一句 ›</button>' +
      '</div>' +
      '<div class="sh-actions2">' +
        '<button type="button" class="sh-btn ghost" data-act="rerecord">一键重新评分</button>' +
        '<button type="button" class="sh-btn ghost" data-act="redo">重做整篇</button>' +
        '<button type="button" class="sh-btn ghost hidden" data-act="playback" data-ref="playback">▶ 录音回放</button>' +
      '</div>' +
      '<audio class="hidden" controls data-ref="audio"></audio>' +
      '<div class="sh-passage hidden" data-ref="passage"></div>' +
      '<button type="button" class="sh-hist-toggle" data-act="toggle-history">▽ 历史成绩</button>' +
      '<div class="sh-history hidden" data-ref="history"></div>';
    var self = this;
    this.els = {};
    c.querySelectorAll('[data-ref]').forEach(function (el) { self.els[el.getAttribute('data-ref')] = el; });
    this.els.mainBtn.addEventListener('click', function () { self._onMainBtn(); });
    var note = c.querySelector('.sh-note');
    if (note) note.textContent = '按词序看读对了哪些词：对、错、漏、多；这是文字对比，不是发音打分。';
  };

  ShadowingBox.prototype._bind = function () {
    var self = this;
    this.container.querySelectorAll('[data-act]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var act = btn.getAttribute('data-act');
        self._onAction(act);
      });
    });
  };

  /* ---------- 可见状态条 ---------- */
  ShadowingBox.prototype._setStatus = function (step, quiet) {
    this._statusStep = step || 'idle';
    var el = this.els.status;
    if (!el) return;
    if (this._statusStep === 'idle' && !quiet) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    this.els.statusStep.textContent = STATUS_LABELS[this._statusStep] || this._statusStep;
    this._syncStatusTime();
  };

  ShadowingBox.prototype._startStatusTicker = function () {
    this._stopStatusTicker();
    var self = this;
    this._statusTicker = setInterval(function () { self._syncStatusTime(); }, 100);
  };

  ShadowingBox.prototype._stopStatusTicker = function () {
    if (this._statusTicker) { clearInterval(this._statusTicker); this._statusTicker = null; }
  };

  ShadowingBox.prototype._syncStatusTime = function () {
    if (!this.els.statusTime) return;
    var att = this.attempt;
    if (att && att.startTs) {
      this.els.statusTime.textContent = (Math.max(0, Date.now() - att.startTs) / 1000).toFixed(1) + 's';
    } else {
      this.els.statusTime.textContent = '';
    }
  };

  /* ---------- 主按钮：两步手势 ---------- */
  ShadowingBox.prototype._onMainBtn = function () {
    // processing 期：评分是瞬时渲染，按钮不响应新动作（停止始终可点指 recognizing/demo）
    if (this.phase === 'idle') this.startDemo();                 // 第 1 次手势：只播示范
    else if (this.phase === 'demo') this.startRecognitionNow();  // 第 2 次手势：直接起麦克风
    else if (this.phase === 'recognizing') this.requestSettle('manual'); // 停止跟读
  };

  ShadowingBox.prototype._renderMainBtn = function () {
    var b = this.els.mainBtn;
    var labels = {
      idle:         '开始跟读',
      demo:         '🎤 我来跟读（开始录音）',
      recognizing:  '⏹ 停止跟读',
      processing:   '评分中…'
    };
    var hasScore = this.phase === 'idle' && this.scores && this.scores[this.idx];
    b.textContent = hasScore ? '↻ 重新跟读' : (labels[this.phase] || labels.idle);
    b.disabled = (this.phase === 'processing');
    this.container.setAttribute('data-phase', this.phase);
  };

  ShadowingBox.prototype._onAction = function (act) {
    switch (act) {
      case 'reload': this.reload(); break;
      case 'prev': this.go(this.idx - 1); break;
      case 'next': this.go(this.idx + 1); break;
      case 'listen': this.listenCurrent(); break; // 独立「听示范」：只 TTS
      case 'rerecord': this.retryScoreNow(); break;
      case 'redo':
        this._emit('recordRedo', {
          day: this.dayInfo.day, module: 'shadowing', sentenceIdx: this.idx,
          cleared: this.scores.filter(function (s) { return s != null; }).length
        });
        this._abortAll();
        this.scores = new Array(this.sentences.length).fill(null);
            this.sentenceAttempts = new Array(this.sentences.length).fill(0);
        this._saveGuard = makeSaveGuard();
        this.go(0, true);
        break;
      case 'toggle-history': {
        var h = this.els.history;
        var open = h.classList.toggle('hidden');
        var btn = this.container.querySelector('[data-act="toggle-history"]');
        if (btn) btn.textContent = open ? '▽ 历史成绩' : '△ 收起历史';
        break;
      }
      case 'playback':
        if (this.audioURL) { this.els.audio.src = this.audioURL; this.els.audio.classList.remove('hidden'); this.els.audio.play(); }
        break;
    }
  };

  ShadowingBox.prototype._renderNotice = function () {
    var w = this.els.warn;
    var msgs = [];
    if (this.isInsecureContext) { msgs.push('🔒 Web Speech 需要 HTTPS（localhost 除外）。识别不可用时仍保存录音；恢复后请点“一键重新评分”重新启麦。'); }
    if (this.isFileProtocol) {
      msgs.push('📁 file:// 下 Web Speech 通常不可用；录音会保存到 IndexedDB，部署 HTTPS 后点“一键重新评分”。');
    } else if (!this.recSupported) {
      msgs.push('⚠️ 当前浏览器不支持 Web Speech；录音会保存，不生成分数，也不提供手动自评。');
    }
    if (this.isFileProtocol) {
      w.textContent = 'file:// 下不进行自动识别。录音保存在 IndexedDB；请在 HTTPS 页面点“一键重新评分”重新启麦。已保存 Blob 不能被标准 Web Speech 直接重放识别。';
      w.classList.remove('hidden');
    } else if (msgs.length) { w.innerHTML = msgs.join('<br>'); w.classList.remove('hidden'); }
    else w.classList.add('hidden');
  };

  /** 切句 = 离开当前活动：abort 识别（不判分），停 TTS，清计时/录音 */
  ShadowingBox.prototype.go = function (i, skipAbort) {
    if (i < 0) i = 0;
    if (i >= this.sentences.length) i = this.sentences.length - 1;
    if (!skipAbort) this._abortAll();
    this.idx = i;
    this.phase = 'idle';
    this.attempt = null;
    this._clearHeard();
    this._renderAll();
    this._renderMainBtn();
    this._setStatus('idle', true);
  };

  /* 切句/重读/重做/离开 统一兜底：abort 识别（非 stop），不判分 */
  ShadowingBox.prototype._abortAll = function () {
    if (this.attempt) this.attempt.leaving = true;
    this._clearTimers();
    this._stopStatusTicker();
    this.stopTTS();
    try {
      if (this.rec) {
        this.rec.onresult = null;
        this.rec.onerror = null;
        this.rec.onend = null;
        this.rec.abort();
      }
    } catch (e) {}
    this.rec = null;
    this._teardownMedia();
    this.phase = 'idle';
  };

  ShadowingBox.prototype._clearTimers = function () {
    if (this.ttsKickoffTimer) { clearTimeout(this.ttsKickoffTimer); this.ttsKickoffTimer = null; }
    if (this.hardTimer) { clearTimeout(this.hardTimer); this.hardTimer = null; }
    if (this.graceTimer) { clearTimeout(this.graceTimer); this.graceTimer = null; }
    if (this.forceTimer) { clearTimeout(this.forceTimer); this.forceTimer = null; }
  };

  ShadowingBox.prototype._renderAll = function () {
    var total = this.sentences.length;
    var done = this.scores.reduce(function (n, item) { return n + (item != null ? 1 : 0); }, 0);
    this.els.step.textContent = '已完成 ' + done + ' / ' + total + ' 句（第 ' + (this.idx + 1) + ' 句） · 本句练习 ' + ((this.sentenceAttempts && this.sentenceAttempts[this.idx]) || 0) + ' 次';
    this.els.barfill.style.width = (total ? (done / total * 100) : 0) + '%';

    var cur = this.scores[this.idx];
    if (cur) {
      var g = core.gradeForScore(cur.score);
      this.els.curscore.textContent = g.emoji + ' ' + cur.score;
      this.els.curscore.className = 'sh-cur ' + g.cls;
      this.els.curscore.title = g.label;
    } else {
      this.els.curscore.textContent = '--';
      this.els.curscore.className = 'sh-cur';
    }

    var ns = this.els.nextstep;
    if (this.phase === 'recognizing') {
      ns.classList.remove('sh-allgood');
      ns.textContent = '正在跟读。说完后自然停顿，或点「停止跟读」；系统会在收尾后用已收到的文本评分。';
    } else if (this.phase === 'demo') {
      ns.classList.remove('sh-allgood');
      ns.textContent = '正在播放标准朗读… 听完后，点「我来跟读」开始录音（不会自动启动麦克风）。';
    } else if (cur) {
      var gg = core.gradeForScore(cur.score);
      var allGoodNow = cur.wrong === 0 && cur.missing === 0 && cur.extra === 0;
      if (allGoodNow) {
        ns.textContent = '本句内容完整准确，可以进入下一句。';
        ns.classList.add('sh-allgood');
      } else if (this.idx >= total - 1 && done >= total) {
        ns.classList.remove('sh-allgood');
        ns.innerHTML = '本篇完成！点「保存本次成绩」记录成绩';
      } else if (this.idx >= total - 1) {
        ns.classList.remove('sh-allgood');
        ns.innerHTML = '这是最后一句，完成后可保存成绩';
      } else {
        ns.classList.remove('sh-allgood');
        ns.innerHTML = gg.emoji + ' ' + gg.label + '（' + cur.score + ' 分）→ 点「下一句」继续';
      }
    } else {
      ns.classList.remove('sh-allgood');
      ns.textContent = this.noAuto ? '点“开始跟读”后录音；本次不生成分数，录音保存后可在 HTTPS 环境一键重新评分' : '点“开始跟读”先听标准朗读；听完点“我来跟读”开始录音';
    }

    // 原句只显示一次，纯文本（默认不逐个铺正确词）
    var s = this.sentences[this.idx] || '';
    var box = this.els.sentence;
    box.textContent = s;
    box.classList.remove('hidden');

    // Layer 1/2/3：大分数卡 + 一行计数 + 仅问题词清单
    var fb = this.els.feedback;
    var det = this.els.detail;
    if (cur) {
      var view = core.feedbackView(cur, s);
      fb.classList.remove('hidden');
      fb.innerHTML =
        '<div class="sh-scorecard">' +
          '<span class="sh-score-label">朗读文本准确度</span>' +
          '<span class="sh-score-num ' + view.gradeCls + '">' + view.score + '</span>' +
          '<span class="sh-score-grade ' + view.gradeCls + '">' + view.gradeLabel + '</span>' +
        '</div>' +
        '<div class="sh-countline">对 <b>' + view.counts.correct + '</b> · 错 <b>' + view.counts.wrong +
          '</b> · 漏 <b>' + view.counts.missing + '</b> · 多 <b>' + view.counts.extra + '</b></div>';
      if (!view.allGood && view.problems.length) {
        var probBox = document.createElement('div');
        probBox.className = 'sh-problems';
        view.problems.forEach(function (p) {
          var chip = document.createElement('span');
          chip.className = 'sh-prob sh-prob-' + p.type;
          var txt = '';
          if (p.type === 'wrong') txt = '错词「' + p.target + '」读成「' + p.heard + '」';
          else if (p.type === 'missing') txt = '漏词「' + p.target + '」';
          else txt = '多读「' + p.heard + '」';
          if (p.count > 1) txt += ' ×' + p.count;
          chip.textContent = txt;
          probBox.appendChild(chip);
        });
        fb.appendChild(probBox);
      }
      // 完整识别文本：仅在默认折叠的「查看识别详情」details 中；全对不显示
      if (view.allGood) {
        det.classList.add('hidden');
      } else {
        det.classList.remove('hidden');
        det.removeAttribute('open'); // 默认关闭
        this.els.detailtext.textContent = view.hyp;
      }
    } else {
      fb.classList.add('hidden');
      det.classList.add('hidden');
      det.removeAttribute('open');
    }

    this._renderHistory();
  };

  /* ---------- TTS ---------- */
  ShadowingBox.prototype.stopTTS = function () {
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}
  };

  // 独立「听标准朗读」= 纯 TTS：打断当前活动 → 播示范，绝不启动麦克风/录音
  ShadowingBox.prototype.listenCurrent = function () {
    this._abortAll();
    this.phase = 'idle';
    this._renderMainBtn();
    this._renderAll();
    this._speak(this.sentences[this.idx], null);
    this._setHeard('正在播放标准朗读（仅示范，不录音）。');
  };

  ShadowingBox.prototype._speak = function (text, onend) {
    if (!window.speechSynthesis) {
      this._setHeard('⚠️ 当前浏览器不支持语音合成（标准朗读）。');
      if (onend) onend();
      return;
    }
    this.stopTTS();
    var u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    // P0 合并要求：示范语速直接取全局设置，不再乘 0.9
    var rate = 1;
    try { if (typeof state !== 'undefined' && state.settings && state.settings.ttsRate) rate = Number(state.settings.ttsRate); } catch (e) {}
    if (!(rate > 0)) rate = 1;
    u.rate = rate;
    u.onend = function () { if (onend) onend(); };
    u.onerror = function () { if (onend) onend(); };
    window.speechSynthesis.speak(u);
  };

  /* ---------- 第 1 次手势：idle → demo（只播示范） ---------- */
  ShadowingBox.prototype.startDemo = function () {
    if (this.phase !== 'idle') return; // 防重复启动
    if (!this.sentences.length) return;
    this.sentenceAttempts[this.idx] = (this.sentenceAttempts[this.idx] || 0) + 1;
    // 新一次尝试的 token：后续迟到事件据此隔离
    this.attempt = {
      idx: this.idx, token: ++this._tokSeq,
      settled: false, leaving: false, timedOut: false,
      startTs: Date.now(), interimText: '', finalText: '',
      resultMap: {},   // 每会话清空：按 result index 维护，替换不追加
      errStatus: null, hardTimer: null, graceTimer: null, forceTimer: null
    };
    this.phase = 'demo';
    this._renderMainBtn();
    this._clearHeard();
    this._renderAll();
    this._setStatus('permission');
    this._startStatusTicker();
    // 关键：示范播完绝不自动起麦克风。onend 只把状态退回待命提示，等待用户第 2 次手势。
    this._speak(this.sentences[this.idx], null);
  };

  /** demo 中点「我来跟读」= 第 2 次真实手势：同步上下文里直接启动识别 */
  ShadowingBox.prototype.startRecognitionNow = function () {
    if (this.phase !== 'demo') return; // 防重复：必须在 demo 态
    var att = this.attempt;
    if (!att || att.leaving) return;
    this.stopTTS(); // 立刻打断示范

    if (this.noAuto) {
      // Web Speech unavailable: record only and keep a pending retry; never self-grade.
      this.phase = 'recognizing';
      this._renderMainBtn();
      this._renderAll();
      this._startRecorder();
      this._setStatus('audio');
      this._setHeard('正在录音。读完点“停止跟读”；录音将保存并标记待重新评分。');
      return;
    }

    this.phase = 'recognizing';
    this._renderMainBtn();
    this._renderAll();
    this._startRecognitionWithToken(att);
  };

  /* ---------- Recognition（interimResults=true，便于 grace 用中间文本） ---------- */
  ShadowingBox.prototype._startRecognitionWithToken = function (att) {
    var self = this;
    var token = att.token;
    this.stopTTS();
    this._setStatus('starting');

    var r = new this.recCtor();
    r.lang = 'en-US';
    r.continuous = false;
    r.interimResults = true; // 收集 interim，供手动 stop 后 2s grace 判分
    this.rec = r;

    r.onresult = function (e) {
      if (!self.attempt || self.attempt.token !== token || self.attempt.leaving) return; // token 隔离迟到事件
      // P0：按 result index 维护 resultMap——同一 index 替换为最新 transcript，绝不追加。
      // interim 前缀被引擎原地刷新，旧实现 append 导致前缀累加（45 个多词）。
      core.reduceOnResult(att.resultMap, e);
      // continuous=false：final 项按序拼接为优先文本；末尾只保留最后一张 interim 快照。
      var built = core.buildSessionTranscript(att.resultMap);
      att.finalText = built.finalsText;
      att.interimText = built.interimText;
      if (built.finalsText) self._setStatus('heard');
      else if (att.interimText) self._setStatus('speech');
      // 收到 final → 结算（settleNow 内部 settled 守卫保证只一次，重复 final 幂等）
      if (built.finalsText) self._settleNow('result');
    };

    r.onerror = function (e) {
      if (!self.attempt || self.attempt.token !== token || self.attempt.leaving) return;
      var err = e.error || 'unknown';
      if (err === 'aborted') return; // 我们自己 abort 的离开
      var status = err === 'no-speech' ? 'no-speech'
        : (err === 'not-allowed' || err === 'service-not-allowed') ? 'denied'
        : err === 'network' ? 'network' : 'error';
      att.errStatus = status;
      if (status === 'denied') {
        self.recPermissionDenied = true;
        self.noAuto = true;
        self.els.warn.classList.remove('hidden');
        self.els.warn.textContent = '🚫 麦克风权限被拒绝，无法录音或自动评分；请在 Safari 设置中授权后重试。';
      }
      self._setStatus('error');
    };

    r.onend = function () {
      if (!self.attempt || self.attempt.token !== token || self.attempt.leaving) return; // 迟到的旧识别忽略
      self._setStatus('ended');
      // onend 到来：用已收文本结算（settleNow 内部判空 → noresult）
      self._settleNow('end');
    };

    try {
      r.start();
      this._startRecorder(); // 与识别并行录音回放
    } catch (err2) {
      att.errStatus = 'start-failure';
      this._settleNow('end');
      return;
    }

    // 10–15s 硬超时：到点 rec.stop()，并 2s 后强制收尾（即便 onresult/onend 不回调）
    var limit = core.recLimitMsFor(normalizeText(this.sentences[this.idx]).length);
    var box = this;
    att.hardTimer = setTimeout(function () { box._onHardTimeout(token); }, limit);
    this.hardTimer = att.hardTimer;
  };

  /** 10–15s 硬超时：graceful stop + 2s 后强制收尾 */
  ShadowingBox.prototype._onHardTimeout = function (token) {
    var att = this.attempt;
    if (!att || att.token !== token || att.leaving || att.settled) return;
    att.timedOut = true;
    this._requestSettle('timeout', FORCE_MS);
  };

  /** recognizing 中点「停止跟读」：rec.stop() + stopRecorder + 2s grace，用已收 interim/final 评分 */
  ShadowingBox.prototype.requestSettle = function (reason) {
    if (this.phase !== 'recognizing') return;
    var att = this.attempt;
    if (!att || att.leaving || att.settled) return;
    this._requestSettle(reason, GRACE_MS);
  };

  ShadowingBox.prototype._requestSettle = function (reason, waitMs) {
    var att = this.attempt;
    if (!att) return;
    this.phase = 'processing';      // 按钮变「评分中」
    this._renderMainBtn();
    this.stopTTS();
    this.stopRecorder();            // 停止录音，保留已录片段可回放
    try { if (this.rec) this.rec.stop(); } catch (e) {} // graceful，可能 flush 出 final
    this._setStatus('grace');
    var self = this;
    var token = att.token;
    // 2s 宽限/强制收尾：用已收到的 interim/final 文本；无文本则不计分
    if (att.graceTimer) clearTimeout(att.graceTimer);
    att.graceTimer = setTimeout(function () { self._settleNow(reason); }, waitMs);
    this.graceTimer = att.graceTimer;
  };

  /** 统一结算：score（有文本，WER 口径不变）/ noresult（无文本，明确提示+重试/自评） */
  ShadowingBox.prototype._settleNow = function (reason) {
    var att = this.attempt;
    if (!att || att.leaving) { this._cleanupAfterAttempt(); return; }
    if (att.settled) { this._cleanupAfterAttempt(); return; }

    // 先判决（此时 settled 仍为 false），再置位，保证只结算一次
    var text = (att.finalText || att.interimText || '').trim();
    var decision = core.settleDecision(att, text);
    if (decision === 'ignore') { this._cleanupAfterAttempt(); return; }
    att.settled = true;

    if (att.hardTimer) { clearTimeout(att.hardTimer); att.hardTimer = null; }
    if (att.graceTimer) { clearTimeout(att.graceTimer); att.graceTimer = null; }
    this._stopStatusTicker();
    this.recordingOutcome = { succeeded: decision === 'score', error: att.errStatus || reason };
    this.stopRecorder();
    this._persistLastRecording();

    // 强制收尾：即便识别仍在跑，也停掉并清掉回调
    try { if (this.rec) { this.rec.onresult = null; this.rec.onerror = null; this.rec.onend = null; this.rec.abort(); } } catch (e) {}
    this.rec = null;

    if (decision === 'score') {
      var ref = this.sentences[this.idx];
      // P0：防御性异常判定——连续重复片段 / 词数 > 标准 2 倍 → 本次不计分。
      // 不做粗暴 Set 去重，合法重复词仍走正常 WER。
      var hypWords = normalizeText(text);
      var refWordCount = normalizeText(ref).length;
      var abn = core.isAbnormalRecognition(hypWords, refWordCount);
      if (abn.abnormal) {
        this._emitAttempt({
          status: 'abnormal', hyp: text, score: null, abnormal: true, reason: abn.reason,
          correct: 0, wrong: 0, total: 0, error: 'recognition-' + abn.reason
        });
        this._setStatus('error');
        this._setHeard('识别结果异常，请重试，本次不计分');
        this.phase = 'idle';
        this._renderMainBtn();
        this._renderAll();
        return;
      }
      var res = alignWords(ref, text); // WER 口径保持
      res.hyp = text;
      this.scores[this.idx] = res;

      var wrongWords = [];
      res.ops.forEach(function (op) { if (op.status === 'wrong' || op.status === 'missing') wrongWords.push(op.ref); });
      var wrong = res.wrong + res.missing + res.extra;
      this._emitAttempt({
        status: 'success', hyp: text, score: res.score,
        correct: res.correct, wrong: wrong, total: res.correct + wrong,
        wrongWords: wrongWords, wrongSentences: wrong > 0 ? [ref] : [],
        alignment: { correct: res.correct, wrong: res.wrong, missing: res.missing, extra: res.extra, refWords: res.refWords, hypWords: res.hypWords }
      });
      this._setStatus('heard');
      this.phase = 'idle';
      this._renderMainBtn();
      this._renderAll();
      this._maybeFinish();
    } else {
      // 无文本不计分：保留录音并等待用户重新启麦评分
      var status = att.errStatus || (att.timedOut ? 'timeout' : (reason === 'timeout' ? 'timeout' : 'stopped'));
      var msgByStatus = {
        'no-speech': '没有识别到内容，本次不计分；录音已保存，请点“一键重新评分”。',
        'denied': '麦克风权限被拒绝，本次不评分。',
        'network': 'Web Speech 识别失败；录音已保存，联网后可一键重新评分。',
        'timeout': '已到最长识别时间且没有可用文本，本次不计分，请重新跟读。',
        'start-failure': '无法启动识别，请重试。',
        'stopped': '已停止且没有识别文本；录音已保存，请点“一键重新评分”。'
      };
      this._emitAttempt({
        status: status, hyp: '', score: null, correct: 0, wrong: 0, total: 0,
        error: att.errStatus || (att.timedOut ? 'timeout' : 'manual-stop')
      });
      this._setStatus(status === 'no-speech' ? 'nospeech' : (att.errStatus ? 'error' : 'ended'));
      this._setHeard('识别结果异常，请重试，本次不计分');
      this.phase = 'idle';
      this._renderMainBtn();
      this._renderAll();
    }
    this.attempt = att; // 保留供 debugState 读，leaving/settled 已置
    this.attempt = null;
  };

  ShadowingBox.prototype._cleanupAfterAttempt = function () {
    this._clearTimers();
    this._stopStatusTicker();
    try { if (this.rec) { this.rec.onresult = null; this.rec.onerror = null; this.rec.onend = null; this.rec.abort(); } } catch (e) {}
    this.rec = null;
    this.phase = 'idle';
    this.attempt = null;
    this._renderMainBtn();
    this._renderAll();
  };

  ShadowingBox.prototype._setHeard = function (msg) {
    this.els.heard.classList.remove('hidden');
    this.els.heard.innerHTML = '提示：<span></span>';
    this.els.heard.querySelector('span').textContent = msg;
  };

  ShadowingBox.prototype._clearHeard = function () {
    this.els.heard.classList.add('hidden');
    this.els.heard.innerHTML = '';
  };

  ShadowingBox.prototype._speechMeta = function () { return { day: this.dayInfo.day, module: 'shadowing', itemId: String(this.idx), prompt: this.sentences[this.idx] || '', attempts: (this.sentenceAttempts[this.idx] || 1) }; };
  ShadowingBox.prototype.retryScoreNow = function () {
    if (this.phase !== 'idle' || this.noAuto) { this._setHeard(this.noAuto ? '当前无法调用 Web Speech；请在 HTTPS 且支持识别的环境重试。' : '请等待当前操作结束。'); return; }
    this.scores[this.idx]=null; this.startDemo(); this.startRecognitionNow();
  };
  ShadowingBox.prototype._persistLastRecording = function () {
    if (!this.lastRecordingBlob || !this.recordingOutcome || !window.Eng30SpeechFallback) return;
    var blob=this.lastRecordingBlob, outcome=this.recordingOutcome; this.lastRecordingBlob=null; this.recordingOutcome=null;
    window.Eng30SpeechFallback.saveAttempt(this._speechMeta(), blob, outcome.succeeded, outcome.error).then(this._refreshPending.bind(this)).catch(function () {});
  };
  ShadowingBox.prototype._refreshPending = function () {
    var self=this; if (!window.Eng30SpeechFallback) return;
    window.Eng30SpeechFallback.list(this._speechMeta()).then(function (rows) { if (rows.length && self.phase==='idle') self.els.nextstep.textContent='有 '+rows.length+' 条待重新评分录音。旧录音可回放；点“一键重新评分”会重新启麦并自动判分。'; });
  };

  /* ---------- MediaRecorder recording fallback ---------- */
  ShadowingBox.prototype._startRecorder = function () {
    var self = this;
    this.els.playback.classList.add('hidden');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') return;
    this._teardownMedia();
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      if (!self.attempt || self.attempt.leaving) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
      self.micStream = stream;
      try {
        self.mediaRec = new MediaRecorder(stream);
        self.recChunks = [];
        self.mediaRec.ondataavailable = function (e) { if (e.data && e.data.size) self.recChunks.push(e.data); };
        self.mediaRec.onstop = function () {
          if (self.recChunks.length) {
            if (self.audioURL) URL.revokeObjectURL(self.audioURL);
            self.lastRecordingBlob = new Blob(self.recChunks, { type: self.mediaRec.mimeType || 'audio/webm' });
            self.audioURL = URL.createObjectURL(self.lastRecordingBlob);
            self.els.playback.classList.remove('hidden');
            self._persistLastRecording();
          }
          if (self.micStream) self.micStream.getTracks().forEach(function (t) { t.stop(); });
          self.micStream = null;
        };
        self.mediaRec.start();
      } catch (e) { /* 静默降级 */ }
    }).catch(function () { /* 静默降级：无录音回放 */ });
  };

  ShadowingBox.prototype.stopRecorder = function () {
    try { if (this.mediaRec && this.mediaRec.state !== 'inactive') this.mediaRec.stop(); } catch (e) {}
  };

  ShadowingBox.prototype._teardownMedia = function () {
    try { if (this.mediaRec && this.mediaRec.state !== 'inactive') this.mediaRec.stop(); } catch (e) {}
    this.mediaRec = null;
    if (this.micStream) {
      try { this.micStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      this.micStream = null;
    }
    if (this.audioURL) { try { URL.revokeObjectURL(this.audioURL); } catch (e) {} this.audioURL = null; }
    this.recChunks = [];
  };

  /* ---------- 统一事件上报 ---------- */
  ShadowingBox.prototype._emit = function (method, payload) {
    try {
      if (typeof window !== 'undefined' && window.Eng30Events && typeof window.Eng30Events[method] === 'function') {
        window.Eng30Events[method](payload || {});
      }
    } catch (e) { /* 上报失败绝不影响主流程 */ }
  };

  ShadowingBox.prototype._emitAttempt = function (extra) {
    var att = this.attempt || {};
    var p = {
      day: this.dayInfo.day, module: 'shadowing', timestamp: Date.now(),
      sentenceIdx: this.idx, ref: this.sentences[this.idx] || '',
      durationMs: att.startTs ? Math.max(0, Date.now() - att.startTs) : 0
    };
    Object.keys(extra || {}).forEach(function (k) { p[k] = extra[k]; });
    this._emit('recordAttempt', p);
  };

  /* ---------- 整篇完成 & 保存 & 历史 ---------- */
  ShadowingBox.prototype._maybeFinish = function () {
    var allDone = this.scores.every(function (s) { return s != null; });
    if (!allDone) return;
    var total = scorePassage(this.scores.map(function (s) { return s.score; }), this.sentences);
    var g = core.gradeForScore(total);
    var self = this;
    this.els.passage.classList.remove('hidden');
    this.els.passage.innerHTML =
      '<div class="sh-passage-score">本篇加权总分：<b>' + total + '</b> / 100 ' +
      '<span class="sh-grade ' + g.cls + '">' + g.emoji + ' ' + g.label + '</span></div>' +
      '<button type="button" class="sh-btn primary sh-save" data-act="save">保存本次成绩</button>';
    var btn = this.els.passage.querySelector('[data-act="save"]');
    btn.addEventListener('click', function () { self._saveRecord(total); });
  };

  ShadowingBox.prototype._saveRecord = function (total) {
    if (!this._saveGuard.trySave()) return;
    var per = this.scores.map(function (s) {
      return s ? { score: s.score, correct: s.correct, wrong: s.wrong, missing: s.missing, extra: s.extra } : null;
    });
    var rec = { ts: Date.now(), day: this.dayInfo.day, total: total, grade: core.gradeForScore(total).label, perSentence: per };
    var list = pushRecordPerDay(this._loadHistory(), rec, 20);
    try { Eng30Storage.set(HIST_KEY, JSON.stringify({ records: list })); } catch (e) {}
    this._emit('recordAttempt', {
      day: this.dayInfo.day, module: 'shadowing_passage', status: 'passage-saved',
      timestamp: rec.ts, score: total, correct: total >= 80, total: 1, wrongWords: [], wrongSentences: []
    });
    var btn = this.els.passage.querySelector('[data-act="save"]');
    if (btn) { btn.disabled = true; btn.textContent = '✓ 已保存'; }
    this._renderHistory();
  };

  ShadowingBox.prototype._loadHistory = function () {
    try {
      var raw = Eng30Storage.get(HIST_KEY);
      if (raw) { var p = JSON.parse(raw); if (p && Array.isArray(p.records)) return p.records; }
    } catch (e) {}
    return [];
  };

  function fmtTime(ts) {
    var d = new Date(ts);
    var mm = d.getMonth() + 1, dd = d.getDate();
    var hh = String(d.getHours()).padStart(2, '0'), mi = String(d.getMinutes()).padStart(2, '0');
    return (mm + '/' + dd + ' ' + hh + ':' + mi);
  }

  ShadowingBox.prototype._renderHistory = function () {
    var list = this._loadHistory().filter(function (r) { return r && Number(r.day) === Number(this.dayInfo.day); }, this).slice(-20);
    var el = this.els.history;
    if (!list.length) { el.innerHTML = '<p class="sh-history-empty">Day ' + this.dayInfo.day + ' 暂无已保存的整篇成绩。</p>'; return; }
    var latest = list[list.length - 1];
    var best = list.reduce(function (a, b) { return Number(b.total) > Number(a.total) ? b : a; }, list[0]);
    var prev = list.length > 1 ? list[list.length - 2] : null;
    var delta = prev ? Number(latest.total) - Number(prev.total) : null;
    var gl = core.gradeForScore(latest.total);
    var html = '<h4>Day ' + this.dayInfo.day + ' 历史（最近 20 次）</h4>' +
      '<div class="sh-hist-row"><span>最近 <b>' + latest.total + '</b> ' + gl.label + '</span>' +
      '<span>最好 <b>' + best.total + '</b></span>' +
      '<span>较上次 <b>' + (delta == null ? '—' : (delta > 0 ? '+' + delta : delta)) + '</b></span></div>' +
      '<div class="sh-hattempts">';
    list.slice().reverse().forEach(function (rec) {
      var gg = core.gradeForScore(rec.total);
      html += '<details><summary>' + fmtTime(rec.ts) + ' · 整篇 ' + rec.total + ' · ' + gg.label + '</summary><div class="sh-hsents">';
      (rec.perSentence || []).forEach(function (item, i) {
        if (item == null) return;
        var sc = typeof item === 'object' ? item.score : item;
        var gs = core.gradeForScore(sc);
        html += '<span class="sh-hsent">' + (i + 1) + '句 ' + sc + ' ' + gs.label;
        if (typeof item === 'object') html += '<i>对' + item.correct + ' 错' + item.wrong + ' 漏' + item.missing + ' 多' + item.extra + '</i>';
        html += '</span>';
      });
      html += '</div></details>';
    });
    el.innerHTML = html + '</div>';
  };

  /* ================= 对外入口 & 调试钩子 ================= */

  function mount(container, options) {
    if (instance) { try { instance._abortAll(); instance.container.innerHTML = ''; } catch (e) {} }
    instance = new ShadowingBox(container, options);
    return instance;
  }

  function refresh() {
    if (instance) instance.reload();
  }

  // 调试/测试钩子：只暴露状态，不泄露本地存储/用户数据/隐私信息。
  function debugState() {
    if (!instance) return { mounted: false, version: VERSION };
    var a = instance.attempt || {};
    return {
      mounted: true,
      version: VERSION,
      phase: instance.phase,
      sentenceIdx: instance.idx,
      sentenceCount: instance.sentences.length,
      statusStep: instance._statusStep,
      elapsedMs: a.startTs ? Math.max(0, Date.now() - a.startTs) : 0,
      attempt: {
        token: a.token || 0,
        settled: !!a.settled,
        leaving: !!a.leaving,
        timedOut: !!a.timedOut,
        errStatus: a.errStatus || null,
        interimLen: (a.interimText || '').length,
        finalLen: (a.finalText || '').length,
        resultMapLen: a.resultMap ? Object.keys(a.resultMap).length : 0
      },
      noAuto: instance.noAuto,
      recSupported: instance.recSupported,
      isFileProtocol: instance.isFileProtocol,
      mainBtnText: instance.els.mainBtn ? instance.els.mainBtn.textContent : null,
      mainBtnDisabled: instance.els.mainBtn ? instance.els.mainBtn.disabled : null
    };
  }

  function getInstance() { return instance; }

  /* Node / 浏览器双端导出 */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = core;
  }
  global.Shadowing = {
    mount: mount, refresh: refresh, core: core, debugState: debugState,
    getInstance: getInstance, VERSION: VERSION,
    stopAll: function () { if (instance) instance._abortAll(); }
  };
  global.ShadowingCore = core;

})(typeof window !== 'undefined' ? window : globalThis);
