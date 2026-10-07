/* ============================================================
 * tts-controller.js — 统一 TTS 控制器（Eng30TTS）
 * ------------------------------------------------------------
 * 目标：
 *  - 全局唯一朗读入口，app.js / vocab-speaking / typing-dictation
 *    统一走这里，避免双控制器。
 *  - 语速档位：0.6 慢速 / 0.75 学习(默认) / 0.9 自然 / 1.0 标准。
 *  - 旧值钳制到 [0.6, 1.0]，持久化到 state.settings.ttsRate。
 *  - 全文按句队列，维护 current index 与高亮。
 *  - 播放中改速：cancel 后从「当前句头」自动重播并 toast 提示；
 *    停止后改速：仅持久化，不重播。
 *  - 状态按钮无残留（朗读中=正在朗读，停止/结束后复位）。
 *  - shadowing 另任务：本模块只暴露 getRate()，shadowing 应直接用
 *    Eng30TTS.getRate()，不要再乘 0.9。
 *
 * 测试钩子：Eng30TTS.__test.* （见文件末尾）
 * ============================================================ */
(function (global) {
  'use strict';

  var MIN_RATE = 0.6;
  var MAX_RATE = 1.0;
  var DEFAULT_RATE = 0.75;

  var PRESETS = [
    { rate: 0.6,  label: '慢速' },
    { rate: 0.75, label: '学习' },
    { rate: 0.9,  label: '自然' },
    { rate: 1.0,  label: '标准' }
  ];

  // ---- 内部状态 ----
  var synth = null;
  var Q = {
    active: false,       // 是否有句队列在跑
    sentences: [],
    idx: -1,             // 当前句 index（-1 = 无）
    utter: null,         // 当前 SpeechSynthesisUtterance
    gen: 0,              // 代际号：cancel/改速时 +1，旧 utter 回调失效
    highlightSel: '#reading-text .sentence',
    finished: false,     // 队列自然播完
    onqueueend: null
  };

  function clamp(r) {
    r = parseFloat(r);
    if (isNaN(r)) r = DEFAULT_RATE;
    if (r < MIN_RATE) r = MIN_RATE;
    if (r > MAX_RATE) r = MAX_RATE;
    return r;
  }

  function getSynth() {
    if (synth) return synth;
    if (typeof global !== 'undefined' && global.speechSynthesis) {
      synth = global.speechSynthesis;
    }
    return synth;
  }

  // ---- state / persist 懒读取（app.js 的 state/saveState 可能后定义）----
  function currentRawRate() {
    try {
      if (global.state && global.state.settings &&
          typeof global.state.settings.ttsRate === 'number') {
        return global.state.settings.ttsRate;
      }
    } catch (e) {}
    return DEFAULT_RATE;
  }

  function persist(rate) {
    try {
      if (global.state && global.state.settings) {
        global.state.settings.ttsRate = rate;
      }
      if (typeof global.saveState === 'function') global.saveState();
    } catch (e) {}
  }

  function toast(msg) {
    try {
      if (typeof global.showToast === 'function') { global.showToast(msg); return; }
    } catch (e) {}
    // 兜底：控制台
    // eslint-disable-next-line no-console
    if (typeof console !== 'undefined' && console.log) console.log('[Eng30TTS]', msg);
  }

  // ---- 高亮 ----
  function highlight(idx) {
    try {
      var spans = document.querySelectorAll(Q.highlightSel);
      spans.forEach(function (s, i) { s.classList.toggle('speaking', i === idx); });
    } catch (e) {}
  }

  // ---- 按钮状态（无残留）----
  function setButtons(stateName) {
    try {
      // stateName: 'idle' | 'speaking' | 'paused' | 'ended'
      function setLabel(id, text) {
        var el = document.getElementById(id);
        if (!el) return;
        var span = el.querySelector('span');
        var target = span || el;
        if (stateName === 'speaking' && id === 'tts-play') target.textContent = '正在朗读';
        else if (stateName === 'paused' && id === 'tts-play') target.textContent = '已暂停';
        else target.textContent = text;
        if (id === 'tts-stop') el.disabled = (stateName === 'idle' || stateName === 'ended');
        el.classList.toggle('is-speaking', stateName === 'speaking');
      }
      setLabel('tts-play', '朗读全文');
      setLabel('tts-stop', '停止');
    } catch (e) { /* 无 DOM（测试环境）时静默 */ }
  }

  // ---- 单句播报 ----
  function speakUtter(text, rate, ondone) {
    var s = getSynth();
    if (!s) { toast('当前浏览器不支持语音合成'); if (ondone) ondone('unsupported'); return null; }
    var u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = rate;
    u.pitch = 1.0;
    var myGen = Q.gen;
    var settled = false;
    var finish = function (reason) {
      if (settled) return;
      settled = true;
      if (myGen !== Q.gen) return; // 已被 cancel/改速作废
      if (ondone) ondone(reason);
    };
    u.onend = function () { finish('end'); };
    u.onerror = function (e) { finish('error:' + (e && e.error ? e.error : 'unknown')); };
    Q.utter = u;
    s.speak(u);
    return u;
  }

  // ---- 队列推进 ----
  function queueStep() {
    if (!Q.active) return;
    if (Q.idx >= Q.sentences.length) { endQueue(); return; }
    highlight(Q.idx);
    var rate = clamp(Eng30TTS.getRate());
    speakUtter(Q.sentences[Q.idx], rate, function (reason) {
      if (!Q.active) return;
      Q.idx++;
      queueStep();
    });
    setButtons('speaking');
  }

  function endQueue() {
    Q.active = false;
    Q.finished = true;
    Q.idx = -1;
    Q.utter = null;
    highlight(-1);
    setButtons('idle'); // 结束后按钮复位，无残留
    var cb = Q.onqueueend; Q.onqueueend = null;
    if (cb) cb();
  }

  // ===================== 公开 API =====================
  var Eng30TTS = {
    MIN_RATE: MIN_RATE,
    MAX_RATE: MAX_RATE,
    DEFAULT_RATE: DEFAULT_RATE,
    PRESETS: PRESETS,

    /** 当前生效语速（旧值自动钳制到 [0.6,1.0]） */
    getRate: function () { return clamp(currentRawRate()); },

    /** 单词/例句慢速 = 全局 × 0.8，且不低于 0.5；调用方应清楚标识「慢速」 */
    getWordRate: function () {
      var r = this.getRate() * 0.8;
      if (r < 0.5) r = 0.5;
      return Math.round(r * 100) / 100;
    },

    /**
     * 设置语速：持久化 + 同步 UI。
     * 若正在播放句队列 → cancel 后从「当前句头」自动重播并 toast。
     * 若已停止/空闲 → 仅持久化，不重播。
     */
    setRate: function (r, opts) {
      var nr = clamp(r);
      var wasSpeaking = Q.active && !Q.finished && Q.idx >= 0;
      persist(nr);
      syncRateUI();
      if (wasSpeaking) {
        Q.gen++;                 // 作废旧 utter 回调
        var s = getSynth();
        if (s) { try { s.cancel(); } catch (e) {} }
        Q.utter = null;
        // 从当前句头重播（Q.idx 保持在当前句，queueStep 会高亮并播放它）
        Q.finished = false;
        queueStep();
        toast('语速已切换，从当前句重新朗读（' + this.rateLabel(nr) + '）');
      }
      return nr;
    },

    /** 朗读单段文本（不走队列）。opts.rate 可覆盖全局速率。 */
    speakText: function (text, opts, onend) {
      if (typeof opts === 'function') { onend = opts; opts = null; }
      opts = opts || {};
      Q.gen++; // 打断任何队列
      Q.active = false; Q.finished = false; Q.utter = null;
      highlight(-1);
      var rate = (typeof opts.rate === 'number') ? opts.rate : clamp(Eng30TTS.getRate());
      setButtons('speaking');
      speakUtter(text, rate, function (reason) {
        setButtons('idle');
        if (onend) onend(reason);
      });
    },

    /**
     * 全文按句队列播放。
     * @param {Array} sentences 句子数组
     * @param {Number} startIdx 起始句
     * @param {Object} opts { highlightSelector, onend }
     */
    speakSentences: function (sentences, startIdx, opts) {
      opts = opts || {};
      this.stop({ silent: true });
      Q.active = true;
      Q.finished = false;
      Q.sentences = sentences || [];
      Q.idx = (typeof startIdx === 'number') ? startIdx : 0;
      Q.highlightSel = opts.highlightSelector || '#reading-text .sentence';
      Q.onqueueend = opts.onend || null;
      if (Q.idx >= Q.sentences.length) { endQueue(); return; }
      queueStep();
    },

    /** 点击单句：只播该句并高亮（不建队列） */
    speakSentence: function (text, idx, opts) {
      opts = opts || {};
      Q.gen++;
      Q.active = false; Q.finished = false; Q.utter = null;
      Q.highlightSel = opts.highlightSelector || '#reading-text .sentence';
      highlight(idx);
      var rate = clamp(Eng30TTS.getRate());
      setButtons('speaking');
      speakUtter(text, rate, function () {
        highlight(-1);
        setButtons('idle');
      });
    },

    /** 停止：cancel + 复位 index/高亮/按钮 */
    stop: function (opts) {
      opts = opts || {};
      Q.gen++;
      Q.active = false; Q.finished = false;
      Q.sentences = []; Q.idx = -1; Q.utter = null;
      var s = getSynth();
      if (s) { try { s.cancel(); } catch (e) {} }
      highlight(-1);
      setButtons('idle');
    },

    pause: function () { var s = getSynth(); if (s) { try { s.pause(); } catch (e) {} setButtons('paused'); } },
    resume: function () { var s = getSynth(); if (s) { try { s.resume(); } catch (e) {} setButtons('speaking'); } },

    isSpeaking: function () { return Q.active && !Q.finished; },
    currentIndex: function () { return Q.idx; },

    /** 当前速度文案，如 "0.75× 学习速度"；非档位显示 "0.80× 自定义" */
    rateLabel: function (r) {
      r = clamp(r);
      var x = r.toFixed(2).replace(/0$/, '');
      var preset = PRESETS.filter(function (p) { return Math.abs(p.rate - r) < 0.001; })[0];
      return x + '× ' + (preset ? preset.label + '速度' : '自定义');
    },

    PRESETS: PRESETS
  };

  // ---- UI 同步：档位按钮 + range + 文案 ----
  function syncRateUI() {
    try {
      var r = Eng30TTS.getRate();
      // range 控件
      ['tts-rate', 'settings-rate'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.value = r;
      });
      // 文案
      [['tts-rate-val'], ['settings-rate-val']].forEach(function (pair) {
        var el = document.getElementById(pair[0]);
        if (el) el.textContent = Eng30TTS.rateLabel(r);
      });
      // 档位高亮
      var presets = document.querySelectorAll('.eng-speed-preset');
      presets.forEach(function (btn) {
        var pr = parseFloat(btn.dataset.rate);
        btn.classList.toggle('active', Math.abs(pr - r) < 0.001);
        btn.setAttribute('aria-pressed', Math.abs(pr - r) < 0.001 ? 'true' : 'false');
      });
    } catch (e) { /* 无 DOM（测试环境）时静默 */ }
  }

  function bindRateUI() {
    // range 实时输入
    ['tts-rate', 'settings-rate'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', function () {
        Eng30TTS.setRate(parseFloat(el.value));
      });
    });
    // 档位按钮（事件委托，兼容动态生成）
    var holder = document.getElementById('eng-speed-presets');
    if (holder) {
      holder.addEventListener('click', function (e) {
        var btn = e.target.closest('.eng-speed-preset');
        if (!btn) return;
        Eng30TTS.setRate(parseFloat(btn.dataset.rate));
      });
    }
    syncRateUI();
  }

  // ===================== 测试钩子 =====================
  Eng30TTS.__test = {
    MIN_RATE: MIN_RATE, MAX_RATE: MAX_RATE, DEFAULT_RATE: DEFAULT_RATE,
    /** 注入 mock synth（Node/浏览器测试）。返回当前 Q 快照 */
    installMockSynth: function (mock) { synth = mock; },
    reset: function () {
      Q.gen++; Q.active = false; Q.finished = false;
      Q.sentences = []; Q.idx = -1; Q.utter = null; Q.onqueueend = null;
      Q.highlightSel = '#reading-text .sentence';
    },
    state: function () {
      return { active: Q.active, idx: Q.idx, finished: Q.finished,
               utter: Q.utter, gen: Q.gen,
               sentenceCount: Q.sentences.length };
    },
    syncRateUI: syncRateUI,
    clamp: clamp
  };

  // ===================== 启动 =====================
  function init() {
    // 旧值钳制后立即回写一次（保证 localStorage 干净）
    persist(Eng30TTS.getRate());
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bindRateUI);
    } else {
      bindRateUI();
    }
  }

  global.Eng30TTS = Eng30TTS;
  if (typeof document !== 'undefined') init();

})(typeof window !== 'undefined' ? window : globalThis);
