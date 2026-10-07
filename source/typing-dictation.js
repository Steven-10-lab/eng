/* =========================================================================
 * typing-dictation.js — 输入式填空默写（独立模块）
 * -------------------------------------------------------------------------
 * - 纯逻辑函数（normalizeAnswer / gradeBlank / buildQuestions / scoreSession /
 *   recoverAnswer / appendHistory / summarizeHistory）不依赖 DOM，可在 Node 中
 *   直接 require 做单元测试。
 * - 浏览器环境下自动注入到既有 #panel-dictation（每日默写区），提供模式切换：
 *     [手写·逐句播放]  = 既有听写模式，完全保留，不破坏
 *     [iPad 输入默写]  = 本模块新 UI，JS 动态渲染
 * - 历史记录存于独立 localStorage key：eng30_typingdict_v1
 *   （不读、不写、不删除旧的 eng30_state_v1，兼容旧进度）。
 * ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.TypingDictation = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* =======================================================================
   * 纯函数区（Node 可测，零 DOM 依赖）
   * ===================================================================== */

  /** 把英文句子切成句子数组，保留句末标点（与 app.js splitIntoSentences 同口径） */
  function sentenceList(text) {
    const m = String(text == null ? '' : text).match(/[^.!?]+[.!?]+/g);
    return m ? m.map(function (s) { return s.trim(); })
             : [String(text == null ? '' : text).trim()].filter(Boolean);
  }

  /** 归一化为小写词序列：弯撇号→直撇号，去标点，压空格 */
  function tokenizeNorm(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .replace(/[\u2018\u2019\u02bc\u00b4\u0060]/g, "'")   // ‘ ’ ′ ´ ` → '
      .replace(/[^a-z0-9' \-]/g, ' ')
      .replace(/\s+/g, ' ').trim()
      .split(' ').filter(Boolean);
  }

  /**
   * 答案/输入归一化（容错口径）：
   *  - 忽略大小写
   *  - 忽略首尾空格、压缩中间多余空格
   *  - 弯撇号 ’ ‘ → 直撇号 '（常见缩写 don't / New Year's 等）
   *  - 去掉用户可能多打的首尾引号与句末标点
   * 注意：单词本身拼写错（如 summer→sumer）不归一化掉，必须判错。
   */
  function normalizeAnswer(raw) {
    return String(raw == null ? '' : raw)
      .replace(/[\u2018\u2019\u02bc\u00b4\u0060]/g, "'")
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .replace(/^["'“”‘’]+/, '')
      .replace(/[.,;:!?。，；：！？"“”‘’]+$/, '')
      .trim();
  }

  /** 判断单个空是否答对：归一化后完全相等；空输入不算对 */
  function gradeBlank(userInput, correctAnswer) {
    const u = normalizeAnswer(userInput);
    if (u === '') return false;
    return u === normalizeAnswer(correctAnswer);
  }

  function escapeRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * 从 dictationHints 的 "______" 句反查原文，还原被挖掉的答案。
   * 思路：把提示句按 ______ 切成前/后两段，归一化为词序列，在原文词序列里
   * 定位“前序词 → 答案词 → 后序词”的最小间隙，间隙即为答案。
   * 找不到（提示句与原文对不上）时返回 null，宁可不出题也不瞎给答案。
   */
  function recoverAnswer(hint, text) {
    if (!hint || !text) return null;
    const parts = String(hint).split(/_+/);
    if (parts.length < 2) return null;
    const pre = tokenizeNorm(parts[0]);
    const post = tokenizeNorm(parts.slice(1).join(' '));
    const toks = tokenizeNorm(text);
    if (!toks.length) return null;

    for (let i = 0; i + pre.length <= toks.length; i++) {
      let ok = true;
      for (let k = 0; k < pre.length; k++) {
        if (toks[i + k] !== pre[k]) { ok = false; break; }
      }
      if (!ok) continue;
      const jStart = i + pre.length;
      if (post.length === 0) {
        if (jStart < toks.length) return toks[jStart];
        continue;
      }
      for (let j = jStart; j + post.length <= toks.length; j++) {
        let ok2 = true;
        for (let k = 0; k < post.length; k++) {
          if (toks[j + k] !== post[k]) { ok2 = false; break; }
        }
        if (!ok2) continue;
        const gap = toks.slice(jStart, j);
        if (gap.length >= 1) return gap.join(' ');
      }
    }
    // 兜底：前序词因原文多了几个词而不连续时，改为“后序词锚定”——
    // 后序词在原文中连续成块时，被挖的单词就是紧贴其前的那个词（人工提示句均为单词空）。
    if (post.length >= 2) {
      for (let j = 0; j + post.length <= toks.length; j++) {
        let ok = true;
        for (let k = 0; k < post.length; k++) {
          if (toks[j + k] !== post[k]) { ok = false; break; }
        }
        if (!ok) continue;
        if (j - 1 >= 0) return toks[j - 1];
      }
    }
    return null;
  }

  function overlapScore(toksA, toksB) {
    const setB = {};
    toksB.forEach(function (t) { setB[t] = 1; });
    let n = 0;
    toksA.forEach(function (t) { if (setB[t]) n++; });
    return n;
  }

  /**
   * 根据当天数据生成填空题目。
   * 优先级：① dictationHints 已人工挖空的重点句（答案反查自原文）
   *        ② words[] 重点词在原文中出现处再挖空
   * 每题保留整句上下文，答案一定来自当天原文。
   * 返回 [{ qid, sentenceIdx, answer, sentence(含 ______), note }]
   */
  function buildQuestions(dayData) {
    const text = (dayData && dayData.text) || '';
    const sentences = sentenceList(text);
    const vocab = dayData && dayData.words ? dayData.words : [];
    const hints = dayData && dayData.dictationHints ? dayData.dictationHints : [];

    const vocabByLemma = {};
    vocab.forEach(function (w) { vocabByLemma[String(w.word).toLowerCase()] = w; });

    const out = [];
    const seen = {};
    function add(sentenceIdx, answer, sentence, note) {
      if (!answer || !sentence) return;
      const key = sentenceIdx + '|' + normalizeAnswer(answer);
      if (seen[key]) return;
      seen[key] = 1;
      out.push({
        qid: out.length,
        sentenceIdx: sentenceIdx,
        answer: answer,
        sentence: sentence,
        note: note || ''
      });
    }

    // ① 人工提示句
    hints.forEach(function (hint) {
      const ans = recoverAnswer(hint, text);
      if (!ans) return;
      let sIdx = 0, best = -1;
      const hintToks = tokenizeNorm(hint.replace(/_+/, ' x '));
      sentences.forEach(function (s, i) {
        const sc = overlapScore(hintToks, tokenizeNorm(s));
        if (sc > best) { best = sc; sIdx = i; }
      });
      const w = vocabByLemma[ans.split(' ')[0]];
      const note = w ? (w.pos + ' ' + w.meaning) : '';
      // 提示句里的 ______ 作为挖空标记保留
      add(sIdx, ans, String(hint).trim(), note);
    });

    // ② 重点词在原文中出现处挖空
    sentences.forEach(function (s, sIdx) {
      vocab.forEach(function (w) {
        const lemma = String(w.word);
        const re = new RegExp('\\b' + escapeRe(lemma) + '\\b', 'i');
        const mm = s.match(re);
        if (!mm) return;
        const cloze = s.replace(re, ' ______ ').replace(/\s+/g, ' ').trim();
        add(sIdx, mm[0], cloze, w.pos + ' ' + w.meaning);
      });
    });

    out.sort(function (a, b) {
      return a.sentenceIdx - b.sentenceIdx || a.qid - b.qid;
    });
    out.forEach(function (q, i) { q.qid = i; });
    return out.slice(0, 12);
  }

  /**
   * 整卷评分。
   * questions: buildQuestions 产出；answers: { qid: 用户输入 }
   * 返回 { correct, wrong, unanswered, total, accuracy, wrongItems:[{qid,answer,userAnswer,status}] }
   */
  function scoreSession(questions, answers) {
    answers = answers || {};
    let correct = 0, wrong = 0, unanswered = 0;
    const wrongItems = [];
    (questions || []).forEach(function (q) {
      const raw = answers[q.qid] == null ? '' : String(answers[q.qid]);
      if (normalizeAnswer(raw) === '') {
        unanswered++;
        wrongItems.push({ qid: q.qid, answer: q.answer, userAnswer: '', status: 'unanswered' });
        return;
      }
      if (gradeBlank(raw, q.answer)) {
        correct++;
      } else {
        wrong++;
        wrongItems.push({ qid: q.qid, answer: q.answer, userAnswer: raw, status: 'wrong' });
      }
    });
    const total = (questions || []).length;
    return {
      correct: correct,
      wrong: wrong,
      unanswered: unanswered,
      total: total,
      accuracy: total ? Math.round((correct / total) * 100) : 0,
      wrongItems: wrongItems
    };
  }

  /**
   * 构造单次空提交的上报载荷（纯函数，可 Node 测试）。
   * 每个空每次批改都会产生一条，同题连续多次错误也会逐条真实记录。
   * 字段：day / module / itemId / correct / score / answer / expected /
   *       errorWords / durationMs / timestamp
   */
  function buildAttemptPayload(opts) {
    opts = opts || {};
    return {
      day: opts.day,
      module: 'typing_dictation',
      itemId: opts.itemId,
      correct: !!opts.correct,
      score: opts.score == null ? 0 : opts.score,
      total: opts.total == null ? 0 : opts.total,
      answer: opts.answer == null ? '' : String(opts.answer),
      expected: opts.expected == null ? '' : String(opts.expected),
      errorWords: Array.isArray(opts.errorWords) ? opts.errorWords.slice() : [],
      durationMs: Math.max(0, Math.round(opts.durationMs || 0)),
      timestamp: opts.timestamp || Date.now(),
      idempotencyKey: opts.idempotencyKey || null
    };
  }

  /** 构造重做上报载荷（整篇重做 / 只重做错题） */
  function buildRedoPayload(opts) {
    opts = opts || {};
    return {
      day: opts.day,
      module: 'typing_dictation',
      type: opts.type === 'wrong-only' ? 'wrong-only' : 'all',
      timestamp: opts.timestamp || Date.now()
    };
  }

  /** 追加一次尝试记录（不可变风格，返回新 store），每天最多保留 20 条，重做不覆盖旧记录 */
  function appendHistory(store, dayNum, attempt) {
    store = store ? JSON.parse(JSON.stringify(store)) : {};
    const key = 'day' + dayNum;
    const arr = (store[key] && store[key].attempts) ? store[key].attempts.slice() : [];
    arr.push(attempt);
    while (arr.length > 20) arr.shift();
    store[key] = { done: true, attempts: arr };
    return store;
  }

  /** 汇总历史：最近一次 / 最好一次 / 较上次变化 */
  function summarizeHistory(attempts) {
    if (!attempts || !attempts.length) return null;
    const last = attempts[attempts.length - 1];
    const prev = attempts.length > 1 ? attempts[attempts.length - 2] : null;
    let best = attempts[0];
    attempts.forEach(function (a) { if (a.accuracy > best.accuracy) best = a; });
    return {
      count: attempts.length,
      last: last,
      prev: prev,
      best: best,
      delta: prev ? last.accuracy - prev.accuracy : null
    };
  }

  var pureApi = {
    sentenceList: sentenceList,
    tokenizeNorm: tokenizeNorm,
    normalizeAnswer: normalizeAnswer,
    gradeBlank: gradeBlank,
    recoverAnswer: recoverAnswer,
    buildQuestions: buildQuestions,
    scoreSession: scoreSession,
    buildAttemptPayload: buildAttemptPayload,
    buildRedoPayload: buildRedoPayload,
    appendHistory: appendHistory,
    summarizeHistory: summarizeHistory
  };

  /* Node 环境到此为止，不加载 UI */
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return pureApi;
  }

  /* =======================================================================
   * 浏览器 UI 区
   * ===================================================================== */
  var STORAGE_KEY = 'eng30_typingdict_v1';
  var MODE_KEY = 'eng30_typingdict_mode';

  var state = {
    dayNum: 1,
    questions: [],
    answers: {},      // qid -> input value
    graded: {},       // qid -> true/false（true 正确，false 错误/未答）
    gradedDone: {},   // qid -> bool 该空是否已批改过
    redoSet: null,    // null=整卷；否则为本次只重做的 qid 集合
    sessionRecorded: false,
    qStart: {},       // qid -> 该空本次作答开始时间戳（用于 durationMs）
    gradeLocks: {},
    sessionToken: '',
    mode: 'hand'      // 'hand' | 'type'
  };

  /* 统一事件上报（若宿主提供 window.Eng30Events 则调用，否则静默兜底） */
  function emitAttempt(p) {
    try {
      if (typeof window !== 'undefined' && window.Eng30Events &&
          typeof window.Eng30Events.recordAttempt === 'function') {
        window.Eng30Events.recordAttempt(p);
      }
    } catch (e) {}
  }
  function emitRedo(p) {
    try {
      if (typeof window !== 'undefined' && window.Eng30Events &&
          typeof window.Eng30Events.recordRedo === 'function') {
        window.Eng30Events.recordRedo(p);
      }
    } catch (e) {}
  }
  /** 当前重做范围内已批改错误的空的正确答案清单 */
  function currentErrorWords() {
    return visibleQuestions()
      .filter(function (q) { return state.gradedDone[q.qid] && !state.graded[q.qid]; })
      .map(function (q) { return q.answer; });
  }

  function loadStore() {
    try {
      var raw = Eng30Storage.get(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }
  function saveStore(store) {
    try { Eng30Storage.set(STORAGE_KEY, JSON.stringify(store)); } catch (e) {}
  }
  function dayKey() { return 'day' + state.dayNum; }

  function currentDayNum() {
    var m = (location.hash || '').match(/#\/day\/(\d+)/);
    return m ? parseInt(m[1], 10) : 1;
  }
  function dayData() {
    var D = (typeof DAYS !== 'undefined') ? DAYS : [];
    return D.find(function (d) { return d.day === state.dayNum; });
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }
  function speak(text) {
    if (!('speechSynthesis' in window)) return;
    try {
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      // 统一使用全局语速（Eng30TTS 已钳制并持久化）
      if (typeof Eng30TTS !== 'undefined' && Eng30TTS && typeof Eng30TTS.getRate === 'function') {
        u.rate = Eng30TTS.getRate();
      } else if (typeof state !== 'undefined' && state.settings && state.settings.ttsRate) {
        u.rate = state.settings.ttsRate;
      }
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }

  /* ---- 注入模式切换与挂载点 ---- */
  function injectChrome() {
    var panel = document.getElementById('panel-dictation');
    if (!panel || panel.querySelector('.td-mode-switch')) return;

    var sw = el('div', 'td-mode-switch');
    sw.innerHTML =
      '<div class="td-mode-btns">' +
        '<button type="button" class="td-mode-btn" data-mode="hand">手写 · 逐句播放</button>' +
        '<button type="button" class="td-mode-btn" data-mode="type">iPad 输入默写</button>' +
      '</div>' +
      '<p class="td-mode-tip">手写模式请在练习本上听音书写；iPad 模式直接在下方空格中打字。</p>';
    panel.insertBefore(sw, panel.firstChild);

    // 复用 index.html 里静态声明的 #typing-dictation-mount（避免重复 ID）；
    // 若没有则自建。统一打上 td-module 类，初始保持 hidden。
    var mount = document.getElementById('typing-dictation-mount');
    if (mount) {
      mount.classList.add('td-module');
      mount.classList.add('hidden');   // 初始隐藏，切到 type 模式时再移除
      mount.innerHTML = '';            // 清掉静态占位的旧内容，防泄漏
    } else {
      mount = el('div', 'td-module hidden');
      mount.id = 'typing-dictation-mount';
      var bar = panel.querySelector('.complete-bar');
      if (bar) panel.insertBefore(mount, bar); else panel.appendChild(mount);
    }

    sw.querySelectorAll('.td-mode-btn').forEach(function (b) {
      b.addEventListener('click', function () { setMode(b.getAttribute('data-mode'), true); });
    });

    try { state.mode = Eng30Storage.get(MODE_KEY) || 'hand'; } catch (e) {}
    applyMode();
  }

  function setMode(m, save) {
    state.mode = (m === 'type') ? 'type' : 'hand';
    if (save) { try { Eng30Storage.set(MODE_KEY, state.mode); } catch (e) {} }
    applyMode();
    if (state.mode === 'type') render();
  }
  function applyMode() {
    var panel = document.getElementById('panel-dictation');
    var mount = document.getElementById('typing-dictation-mount');
    if (!panel) return;
    panel.classList.toggle('td-type-mode', state.mode === 'type');
    // 显式控制显隐：type 模式必须移除 hidden（全局 .hidden 为 !important，仅靠 CSS 打不过）
    if (mount) {
      if (state.mode === 'type') mount.classList.remove('hidden');
      else mount.classList.add('hidden');
    }
    // type 模式下强制隐藏旧手写 UI（app.js 会给 #dictation-hint 设内联 display:block，
    // 用 .hidden 类的 !important 压过它；hand 模式恢复，交回 app.js 原有逻辑）
    setOldDictationUiHidden(state.mode === 'type');
    document.querySelectorAll('.td-mode-btn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-mode') === state.mode);
    });
  }

  // type 模式隐藏旧手写区；hand 模式移除 hidden 恢复旧 UI
  function setOldDictationUiHidden(hidden) {
    ['#dictation-hint', '.dictation-controls', '.dictation-write-area', '.dictation-reveal'].forEach(function (sel) {
      var el = document.querySelector(sel);
      if (!el) return;
      if (hidden) el.classList.add('hidden');
      else el.classList.remove('hidden');
    });
  }

  /* ---- 渲染 ---- */
  function render() {
    state.dayNum = currentDayNum();
    var d = dayData();
    var mount = document.getElementById('typing-dictation-mount');
    if (!mount || !d) return;

    state.questions = buildQuestions(d);
    state.answers = {};
    state.graded = {};
    state.gradedDone = {};
    state.redoSet = null;
    state.sessionRecorded = false;
    state.qStart = {};
    state.gradeLocks = {};
    state.sessionToken = state.dayNum + '-' + Date.now();

    mount.innerHTML = '';

    var head = el('div', 'td-head');
    head.appendChild(el('h3', 'td-title', '输入式填空默写'));
    head.appendChild(el('p', 'td-sub', '根据提示在空格中输入单词，注意拼写与大小写。先听音，再作答。'));

    var toolbar = el('div', 'td-toolbar');
    var btnAll = el('button', 'td-btn primary', '全部提交');
    toolbar.appendChild(btnAll);
    var resultBox = el('div', 'td-result hidden');
    toolbar.appendChild(resultBox);
    var actions = el('div', 'td-actions hidden');
    var btnRedoWrong = el('button', 'td-btn', '只重做错题');
    var btnRedoAll = el('button', 'td-btn', '重做整篇');
    actions.appendChild(btnRedoWrong);
    actions.appendChild(btnRedoAll);
    toolbar.appendChild(actions);

    var list = el('div', 'td-list');
    var historyBox = el('div', 'td-history');

    mount.appendChild(head);
    mount.appendChild(toolbar);
    mount.appendChild(list);
    mount.appendChild(historyBox);

    renderCards(list);
    renderHistory(historyBox);
    // render 只在 type 模式触发：重断言旧手写区隐藏（防 app.js 重渲染后内联 display 复活）
    setOldDictationUiHidden(true);

    btnAll.addEventListener('click', function () {
      gradeAll(list, resultBox, actions);
    });
    btnRedoWrong.addEventListener('click', function () { redoWrong(list, resultBox, actions, historyBox); });
    btnRedoAll.addEventListener('click', function () { redoAll(list, resultBox, actions, historyBox); });
  }

  function visibleQuestions() {
    return state.questions.filter(function (q) {
      return !state.redoSet || state.redoSet[q.qid];
    });
  }

  function renderCards(list) {
    list.innerHTML = '';
    visibleQuestions().forEach(function (q) {
      state.qStart[q.qid] = Date.now();   // 记录该空作答开始时间
      var card = el('div', 'td-card');
      card.setAttribute('data-qid', q.qid);

      var headRow = el('div', 'td-card-head');
      var speakBtn = el('button', 'td-speak', '🔊 朗读句子');
      speakBtn.type = 'button';
      headRow.appendChild(speakBtn);
      headRow.appendChild(el('span', 'td-qbadge', '第 ' + (q.qid + 1) + ' 空'));
      var submitOne = el('button', 'td-btn small', '批改本句');
      submitOne.type = 'button';
      headRow.appendChild(submitOne);
      card.appendChild(headRow);

      // 句子：把 ______ 替换成内联输入框
      var sentRow = el('div', 'td-sentence');
      var parts = String(q.sentence).split(/_+/);
      sentRow.appendChild(document.createTextNode(parts[0]));
      var input = el('input', 'td-input');
      input.type = 'text';
      input.setAttribute('autocapitalize', 'off');
      input.setAttribute('autocorrect', 'off');
      input.setAttribute('autocomplete', 'off');
      input.setAttribute('spellcheck', 'false');
      input.placeholder = '输入单词';
      input.dataset.qid = q.qid;
      sentRow.appendChild(input);
      for (var i = 1; i < parts.length; i++) {
        sentRow.appendChild(document.createTextNode(parts[i]));
      }
      card.appendChild(sentRow);

      var fb = el('div', 'td-feedback hidden');
      card.appendChild(fb);

      speakBtn.addEventListener('click', function () { speak(q.sentence.replace(/_+/g, q.answer)); });
      submitOne.addEventListener('click', function () {
        state.answers[q.qid] = input.value;
        gradeOne(q, input, fb, list);
        afterAnyGrade(list, document.querySelector('.td-result'), document.querySelector('.td-actions'));
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          state.answers[q.qid] = input.value;
          gradeOne(q, input, fb, list);
          afterAnyGrade(list, document.querySelector('.td-result'), document.querySelector('.td-actions'));
        }
      });

      list.appendChild(card);
    });
  }

  function gradeOne(q, input, fb, list) {
    if (state.gradeLocks[q.qid]) return false;
    state.gradeLocks[q.qid] = true;
    var card = input.closest && input.closest('.td-card');
    var submit = card && card.querySelector('.td-btn.small');
    if (submit) submit.disabled = true;
    input.disabled = true;
    var raw = input.value;
    var ok = gradeBlank(raw, q.answer);
    state.answers[q.qid] = raw;
    state.graded[q.qid] = ok;
    state.gradedDone[q.qid] = true;

    // 统一事件上报：每个空每次提交都增量一条（同题连续多次错误也会逐条记录）
    var correctSoFar = visibleQuestions().filter(function (vq) {
      return state.gradedDone[vq.qid] && state.graded[vq.qid];
    }).length;
    emitAttempt(buildAttemptPayload({
      day: state.dayNum,
      itemId: q.qid,
      correct: ok,
      score: correctSoFar,
      total: visibleQuestions().length,
      answer: raw,
      expected: q.answer,
      errorWords: currentErrorWords(),
      durationMs: Date.now() - (state.qStart[q.qid] || Date.now()),
      timestamp: Date.now(),
      idempotencyKey: 'td-' + state.sessionToken + '-' + q.qid
    }));

    input.disabled = true;
    input.classList.remove('correct', 'wrong');
    input.classList.add(ok ? 'correct' : 'wrong');
    fb.classList.remove('hidden');
    fb.innerHTML = '';
    if (ok) {
      fb.appendChild(el('span', 'td-tag ok', '✓ 正确'));
    } else {
      fb.appendChild(el('span', 'td-tag bad', raw.trim() === '' ? '✗ 未作答' : '✗ 错误'));
      fb.appendChild(el('span', 'td-ans', '正确答案：' + esc(q.answer)));
      if (q.note) fb.appendChild(el('span', 'td-note', q.note));
    }
  }

  function gradeAll(list, resultBox, actions) {
    // 收集当前可见卡片的输入
    list.querySelectorAll('.td-input').forEach(function (inp) {
      state.answers[inp.dataset.qid] = inp.value;
    });
    list.querySelectorAll('.td-card').forEach(function (card) {
      var qid = parseInt(card.getAttribute('data-qid'), 10);
      var q = state.questions.find(function (x) { return x.qid === qid; });
      var inp = card.querySelector('.td-input');
      var fb = card.querySelector('.td-feedback');
      gradeOne(q, inp, fb, list);
    });

    // 用整卷（当前重做范围）评分
    const vis = visibleQuestions();
    var res = scoreSession(vis, state.answers);
    resultBox.classList.remove('hidden');
    resultBox.innerHTML = '';
    var line1 = el('div', 'td-score-line', '本次得分：' + res.correct + ' / ' + res.total + '　正确率：' + res.accuracy + '%');
    resultBox.appendChild(line1);
    if (res.wrongItems.length) {
      var wl = el('div', 'td-wrong-words');
      var words = res.wrongItems.map(function (w) { return w.answer; });
      wl.appendChild(el('span', 'td-wrong-label', '错词：'));
      wl.appendChild(el('span', 'td-wrong-list', words.join('、')));
      resultBox.appendChild(wl);
    } else {
      resultBox.appendChild(el('div', 'td-allok', '全部正确，太棒了！'));
    }
    actions.classList.remove('hidden');

    recordAttempt(res);
    renderHistory(document.querySelector('.td-history'));
  }

  function afterAnyGrade(list, resultBox, actions) {
    // 若当前重做范围里所有空都批改过了，汇总一次结果
    var vis = visibleQuestions();
    var allDone = vis.every(function (q) { return state.gradedDone[q.qid]; });
    if (!allDone || !resultBox) return;
    var res = scoreSession(vis, state.answers);
    resultBox.classList.remove('hidden');
    resultBox.innerHTML = '';
    resultBox.appendChild(el('div', 'td-score-line', '本次得分：' + res.correct + ' / ' + res.total + '　正确率：' + res.accuracy + '%'));
    if (res.wrongItems.length) {
      resultBox.appendChild(el('div', 'td-wrong-words', '错词：' + res.wrongItems.map(function (w) { return w.answer; }).join('、')));
    } else {
      resultBox.appendChild(el('div', 'td-allok', '全部正确，太棒了！'));
    }
    actions.classList.remove('hidden');
    recordAttempt(res);
    renderHistory(document.querySelector('.td-history'));
  }

  function recordAttempt(res) {
    if (state.sessionRecorded) return;
    state.sessionRecorded = true;
    var store = loadStore();
    var attempt = {
      ts: Date.now(),
      score: res.correct,
      total: res.total,
      accuracy: res.accuracy,
      wrongWords: res.wrongItems.map(function (w) { return w.answer; }),
      mode: state.redoSet ? 'wrong-only' : 'all'
    };
    saveStore(appendHistory(store, state.dayNum, attempt));
  }

  function redoWrong(list, resultBox, actions, historyBox) {
    // 只保留错题/未答
    var keep = {};
    state.questions.forEach(function (q) {
      if (!state.graded[q.qid]) keep[q.qid] = true; // graded 为 false 或未批 = 错/未答
    });
    state.redoSet = Object.keys(keep).length ? keep : null;
    emitRedo(buildRedoPayload({ day: state.dayNum, type: 'wrong-only', timestamp: Date.now() }));
    resetAttempt(list, resultBox, actions);
  }
  function redoAll(list, resultBox, actions, historyBox) {
    state.redoSet = null;
    emitRedo(buildRedoPayload({ day: state.dayNum, type: 'all', timestamp: Date.now() }));
    resetAttempt(list, resultBox, actions);
  }
  function resetAttempt(list, resultBox, actions) {
    state.answers = {};
    state.graded = {};
    state.gradedDone = {};
    state.qStart = {};
    state.gradeLocks = {};
    state.sessionToken = state.dayNum + '-' + Date.now();
    state.sessionRecorded = false;   // 新一轮尝试可再记一条历史，不覆盖旧记录
    resultBox.classList.add('hidden');
    resultBox.innerHTML = '';
    actions.classList.add('hidden');
    renderCards(list);
  }

  function renderHistory(box) {
    if (!box) return;
    box.innerHTML = '';
    var store = loadStore();
    var rec = store[dayKey()];
    var attempts = rec && rec.attempts ? rec.attempts : [];
    var s = summarizeHistory(attempts);
    if (!s) {
      box.appendChild(el('div', 'td-history-empty', '还没有记录，开始第一次输入默写吧。'));
      return;
    }

    // 儿童端渐进披露：默认只给一行“最近成绩”，明细与对比统计折叠，点击才展开
    var summary = el('div', 'td-history-summary');
    summary.appendChild(el('span', 'td-h-title', '最近成绩：' + s.last.score + '/' + s.last.total + ' · ' + s.last.accuracy + '%'));
    var toggle = el('button', 'td-h-toggle', '展开历次（' + s.count + '）');
    toggle.type = 'button';
    summary.appendChild(toggle);
    box.appendChild(summary);

    var detail = el('div', 'td-h-detail hidden');
    box.appendChild(detail);

    var stats = el('div', 'td-history-stats');
    stats.appendChild(el('span', 'td-h-item', '最好：' + s.best.accuracy + '%'));
    if (s.delta !== null) {
      var d = s.delta > 0 ? '+' + s.delta + '%' : (s.delta === 0 ? '持平' : s.delta + '%');
      stats.appendChild(el('span', 'td-h-item ' + (s.delta > 0 ? 'up' : s.delta < 0 ? 'down' : ''), '较上次：' + d));
    }
    detail.appendChild(stats);

    var list = el('div', 'td-h-list');
    attempts.slice(-5).reverse().forEach(function (a) {
      var dd = new Date(a.ts);
      var ds = dd.getMonth() + 1 + '/' + dd.getDate() + ' ' +
               String(dd.getHours()).padStart(2, '0') + ':' + String(dd.getMinutes()).padStart(2, '0');
      var row = el('div', 'td-h-row');
      row.appendChild(el('span', 'td-h-time', ds + (a.mode === 'wrong-only' ? '（错题重做）' : '')));
      row.appendChild(el('span', 'td-h-score', a.score + '/' + a.total + ' · ' + a.accuracy + '%'));
      if (a.wrongWords && a.wrongWords.length) {
        row.appendChild(el('span', 'td-h-wrong', a.wrongWords.join('、')));
      }
      list.appendChild(row);
    });
    detail.appendChild(list);

    toggle.addEventListener('click', function () {
      var open = !detail.classList.contains('hidden');
      detail.classList.toggle('hidden', open);
      toggle.textContent = open ? '展开历次（' + s.count + '）' : '收起历次';
    });
  }

  /* ---- 自动挂载：监听面板可见性与路由 ---- */
  function mount() {
    injectChrome();
    if (state.mode === 'type' && !document.getElementById('panel-dictation').classList.contains('hidden')) {
      render();
    }
  }

  function init() {
    injectChrome();
    // 路由变化时重渲染
    window.addEventListener('hashchange', function () {
      if (state.mode === 'type') {
        var panel = document.getElementById('panel-dictation');
        if (panel && !panel.classList.contains('hidden')) render();
      }
    });
    // app.js 用 .hidden 切换面板，监听属性变化
    var panel = document.getElementById('panel-dictation');
    if (panel && typeof MutationObserver !== 'undefined') {
      var mo = new MutationObserver(function () {
        if (state.mode === 'type' && !panel.classList.contains('hidden')) render();
      });
      mo.observe(panel, { attributes: true, attributeFilter: ['class'] });
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mount);
    } else {
      mount();
    }
  }

  // 浏览器自动初始化
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }

  return Object.assign({ init: init }, pureApi);
});
