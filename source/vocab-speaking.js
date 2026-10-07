/* =========================================================
 * vocab-speaking.js — 独立单词听说练习模块
 * ---------------------------------------------------------
 * 流程：听示范（标准发音/慢速/例句朗读）→ 麦克风跟读 → 反馈
 *       （识别文本 + 对/错/漏/多词）→ 再来一次 / 下一个 / 重做错词
 *
 * 设计约束（与并行开发的其它模块隔离）：
 *  - 完全独立，不修改 index.html / app.js / styles.css / data.js；
 *  - 统计存入独立 localStorage 命名空间 eng30_vocab_speaking_v1，
 *    绝不读写 eng30_state_v1，不触碰艾宾浩斯记忆曲线数据；
 *  - 本模块「读对」只作为一次练习记录，绝不直接标记“已记住”；
 *    旧的「记住 / 没记住」按钮仍由 app.js 旧逻辑管理；
 *  - 事件桥：若 window.Eng30Events 存在，则调用 recordAttempt / recordRedo；
 *  - 对齐算法优先复用 window.ShadowingCore（shadowing.js），
 *    若其尚未加载则内置兼容实现，不强制依赖加载顺序；
 *  - TTS 与语音识别严格互斥：任何一方启动前必先停掉另一方。
 * ========================================================= */
(function (global) {
  'use strict';

  /* ================= 核心算法（内置兼容实现） =================
   * 与 ShadowingCore 同构；浏览器里若 shadowing.js 已加载，
   * 运行时优先调用 window.ShadowingCore，这里仅作兜底。 */

  function fixQuotes(s) {
    return String(s)
      .replace(/[\u2018\u2019\u02BC\u0060]/g, "'")
      .replace(/[\u201C\u201D]/g, '"');
  }

  // ASR 常见口语变体等价
  var WORD_ALIAS = {
    ok: 'okay', okeh: 'okay', okey: 'okay',
    thru: 'through', altho: 'although', tho: 'though',
    cuz: 'because', ya: 'you', wanna: 'want',
    gimme: 'give', gotta: 'got'
  };

  /** 单词归一化：大小写无关；弯/直撇号统一后去除；其余标点去除；口语变体等价 */
  function normalizeWord(w) {
    if (w == null) return '';
    var s = fixQuotes(w).toLowerCase();
    s = s.replace(/'/g, '');
    s = s.replace(/[^a-z0-9]/g, '');
    if (WORD_ALIAS[s]) s = WORD_ALIAS[s];
    return s;
  }

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
   * @returns {ops, extras, correct, wrong, missing, extra, refWords, hypWords, score}
   */
  function alignWords(refText, hypText) {
    var refRaw = String(refText || '').split(/\s+/);
    var hypRaw = String(hypText || '').split(/\s+/);
    var A = refRaw.map(normalizeWord);
    var B = hypRaw.map(normalizeWord);
    var n = A.length, m = B.length;

    var dp = [], bt = [];
    for (var i = 0; i <= n; i++) {
      dp.push(new Array(m + 1).fill(0));
      bt.push(new Array(m + 1).fill(''));
    }
    for (var i2 = 0; i2 <= n; i2++) { dp[i2][0] = i2; bt[i2][0] = 'U'; }
    for (var j2 = 0; j2 <= m; j2++) { dp[0][j2] = j2; bt[0][j2] = 'L'; }

    for (var i3 = 1; i3 <= n; i3++) {
      for (var j3 = 1; j3 <= m; j3++) {
        var matchCost = (A[i3 - 1] === B[j3 - 1]) ? 0 : 1;
        var sub = dp[i3 - 1][j3 - 1] + matchCost;
        var del = dp[i3 - 1][j3] + 1;
        var ins = dp[i3][j3 - 1] + 1;
        var best = sub, dir = 'D';
        if (del < best) { best = del; dir = 'U'; }
        if (ins < best) { best = ins; dir = 'L'; }
        dp[i3][j3] = best; bt[i3][j3] = dir;
      }
    }

    var ops = [], extras = [];
    var x = n, y = m;
    while (x > 0 || y > 0) {
      var d = bt[x][y];
      if (d === 'D') {
        ops.unshift({ ref: refRaw[x - 1], status: (A[x - 1] === B[y - 1]) ? 'correct' : 'wrong', heard: hypRaw[y - 1] });
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
    var score = (n + m > 0) ? Math.round(100 * 2 * correct / (n + m)) : 0;
    if (score < 0) score = 0;
    if (score > 100) score = 100;

    return {
      ops: ops, extras: extras,
      correct: correct, wrong: wrong, missing: missing, extra: extra,
      refWords: n, hypWords: m, score: score
    };
  }

  /**
   * 单词级“规范化后精确识别”。
   * 识别文本可能带语气词/拆词，判定规则：
   *   - 全部归一化 token 拼接后 == 目标词归一化（容忍 "grass hopper" 拆成两词）；
   *   - 或单 token 与目标词归一化完全相等。
   * 只要出现多余的实义词即判错（精确匹配，不做模糊音素评分）。
   * @returns {pass:boolean, target:string, tokens:string[], joined:string}
   */
  function checkWord(refWord, heardText) {
    var tokens = normalizeText(heardText);
    var target = normalizeWord(refWord);
    var joined = tokens.join('');
    var pass = !!target && (
      (tokens.length === 1 && tokens[0] === target) ||
      (joined === target && tokens.length > 0)
    );
    return { pass: pass, target: target, tokens: tokens, joined: joined };
  }

  function pushLimited(list, rec, max) {
    max = max || 50;
    return (list || []).concat([rec]).slice(-max);
  }

  var builtinCore = {
    normalizeWord: normalizeWord,
    normalizeText: normalizeText,
    alignWords: alignWords,
    checkWord: checkWord,
    pushLimited: pushLimited,
    fixQuotes: fixQuotes
  };

  /** 运行时取对齐核心：优先复用 shadowing.js 的 ShadowingCore，否则内置兜底 */
  function getCore() {
    try {
      if (typeof window !== 'undefined' && window.ShadowingCore && typeof window.ShadowingCore.alignWords === 'function') {
        return window.ShadowingCore;
      }
    } catch (e) { /* ignore */ }
    return builtinCore;
  }

  /* ================= 事件桥（防御性） ================= */
  function safeEvent(name, payload) {
    try {
      var E = (typeof window !== 'undefined') ? window.Eng30Events : null;
      if (E && typeof E[name] === 'function') E[name](payload);
    } catch (e) { /* 事件失败不影响主流程 */ }
  }

  /* ================= 持久化（独立命名空间） ================= */
  var HIST_KEY = 'eng30_vocab_speaking_v1';
  var WRONG_MAX = 50;     // 错词历史限量
  var WORD_HIST_MAX = 20; // 每词尝试历史限量

  function loadStore() {
    try {
      var raw = Eng30Storage.get(HIST_KEY);
      if (raw) {
        var p = JSON.parse(raw);
        if (p && typeof p === 'object') {
          p.words = p.words || {};
          p.wrongList = Array.isArray(p.wrongList) ? p.wrongList : [];
          return p;
        }
      }
    } catch (e) { /* ignore */ }
    return { words: {}, wrongList: [] };
  }

  function saveStore(store) {
    try { Eng30Storage.set(HIST_KEY, JSON.stringify(store)); } catch (e) { /* ignore */ }
  }

  /* ================= 盒子主体 ================= */
  function VspBox(container, dayData, opts) {
    var self = this;
    this.container = typeof container === 'string' ? document.getElementById(container) : container;
    if (!this.container) throw new Error('[vocab-speaking] 挂载容器不存在');
    this.dayData = dayData || {};
    this.opts = opts || {};

    // 单词列表：默认取 dayData.words
    this.words = Array.isArray(this.dayData.words) ? this.dayData.words.slice() : [];
    this.dayNum = this.dayData.day || null;

    // 识别能力探测
    this.recCtor = (typeof window !== 'undefined') && (window.SpeechRecognition || window.webkitSpeechRecognition) || null;
    this.recSupported = !!this.recCtor;
    this.rec = null;
    this.permissionDenied = false;
    this.isFileProtocol = (typeof location !== 'undefined' && location.protocol === 'file:');
    this.isInsecureContext = location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1';

    // 流程状态
    this.idx = 0;                 // 当前词下标
    this.stage = 'demo';          // demo | rec | fb
    this.busy = false;            // TTS/识别进行中
    this.redoQueue = [];          // 错词重练队列
    this.isRedoSession = false;
    this.sessionResults = [];     // 本次练习每词结果 {word, pass, manual}
    this.attemptStartTs = Date.now();
    this.mediaRec = null; this.micStream = null; this.recChunks = []; this.lastRecordingBlob = null; this.recordingOutcome = null;

    this._pendingListener = function () { self._refreshPending(); };
    window.addEventListener('eng30-pending-speech-scan', this._pendingListener);
    window.addEventListener('eng30-pending-speech-change', this._pendingListener);
    this._buildDom();
    this._bind();
    this._renderNotice();
    this._gotoDemo();
    this._refreshPending();
  }

  VspBox.prototype._buildDom = function () {
    var c = this.container;
    c.classList.add('vsp-box');
    c.innerHTML =
      '<div class="vsp-head"><h3>\uD83D\uDDE3\uFE0F 单词听说练习</h3>' +
      '<button type="button" class="vsp-mini" data-act="reload">\u91CD\u8BFB\u672C\u5929\u5355\u8BCD</button></div>' +
      '<p class="vsp-note">\u5148\u542C\u793A\u8303\u518D\u8DDF\u8BFB\uFF0C\u7CFB\u7EDF\u6309\u8BCD\u672C\u8EAB\u7CBE\u786E\u5BF9\u6BD4\u3001\u4F8B\u53E5\u6309\u8BCD\u5E8F\u5BF9\u9F50\uFF08\u5BF9/\u9519/\u6F0F/\u591A\uFF09\u3002' +
      '<b>\u6587\u672C\u51C6\u786E\u5EA6\u4EC5\u4F9B\u53C2\u8003\uFF0C\u4E0D\u662F\u4E13\u4E1A\u97F3\u7D20/\u53D1\u97F3\u8BC4\u5206</b>\u3002</p>' +
      '<div class="vsp-warn hidden" data-ref="warn"></div>' +

      '<div class="vsp-progress-row">' +
        '<span class="vsp-step" data-ref="step">0 / 0</span>' +
        '<div class="vsp-bar"><div class="vsp-bar-fill" data-ref="barfill"></div></div>' +
        '<span class="vsp-statusdot" data-ref="dot"></span>' +
      '</div>' +

      '<div class="vsp-wordcard">' +
        '<div class="vsp-wordline">' +
          '<span class="vsp-word" data-ref="word">\u2014</span>' +
          '<span class="vsp-phonetic" data-ref="phonetic"></span>' +
          '<span class="vsp-pos" data-ref="pos"></span>' +
        '</div>' +
        '<div class="vsp-meaning" data-ref="meaning"></div>' +
        '<div class="vsp-example"><span class="vsp-example-label">\u4F8B\u53E5\uFF1A</span><span data-ref="example"></span></div>' +
      '</div>' +

      '<!-- 阶段：听示范 -->' +
      '<div class="vsp-stage" data-stage="demo">' +
        '<div class="vsp-actions">' +
          '<button type="button" class="vsp-btn" data-act="sayWord">\uD83D\uDD0A \u6807\u51C6\u53D1\u97F3</button>' +
          '<button type="button" class="vsp-btn" data-act="saySlow">\uD83D\uDC22 \u6162\u901F\u64AD\u653E</button>' +
          '<button type="button" class="vsp-btn" data-act="sayExample">\uD83D\uDCD6 \u4F8B\u53E5\u6717\u8BFB</button>' +
        '</div>' +
        '<div class="vsp-actions vsp-actions-center">' +
          '<button type="button" class="vsp-btn primary" data-act="start">\uD83C\uDFA4 \u5F00\u59CB\u8DDF\u8BFB\u5355\u8BCD</button>' +
        '</div>' +
      '</div>' +

      '<!-- 阶段：跟读中 -->' +
      '<div class="vsp-stage hidden" data-stage="rec">' +
        '<div class="vsp-rec-state" data-ref="recState">\u6B63\u5728\u64AD\u653E\u793A\u8303\uFF0C\u542C\u5B8C\u540E\u8DDF\u8BFB\u2026</div>' +
        '<div class="vsp-actions vsp-actions-center"><button type="button" class="vsp-btn primary" data-act="startMic">🎤 我已听完，开始录音</button></div>' +
        '<div class="vsp-live-dot"></div>' +
      '</div>' +

      '<!-- 阶段：反馈 -->' +
      '<div class="vsp-stage hidden" data-stage="fb">' +
        '<div class="vsp-heard hidden" data-ref="heard"></div>' +
        '<div class="vsp-verdict" data-ref="verdict"></div>' +
        '<div class="vsp-align hidden" data-ref="align"></div>' +
        '<div class="vsp-actions">' +
          '<button type="button" class="vsp-btn" data-act="rerecord">一键重新评分 · \uD83D\uDD01 \u91CD\u5F55</button>' +
          '<button type="button" class="vsp-btn" data-act="sayExampleAgain">\uD83D\uDCD6 \u542C\u4F8B\u53E5</button>' +
          '<button type="button" class="vsp-btn" data-act="recExample">\uD83C\uDFA4 \u8DDF\u8BFB\u4F8B\u53E5</button>' +
          '<button type="button" class="vsp-btn" data-act="playback">▶ 回放旧录音</button>' +
          '<button type="button" class="vsp-btn" data-act="next">\u4E0B\u4E00\u4E2A \u203A</button>' +
        '</div>' +
        '<div class="vsp-actions">' +
          '<button type="button" class="vsp-btn ghost hidden" data-act="redoWrong">\uD83D\uDD01 \u91CD\u505A\u9519\u8BCD</button>' +
        '</div>' +
      '</div>' +

      '<audio class="hidden" controls data-ref="audio"></audio>' +
      '<!-- 结尾总结 -->' +
      '<div class="vsp-summary hidden" data-ref="summary"></div>' +

      '<div class="vsp-history" data-ref="history"></div>';

    var self = this;
    this.els = {};
    c.querySelectorAll('[data-ref]').forEach(function (el) { self.els[el.getAttribute('data-ref')] = el; });
    this.btns = {};
    c.querySelectorAll('[data-act]').forEach(function (b) {
      var k = b.getAttribute('data-act');
      (self.btns[k] = self.btns[k] || []).push(b);
    });
  };

  VspBox.prototype._bind = function () {
    var self = this;
    this.container.querySelectorAll('[data-act]').forEach(function (btn) {
      btn.addEventListener('click', function () { self._onAction(btn.getAttribute('data-act')); });
    });
  };

  /* ---------- 按钮禁用态 ---------- */
  VspBox.prototype._setBtn = function (act, disabled) {
    (this.btns[act] || []).forEach(function (b) { b.disabled = !!disabled; });
  };

  /** 互斥锁：TTS 占用时禁用跟读类按钮；识别占用时禁用听示范按钮 */
  VspBox.prototype._applyMutexUI = function () {
    var speaking = this.busy === 'tts';
    var recing = this.busy === 'rec';
    this._setBtn('sayWord', recing);
    this._setBtn('saySlow', recing);
    this._setBtn('sayExample', recing);
    this._setBtn('sayExampleAgain', recing);
    this._setBtn('start', speaking || recing);
    this._setBtn('rerecord', speaking || recing);
    this._setBtn('recExample', speaking || recing || !this._micUsable());
    this._setBtn('redoWrong', speaking || recing);
  };

  VspBox.prototype._micUsable = function () {
    return this.recSupported && !this.permissionDenied && !this.isFileProtocol && !this.isInsecureContext;
  };

  /* ---------- 降级提示 ---------- */
  VspBox.prototype._renderNotice = function () {
    var w = this.els.warn;
    var msgs = [];
    if (!this.words.length) {
      msgs.push('\u26A0\uFE0F \u5F53\u5929\u6CA1\u6709\u53EF\u7EC3\u4E60\u7684\u5355\u8BCD\uFF08dayData.words \u4E3A\u7A7A\uFF09\u3002');
    }
    if (this.isInsecureContext) { msgs.push('🔒 Web Speech 需要 HTTPS；失败时保存录音，不提供手动自评。联网后请一键重新评分。'); } else if (!this.recSupported) {
      msgs.push('\u26A0\uFE0F \u5F53\u524D\u6D4F\u89C8\u5668\u4E0D\u652F\u6301\u8BED\u97F3\u8BC6\u522B\uFF08\u9700 iOS Safari 17+ / Chrome\uFF09\u3002' +
        '\u5DF2\u964D\u7EA7\u4E3A\u300C\u542C\u6807\u51C6\u6717\u8BFB + \u81EA\u8BC4\u300D\uFF1A\u542C\u5B8C\u540E\u81EA\u5DF1\u8DDF\u8BFB\u4E00\u904D\uFF0C\u518D\u624B\u52A8\u9009\u300C\u6211\u8BFB\u5BF9\u4E86\u300D\u3002');
    } else if (this.isFileProtocol) {
      msgs.push('\u26A0\uFE0F \u5F53\u524D\u4E3A\u672C\u5730 file:// \u6253\u5F00\uFF0C\u6D4F\u89C8\u5668\u901A\u5E38\u7981\u6B62\u8BED\u97F3\u8BC6\u522B\u3002' +
        '\u82E5\u8BC6\u522B\u5931\u8D25\uFF0C\u8BF7\u7528 Safari \u6DFB\u52A0\u5230\u4E3B\u5C4F\u5E55\u540E\u4F53\u9A8C\uFF0C\u6216\u5148\u542C\u6807\u51C6\u6717\u8BFB\u81EA\u8BC4\u3002');
    }
    if (msgs.length) {
      w.innerHTML = msgs.join('<br>');
      w.classList.remove('hidden');
    } else {
      w.classList.add('hidden');
    }
  };

  /* ---------- 流程导航 ---------- */
  VspBox.prototype._current = function () {
    return this.words[this.idx] || null;
  };

  VspBox.prototype._showStage = function (name) {
    var self = this;
    this.stage = name;
    this.container.querySelectorAll('.vsp-stage').forEach(function (el) {
      el.classList.toggle('hidden', el.getAttribute('data-stage') !== name);
    });
  };

  VspBox.prototype._gotoDemo = function () {
    this.stopTTS();
    this.stopRecognition();
    var wd = this._current();
    if (!wd) { this._renderSummary(); return; }
    this.els.word.textContent = wd.word || '';
    this.els.phonetic.textContent = wd.phonetic || '';
    this.els.pos.textContent = wd.pos || '';
    this.els.meaning.textContent = (wd.pos ? wd.pos + ' ' : '') + (wd.meaning || '');
    this.els.example.textContent = wd.example || '';
    this.els.heard.classList.add('hidden');
    this.els.verdict.innerHTML = '';
    this.els.align.classList.add('hidden');
    this.els.summary.classList.add('hidden');
    this._showStage('demo');
    this._renderProgress();
  };

  VspBox.prototype._renderProgress = function () {
    var total = this.words.length;
    this.els.step.textContent = (this.idx + 1) + ' / ' + total;
    this.els.barfill.style.width = total ? (this.idx / total * 100) + '%' : '0%';
    var dot = this.els.dot;
    var res = this.sessionResults[this.idx];
    dot.className = 'vsp-statusdot' + (res ? (res.pass ? ' ok' : ' bad') : '');
    dot.textContent = res ? (res.pass ? '\u2713' : '\u2717') : '';
  };

  VspBox.prototype._onAction = function (act) {
    switch (act) {
      case 'reload': this.sessionResults = []; this.idx = 0; this.isRedoSession = false; this._gotoDemo(); break;
      case 'sayWord': this.sayWord(1.0); break;
      case 'saySlow': this.sayWord(0.5); break;
      case 'sayExample':
      case 'sayExampleAgain': this.sayExample(); break;
      case 'start': this.startPractice(); break;
      case 'startMic': this.openMic(this.pendingMicResult); break;
      case 'rerecord': this.openMic(null); break;
      case 'recExample': this.startExampleRec(); break;
      case 'next': this._next(); break;
      case 'redoWrong': this._startRedoSession(); break;
      case 'playback': if (window.Eng30SpeechFallback) window.Eng30SpeechFallback.playLatest(this._speechMeta(), this.els.audio).catch(function () {}); break;
    }
  };

  VspBox.prototype._next = function () {
    if (this.idx + 1 >= this.words.length) { this._renderSummary(); return; }
    this.idx++;
    this._gotoDemo();
  };

  /** 进入错词重练：把错词按序重排队列 */
  VspBox.prototype._startRedoSession = function () {
    var self = this;
    var wrongIdx = [];
    this.sessionResults.forEach(function (r, i) { if (!r.pass) wrongIdx.push(i); });
    if (!wrongIdx.length) return;
    safeEvent('recordRedo', { day: this.dayNum, module: 'vocab_speaking', words: wrongIdx.map(function (i) { return self.words[i].word; }) });
    this.words = wrongIdx.map(function (i) { return self.words[i]; });
    this.sessionResults = this.sessionResults.slice(0, 0); // 新队列重新计
    this.isRedoSession = true;
    this.idx = 0;
    this._gotoDemo();
  };

  /* ================= TTS（标准朗读） ================= */
  VspBox.prototype.stopTTS = function () {
    try { if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}
    if (this.busy === 'tts') this.busy = false;
    this._applyMutexUI();
  };

  VspBox.prototype._ttsRate = function (mult) {
    var base = 1.0;
    // 统一走 Eng30TTS.getRate()（已钳制 [0.6,1.0]、默认0.75）；未加载时回退旧逻辑
    try {
      if (typeof Eng30TTS !== 'undefined' && Eng30TTS && typeof Eng30TTS.getRate === 'function') {
        base = Eng30TTS.getRate();
      } else if (typeof state !== 'undefined' && state.settings && state.settings.ttsRate) {
        base = state.settings.ttsRate;
      }
    } catch (e) {}
    var r = base * (mult || 1);
    return Math.max(0.4, Math.min(1.1, r));
  };

  /** 朗读任意文本；onend 无论正常结束/出错都回调一次 */
  VspBox.prototype._speak = function (text, mult, onend) {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      this.els.warn.classList.remove('hidden');
      this.els.warn.textContent = '\u26A0\uFE0F \u5F53\u524D\u6D4F\u89C8\u5668\u4E0D\u652F\u6301\u8BED\u97F3\u5408\u6210\uFF08\u6807\u51C6\u6717\u8BFB\uFF09\u3002';
      if (onend) onend();
      return;
    }
    this.stopRecognition(); // TTS 启动前必停识别（互斥）
    this.stopTTS();
    this.busy = 'tts';
    this._applyMutexUI();

    var u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = this._ttsRate(mult);
    var fired = false;
    var done = function () { if (fired) return; fired = true; self.stopTTS(); if (onend) onend(); };
    var self = this;
    u.onend = done;
    u.onerror = done;
    window.speechSynthesis.speak(u);
    // 兜底：部分浏览器 onend 不可靠
    var est = Math.max(1200, String(text).split(/\s+/).length * 500 * (1 / (mult || 1)));
    setTimeout(done, est + 800);
  };

  VspBox.prototype.sayWord = function (mult) {
    var wd = this._current();
    if (wd) this._speak(wd.word, mult, null);
  };

  VspBox.prototype.sayExample = function () {
    var wd = this._current();
    if (wd && wd.example) this._speak(wd.example, 0.9, null);
  };

  /* ================= 语音识别 ================= */
  VspBox.prototype.stopRecognition = function () {
    try { if (this.rec) { this.rec.onresult = null; this.rec.onerror = null; this.rec.onend = null; this.rec.abort(); } } catch (e) {}
    this.rec = null;
    if (this.busy === 'rec') this.busy = false;
    this._applyMutexUI();
  };

  /**
   * 跟读主流程：先播放标准示范音，结束后自动开麦。
   * 麦克风不可用（不支持/权限拒绝）→ 降级为自评。
   */
  VspBox.prototype.startPractice = function () {
    var self = this;
    var wd = this._current();
    if (!wd) return;
    this.attemptStartTs = Date.now();
    this._showStage('rec');
    this.els.recState.textContent = '\u6B63\u5728\u64AD\u653E\u793A\u8303\uFF0C\u542C\u5B8C\u540E\u8DDF\u8BFB\u2026';

    if (!this._micUsable()) { this._speak(wd.word, 1.0, function () { self.els.recState.textContent='示范结束。点录音按钮保存本次跟读；不生成手动分数。'; }); return; }

    this.pendingMicResult = null;
    this._speak(wd.word, 1.0, function () { self.els.recState.textContent = '示范结束。请点“我已听完，开始录音”（必须由用户手势启动）。'; });
  };

  VspBox.prototype._speechMeta = function () { var wd=this._current()||{}; return { day:this.dayNum, module:'vocab_speaking', itemId:String(wd.word||this.idx), prompt:wd.word||'', attempts:1 }; };
  VspBox.prototype._startRecorder = function () {
    var self=this; if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder==='undefined') return;
    navigator.mediaDevices.getUserMedia({audio:true}).then(function (stream) { self.micStream=stream; self.mediaRec=new MediaRecorder(stream); self.recChunks=[]; self.mediaRec.ondataavailable=function(e){if(e.data&&e.data.size)self.recChunks.push(e.data);}; self.mediaRec.onstop=function(){ if(self.recChunks.length){self.lastRecordingBlob=new Blob(self.recChunks,{type:self.mediaRec.mimeType||'audio/webm'});self._persistRecording();} stream.getTracks().forEach(function(t){t.stop();});self.micStream=null;}; self.mediaRec.start(); }).catch(function(){ self.els.recState.textContent='无法取得麦克风权限，未保存录音。'; });
  };
  VspBox.prototype._stopRecorder = function () { try { if(this.mediaRec&&this.mediaRec.state!=='inactive')this.mediaRec.stop(); } catch(_){} };
  VspBox.prototype._persistRecording = function () { if(!this.lastRecordingBlob||!this.recordingOutcome||!window.Eng30SpeechFallback)return;var b=this.lastRecordingBlob,o=this.recordingOutcome;this.lastRecordingBlob=null;this.recordingOutcome=null;window.Eng30SpeechFallback.saveAttempt(this._speechMeta(),b,o.succeeded,o.error).catch(function(){}); };
  VspBox.prototype._refreshPending = function () { var self=this;if(!window.Eng30SpeechFallback)return;window.Eng30SpeechFallback.list(this._speechMeta()).then(function(rows){if(rows.length&&!self.busy)self.els.warn.textContent='有 '+rows.length+' 条待重新评分录音；联网只会标记可重试，必须点击“一键重新评分”重新启麦。';}); };
  VspBox.prototype.openMic = function (onResult) {
    var self = this;
    this.stopTTS(); // 识别启动前必停 TTS（互斥）
    this.onMicResult = typeof onResult === 'function' ? onResult : function (t) { self._onWordHeard(t); };
    this.els.recState.textContent = '\uD83C\uDFA4 \u8BF7\u8DDF\u8BFB\u5355\u8BCD\uFF1A' + (this._current() ? this._current().word : '');

    this._startRecorder();
    if (!this._micUsable()) { this.recordingOutcome={succeeded:false,error:'web-speech-unavailable'}; this.busy='rec'; this.els.recState.textContent='正在保存录音（不手动评分）…再次点录音按钮可停止。'; var box=this; setTimeout(function(){box._stopRecorder();box._persistRecording();box.busy=false;box._applyMutexUI();box.els.recState.textContent='录音已保存。请在 HTTPS 且 Web Speech 可用时点“一键重新评分”。';},10000); return; }

    var r = new this.recCtor();
    r.lang = 'en-US';
    r.continuous = false;
    r.interimResults = false;
    this.rec = r;

    r.onresult = function (e) {
      var text = '';
      for (var i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      self.recordingOutcome={succeeded:!!text.trim(),error:text.trim()?'':'no-speech'}; self._stopRecorder(); self.onMicResult(text.trim()); self._persistRecording();
    };
    r.onerror = function (e) {
      self.recordingOutcome={succeeded:false,error:e.error||'recognition-error'}; self._stopRecorder(); self._persistRecording();
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        self.permissionDenied = true;
        self.els.warn.classList.remove('hidden');
        self.els.warn.textContent = '\uD83D\uDEAB \u9EA6\u514B\u98CE\u6743\u9650\u88AB\u62D2\u7EDD\uFF01\u8BF7\u5728\u6D4F\u89C8\u5668\u8BBE\u7F6E\u4E2D\u5141\u8BB8\u9EA6\u514B\u98CE\uFF0C' +
          '无法自动评分；本次录音会保留，不提供手动自评。';
        self.els.recState.textContent='权限被拒，无法自动评分；不提供手动自评。';
      } else if (e.error === 'no-speech') {
        self.els.recState.textContent = '\u6CA1\u6709\u8BC6\u522B\u5230\u8BED\u97F3\uFF0C\u70B9\u300C\u91CD\u5F55\u300D\u518D\u8BD5\u4E00\u6B21\u3002';
        self.stopRecognition();
      } else if (e.error === 'network') {
        self.els.warn.classList.remove('hidden');
        self.els.warn.textContent = 'Web Speech 网络识别失败；录音已保存，网络恢复后可一键重新评分。';
        self.els.recState.textContent='识别失败，录音已保存；联网后点“一键重新评分”。';
      } else {
        self.els.recState.textContent = '\u8BC6\u522B\u5931\u8D25\uFF08' + (e.error || 'unknown') + '\uFF09\uFF0C\u70B9\u300C\u91CD\u5F55\u300D\u91CD\u8BD5\u3002';
        self.stopRecognition();
      }
    };
    r.onend = function () { self.stopRecognition(); };

    try { r.start(); this.busy = 'rec'; this._applyMutexUI(); }
    catch (err) { this.els.recState.textContent = '\u65E0\u6CD5\u542F\u52A8\u8BC6\u522B\uFF0C\u8BF7\u91CD\u8BD5\u3002'; }
  };

  /* ---------- 单词识别结果 ---------- */
  VspBox.prototype._onWordHeard = function (heard) {
    var wd = this._current();
    if (!wd) return;
    if (!heard) {
      this.els.recState.textContent = '\u6CA1\u6709\u8BC6\u522B\u5230\u8BED\u97F3\uFF0C\u70B9\u300C\u91CD\u5F55\u300D\u518D\u8BD5\u4E00\u6B21\u3002';
      return;
    }
    var core = getCore();
    var chk = core.checkWord(wd.word, heard);
    this._recordAttempt(wd, { pass: chk.pass, heard: heard, manual: false, exampleScore: null });
    this._renderWordFeedback(wd, heard, chk.pass, false);
  };

  /* ---------- 例句跟读（按词序对齐） ---------- */
  VspBox.prototype.startExampleRec = function () {
    var self = this;
    var wd = this._current();
    if (!wd || !wd.example) return;
    if (!this._micUsable()) {
      this.els.warn.classList.remove('hidden');
      this.els.warn.textContent = '\u26A0\uFE0F \u5F53\u524D\u4E0D\u652F\u6301\u8BED\u97F3\u8BC6\u522B\uFF0C\u65E0\u6CD5\u8DDF\u8BFB\u4F8B\u53E5\uFF0C\u53EF\u5148\u542C\u4F8B\u53E5\u6717\u8BFB\u3002';
      return;
    }
    this.els.recState.textContent = '\u6B63\u5728\u64AD\u653E\u4F8B\u53E5\u793A\u8303\uFF0C\u542C\u5B8C\u540E\u8DDF\u8BFB\u6574\u53E5\u2026';
    this._showStage('rec');
    this.pendingMicResult = function (value) { self._onExampleHeard(value); };
    this._speak(wd.example, 0.9, function () { self.els.recState.textContent = '例句示范结束。请点“我已听完，开始录音”。'; });
  };

  VspBox.prototype._onExampleHeard = function (heard) {
    var wd = this._current();
    if (!wd) return;
    this._showStage('fb'); // 回反馈页展示对齐结果
    if (!heard) {
      this.els.recState.textContent = '';
      var al = this.els.align;
      al.classList.remove('hidden');
      al.innerHTML = '<div class="vsp-align-note">\u4F8B\u53E5\u6CA1\u6709\u8BC6\u522B\u5230\u8BED\u97F3\uFF0C\u53EF\u518D\u6B21\u300C\u8DDF\u8BFB\u4F8B\u53E5\u300D\u3002</div>';
      return;
    }
    var core = getCore();
    var res = core.alignWords(wd.example, heard);
    this._renderAlign(wd.example, heard, res);
  };

  /** 渲染例句按词序对齐：正确/错/漏/多词 着色 */
  VspBox.prototype._renderAlign = function (ref, heard, res) {
    var al = this.els.align;
    al.classList.remove('hidden');
    var html = '<div class="vsp-align-title">\u4F8B\u53E5\u8DDF\u8BFB\u5BF9\u6BD4\uFF08\u6587\u672C\u51C6\u786E\u5EA6 ' +
      res.score + '\uFF0C\u975E\u97F3\u7D20\u8BC4\u5206\uFF09</div><div class="vsp-align-words">';
    var self = this;
    res.ops.forEach(function (op) {
      html += '<span class="vsp-aw vsp-aw-' + op.status + '">' + self._esc(op.ref);
      if (op.status === 'wrong' && op.heard) html += '<sup>' + self._esc(op.heard) + '</sup>';
      html += '</span> ';
    });
    res.extras.forEach(function (ex) {
      html += '<span class="vsp-aw vsp-aw-extra">' + self._esc(ex.heard) + '</span> ';
    });
    html += '</div><div class="vsp-align-count">\u6B63\u786E ' + res.correct + ' \u00B7 \u9519 ' + res.wrong +
      ' \u00B7 \u6F0F ' + res.missing + ' \u00B7 \u591A ' + res.extra + '</div>';
    al.innerHTML = html;
  };

  /* ---------- 反馈渲染 ---------- */
  VspBox.prototype._renderWordFeedback = function (wd, heard, pass, manual) {
    this._showStage('fb');
    var heardEl = this.els.heard;
    heardEl.classList.remove('hidden');
    heardEl.innerHTML = '\u8BC6\u522B\u5230\uFF1A<span></span>';
    heardEl.querySelector('span').textContent = heard;

    var v = this.els.verdict;
    if (pass) {
      v.innerHTML = '<div class="vsp-verdict-line ok">\u2705 \u8BCD\u8BFB\u5BF9\u4E86' +
        (manual ? '\uFF08\u81EA\u8BC4\uFF09' : '') + '</div>' +
        '<div class="vsp-verdict-sub">\u7EE7\u7EED\u4E0B\u4E00\u4E2A\uFF0C\u6216\u91CD\u5F55\u7CBE\u8FDB\u3002</div>';
    } else {
      v.innerHTML = '<div class="vsp-verdict-line bad">\u274C \u8FD8\u4E0D\u591F\u51C6\uFF1A\u5E94\u8BF4\u300C' +
        this._esc(wd.word) + '\u300D</div>' +
        '<div class="vsp-verdict-sub">\u53EF\u5148\u300C\u542C\u4F8B\u53E5\u300D\u611F\u53D7\u8BFB\u6CD5\uFF0C\u518D\u300C\u91CD\u5F55\u300D\u3002</div>';
    }

    // 错词重练按钮（有任意错词时出现）
    var hasWrong = this.sessionResults.some(function (r) { return !r.pass; });
    this._setBtn('redoWrong', !hasWrong);
    (this.btns.redoWrong || []).forEach(function (b) { b.classList.toggle('hidden', !hasWrong); });

    this._renderProgress();
    this._renderHistory();
  };

  VspBox.prototype._esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
    });
  };

  /* ---------- 统计：每词正确/错误/尝试、最近/最好、错词历史 ---------- */
  VspBox.prototype._recordAttempt = function (wd, res) {
    var store = loadStore();
    var key = normalizeWord(wd.word);
    var rec = store.words[key] || {
      word: wd.word, attempts: 0, correct: 0, wrong: 0,
      best: 0, last: null, history: []
    };
    rec.attempts += 1;
    if (res.pass) rec.correct += 1; else rec.wrong += 1;
    var score = res.pass ? 100 : 0;
    if (score > rec.best) rec.best = score;
    rec.last = { ts: Date.now(), pass: res.pass, heard: res.heard, manual: res.manual, day: this.dayNum };
    rec.history = pushLimited(rec.history, rec.last, WORD_HIST_MAX);
    store.words[key] = rec;

    if (!res.pass) {
      store.wrongList = pushLimited(store.wrongList, {
        ts: Date.now(), day: this.dayNum, word: wd.word, heard: res.heard
      }, WRONG_MAX);
    }
    saveStore(store);

    // 会话结果（用于错词重练）：首attempt落状态；读对即升级为通过，重录读错不覆盖已通过
    var prev = this.sessionResults[this.idx];
    if (res.pass || !prev) {
      this.sessionResults[this.idx] = { word: wd.word, pass: !!res.pass, manual: !!res.manual };
    }

    // 事件桥：仅作为“一次练习记录”上报，绝不触碰艾宾浩斯“已记住”
    safeEvent('recordAttempt', {
      day: this.dayNum,
      module: 'vocab_speaking',
      itemId: normalizeWord(wd.word),
      word: wd.word,
      pass: res.pass,
      heard: res.heard,
      manual: !!res.manual,
      attempts: rec.attempts,
      score: res.pass ? 100 : 0,
      total: 1,
      wrongWords: res.pass ? [] : [wd.word],
      durationMs: Math.max(0, Date.now() - (this.attemptStartTs || Date.now())),
      timestamp: Date.now()
    });
  };

  /* ---------- 总结 ---------- */
  VspBox.prototype._renderSummary = function () {
    this.stopTTS(); this.stopRecognition();
    this._showStage('demo');
    var total = this.sessionResults.length;
    var pass = this.sessionResults.filter(function (r) { return r.pass; }).length;
    var el = this.els.summary;
    el.classList.remove('hidden');
    el.innerHTML =
      '<div class="vsp-summary-title">' + (this.isRedoSession ? '\u9519\u8BCD\u91CD\u7EC3\u5B8C\u6210' : '\u672C\u5929\u5355\u8BCD\u7EC3\u4E60\u5B8C\u6210') + '</div>' +
      '<div class="vsp-summary-line">\u672C\u8F6E\u901A\u8FC7 <b>' + pass + '</b> / ' + total + '</div>' +
      '<div class="vsp-summary-sub">\u672C\u6A21\u5757\u4EC5\u8BB0\u5F55\u7EC3\u4E60\u6B21\u6570\uFF0C\u4E0D\u4F1A\u81EA\u52A8\u6807\u8BB0\u300C\u5DF2\u8BB0\u4F4F\u300D\uFF1B' +
      '\u662F\u5426\u8BB0\u4F4F\u4ECD\u7531\u539F\u6709\u300C\u8BB0\u4F4F / \u6CA1\u8BB0\u4F4F\u300D\u6309\u94AE\u7BA1\u7406\u3002</div>';
    this._renderHistory();
  };

  /* ---------- 历史（最近/最好） ---------- */
  VspBox.prototype._renderHistory = function () {
    var store = loadStore();
    var el = this.els.history;
    var words = Object.keys(store.words);
    if (!words.length) { el.innerHTML = ''; return; }
    var totalAtt = 0, totalCorr = 0;
    var latestWord = null, bestWord = null;
    words.forEach(function (k) {
      var r = store.words[k];
      totalAtt += r.attempts;
      totalCorr += r.correct;
      if (!latestWord || (r.last && r.last.ts > latestWord.last.ts)) latestWord = r;
      if (!bestWord || r.best > bestWord.best) bestWord = r;
    });
    var acc = totalAtt ? Math.round(100 * totalCorr / totalAtt) : 0;
    el.innerHTML =
      '<h4>\u7D2F\u8BA1\u7EC3\u4E60</h4>' +
      '<div class="vsp-hist-row">' +
        '<span>\u603B\u5C1D\u8BD5 <b>' + totalAtt + '</b></span>' +
        '<span>\u6B63\u786E\u7387 <b>' + acc + '%</b></span>' +
        '<span>\u6700\u8FD1 <b>' + (latestWord && latestWord.last ? latestWord.word : '--') + '</b></span>' +
      '</div>' +
      (store.wrongList.length
        ? '<div class="vsp-hist-row vsp-hist-wrong">\u9519\u8BCD\u8868\uFF08\u6700\u8FD1 ' + store.wrongList.length + '\uFF09\uFF1A' +
          store.wrongList.slice(-5).map(function (w) { return '<span>' + w.word + '</span>'; }).join('') + '</div>'
        : '');
  };

  /* ================= 对外入口 ================= */
  var instance = null;

  function mount(container, dayData, options) {
    if (instance) { try { instance.container.innerHTML = ''; } catch (e) {} }
    instance = new VspBox(container, dayData, options);
    return instance;
  }

  function refresh(dayData) {
    if (!instance) return;
    if (dayData) instance.dayData = dayData;
    instance.dayNum = instance.dayData.day || null;
    instance.sessionResults = [];
    instance.words = Array.isArray(instance.dayData.words) ? instance.dayData.words.slice() : [];
    instance.idx = 0;
    instance._gotoDemo();
  }

  /* Node / 浏览器双端导出 */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = builtinCore;
  }
  global.VocabSpeaking = {
    mount: mount, refresh: refresh, core: builtinCore,
    stopAll: function () { if (instance) { instance.stopTTS(); instance.stopRecognition(); } }
  };
  global.VocabSpeakingCore = builtinCore;

})(typeof window !== 'undefined' ? window : globalThis);
