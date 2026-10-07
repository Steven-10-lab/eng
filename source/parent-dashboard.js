/* ============================================================
 * parent-dashboard.js
 * 独立本地事件记录 + 家长看板
 *
 * 对外：
 *   window.Eng30Events.recordAttempt(event)
 *   window.Eng30Events.recordRedo(event)
 *   window.Eng30Events.getDayStats(day, range)
 *   window.Eng30Events.getDetail(day, module)
 *   window.Eng30Events.getAllStats(range)
 *   window.Eng30Events.clearAllRecords()
 *   window.ParentDashboard.init(container, options)
 *
 * 绝不读写：eng30_state_v1 / eng30_final_unlocked / eng30_assess_*
 * 新增 key：
 *   eng30_events_v1         事件库 + 聚合 + 明细
 *   eng30_parent_unlocked    家长看板独立解锁键（与期末密码锁无关）
 * ============================================================ */
(function (global) {
  'use strict';

  /* ============ 常量 ============ */
  var EVENTS_KEY = 'eng30_events_v1';
  var PARENT_UNLOCK_KEY = 'eng30_parent_unlocked';
  var FINAL_PASSWORD = 'deltaforce'; // 与期末测评同一密码，但解锁键独立
  var ENTRANCE_KEY = 'eng30_assess_entrance'; // 只读
  var FINAL_KEY = 'eng30_assess_final';        // 只读

  var MAX_GLOBAL_EVENTS = 1000;   // 全局事件上限
  var MAX_PER_DAY_MODULE = 50;    // 每(日,模块)明细上限

  var KNOWN_MODULES = [
    { id: 'reading',     name: '朗读阅读' },
    { id: 'copying',     name: '抄写' },
    { id: 'dictation',   name: '听写' },
    { id: 'vocabulary',  name: '词汇' },
    { id: 'shadowing',          name: '逐句跟读（句）' },
    { id: 'shadowing_passage',  name: '逐句跟读（整篇）' },
    { id: 'typing_dictation',   name: '输入填空默写' },
    { id: 'vocab_speaking',     name: '单词跟读' }
  ];

  /* ============ 存储（Node 测试可注入） ============ */
  var storage = typeof Eng30Storage !== 'undefined' && Eng30Storage || null;

  function readStore() {
    if (!storage) return emptyStore();
    try {
      var raw = storage.getItem(EVENTS_KEY);
      if (!raw) return emptyStore();
      var parsed = JSON.parse(raw);
      return normalizeStore(parsed);
    } catch (e) {
      return emptyStore();
    }
  }

  function writeStore(store) {
    if (!storage) return;
    try {
      storage.setItem(EVENTS_KEY, JSON.stringify(store));
    } catch (e) { /* 配额满等，静默 */ }
  }

  function emptyStore() {
    return { events: [], agg: {}, detail: {} };
  }

  function normalizeStore(s) {
    // 旧数据无新字段时安全空态，不抛错、不清 eng30_state_v1
    if (!s || typeof s !== 'object') return emptyStore();
    return {
      events: Array.isArray(s.events) ? s.events : [],
      agg:    (s.agg && typeof s.agg === 'object') ? s.agg : {},
      detail: (s.detail && typeof s.detail === 'object') ? s.detail : {}
    };
  }

  /* ============ 工具 ============ */
  function dmKey(day, module) { return 'd' + day + '|' + module; }

  function safeNum(n, dflt) {
    n = Number(n);
    return isFinite(n) ? n : (dflt || 0);
  }

  function uniq(arr) {
    var seen = {}; var out = [];
    (arr || []).forEach(function (x) {
      if (x == null || x === '') return;
      var k = String(x);
      if (!seen[k]) { seen[k] = 1; out.push(k); }
    });
    return out;
  }

  /* ============ 纯核心：聚合逻辑（Node 可测） ============ */
  var Core = {};

  // 从 event 推导本次 correct/wrong。优先 items，其次显式 correct/wrong
  Core.deriveCounts = function (ev) {
    var correct = 0, wrong = 0;
    if (ev && Array.isArray(ev.items) && ev.items.length) {
      ev.items.forEach(function (it) {
        if (it && it.correct) correct++; else wrong++;
      });
    } else {
      correct = safeNum(ev && ev.correct);
      wrong   = safeNum(ev && ev.wrong);
    }
    return { correct: correct, wrong: wrong };
  };

  // 把一条 attempt 事件并入 store（原地修改并返回 store）
  Core.applyAttempt = function (store, ev) {
    store = normalizeStore(store);
    if (!ev || ev.day == null || !ev.module) return store;
    if (ev.idempotencyKey && store.events.some(function (item) { return item.idempotencyKey === ev.idempotencyKey; })) return store;
    var day = safeNum(ev.day);
    var module = String(ev.module);
    var ts = ev.ts ? safeNum(ev.ts) : Date.now();
    var cw = Core.deriveCounts(ev);
    var correct = cw.correct, wrong = cw.wrong;
    var timeMs = safeNum(ev.timeMs);
    var score = (ev.score == null || !isFinite(Number(ev.score))) ? null : Number(ev.score);

    var key = dmKey(day, module);
    var a = store.agg[key] || freshAgg();

    a.attempts += correct + wrong;
    a.correct  += correct;
    a.wrong    += wrong;
    a.timeMs   += timeMs;
    if (score != null) {
      a.scoreCount += 1;
      a.scoreSum += score;
      if (a.scoreBest == null || score > a.scoreBest) a.scoreBest = score;
      a.scoreLast = score;
    }
    a.wrongWords = uniq(a.wrongWords.concat(ev.wrongWords || []));
    a.wrongSentences = uniq(a.wrongSentences.concat(ev.wrongSentences || []));
    if (!a.firstTs || ts < a.firstTs) a.firstTs = ts;
    a.lastTs = ts;
    store.agg[key] = a;

    // 明细（每日模块最近 50）
    var d = store.detail[key] || [];
    d.push({
      ts: ts,
      correct: correct,
      wrong: wrong,
      timeMs: timeMs,
      score: score,
      total: ev.total != null ? safeNum(ev.total) : (correct + wrong || null),
      wrongWords: (ev.wrongWords || []).slice(),
      wrongSentences: (ev.wrongSentences || []).slice(),
      mode: 'attempt', idempotencyKey: ev.idempotencyKey || null
    });
    if (d.length > MAX_PER_DAY_MODULE) d = d.slice(d.length - MAX_PER_DAY_MODULE);
    store.detail[key] = d;

    // 全局事件流（上限 1000，FIFO）
    store.events.push({
      ts: ts, day: day, module: module,
      correct: correct, wrong: wrong,
      timeMs: timeMs, score: score,
      mode: 'attempt', idempotencyKey: ev.idempotencyKey || null
    });
    if (store.events.length > MAX_GLOBAL_EVENTS) {
      store.events = store.events.slice(store.events.length - MAX_GLOBAL_EVENTS);
    }
    return store;
  };

  // 重做：只增 redoCount，不动 correct/wrong/attempts
  Core.applyRedo = function (store, ev) {
    store = normalizeStore(store);
    if (!ev || ev.day == null || !ev.module) return store;
    var day = safeNum(ev.day);
    var module = String(ev.module);
    var ts = ev.ts ? safeNum(ev.ts) : Date.now();
    var key = dmKey(day, module);
    var a = store.agg[key] || freshAgg();
    a.redoCount += 1;
    if (!a.firstTs) a.firstTs = ts;
    a.lastTs = ts;
    store.agg[key] = a;

    store.detail[key] = store.detail[key] || [];
    store.detail[key].push({ ts: ts, mode: 'redo', correct: 0, wrong: 0, timeMs: 0, score: null, wrongWords: [], wrongSentences: [] });
    if (store.detail[key].length > MAX_PER_DAY_MODULE) {
      store.detail[key] = store.detail[key].slice(store.detail[key].length - MAX_PER_DAY_MODULE);
    }

    store.events.push({ ts: ts, day: day, module: module, correct: 0, wrong: 0, timeMs: 0, score: null, mode: 'redo' });
    if (store.events.length > MAX_GLOBAL_EVENTS) {
      store.events = store.events.slice(store.events.length - MAX_GLOBAL_EVENTS);
    }
    return store;
  };

  function freshAgg() {
    return {
      attempts: 0, correct: 0, wrong: 0,
      redoCount: 0, timeMs: 0,
      scoreCount: 0, scoreSum: 0, scoreBest: null, scoreLast: null,
      wrongWords: [], wrongSentences: [],
      firstTs: null, lastTs: null
    };
  }

  // 聚合视图（含准确率/均分）
  Core.aggregateView = function (a) {
    if (!a) return null;
    var acc = a.attempts > 0 ? Math.round(a.correct / a.attempts * 1000) / 10 : null;
    var avg = a.scoreCount > 0 ? Math.round(a.scoreSum / a.scoreCount * 10) / 10 : null;
    return {
      attempts: a.attempts,
      correct: a.correct,
      wrong: a.wrong,
      redoCount: a.redoCount,
      accuracy: acc,          // null = 无数据
      timeMs: a.timeMs,
      scoreLast: a.scoreLast,
      scoreBest: a.scoreBest,
      scoreAvg: avg,
      scoreCount: a.scoreCount,
      wrongWords: a.wrongWords,
      wrongSentences: a.wrongSentences,
      firstTs: a.firstTs,
      lastTs: a.lastTs,
      hasData: a.attempts > 0 || a.redoCount > 0
    };
  };

  /* ============ 外部练习事件适配 ============ */
  function adaptAttempt(ev) {
    ev = ev || {};
    var out = {};
    Object.keys(ev).forEach(function (k) { out[k] = ev[k]; });
    if (!out.module) {
      if (out.sentenceIdx != null || out.ref != null) out.module = 'shadowing';
      else if (out.word != null || out.pass != null) out.module = 'vocab_speaking';
    }
    if (out.ts == null) out.ts = out.timestamp || Date.now();
    if (out.timeMs == null) out.timeMs = out.durationMs || 0;
    if (typeof out.correct === 'boolean') {
      out.wrong = out.correct ? 0 : 1;
      out.correct = out.correct ? 1 : 0;
    } else if (typeof out.pass === 'boolean') {
      out.correct = out.pass ? 1 : 0;
      out.wrong = out.pass ? 0 : 1;
    } else if (out.status) {
      var neutral = ['denied','network','start-failure','no-speech','empty','error','audio-capture','timeout','stopped'].indexOf(out.status) >= 0;
      if (out.status === 'success' && out.score != null) {
        out.correct = Number(out.score) >= 80 ? 1 : 0;
        out.wrong = Number(out.score) >= 80 ? 0 : 1;
      } else {
        out.correct = 0;
        out.wrong = neutral ? 0 : 1;
      }
    }
    if (!out.wrongWords) {
      out.wrongWords = out.wrong > 0 ? (out.errorWords || (out.expected ? [out.expected] : (out.word ? [out.word] : []))) : [];
    }
    if (!out.wrongSentences) {
      out.wrongSentences = out.wrong > 0 && out.ref ? [out.ref] : [];
    }
    return out;
  }

  /* ============ Eng30Events 公开 API ============ */
  var Eng30Events = {
    recordAttempt: function (ev) {
      var s = readStore();
      s = Core.applyAttempt(s, adaptAttempt(ev));
      writeStore(s);
    },
    recordRedo: function (ev) {
      var s = readStore();
      s = Core.applyRedo(s, ev);
      writeStore(s);
    },
    // day: 1-30; range: 'all'(默认) 或具体模块名
    getDayStats: function (day, range) {
      var s = readStore();
      var out = {};
      var prefix = 'd' + safeNum(day) + '|';
      Object.keys(s.agg).forEach(function (key) {
        if (key.indexOf(prefix) !== 0) return;
        var mod = key.slice(prefix.length);
        if (range && range !== 'all' && mod !== range) return;
        out[mod] = Core.aggregateView(s.agg[key]);
      });
      return out;
    },
    getDetail: function (day, module) {
      var s = readStore();
      var key = dmKey(safeNum(day), String(module));
      var arr = s.detail[key] || [];
      return arr.slice(); // 拷贝，最近在前由 UI 反转
    },
    // range: 'all' | '7d' | '30d'（按 lastTs 距今天数过滤）
    getAllStats: function (range) {
      var s = readStore();
      var days = {};
      var now = Date.now();
      var cutoffMs = null;
      if (range === '7d')  cutoffMs = now - 7  * 86400000;
      if (range === '30d') cutoffMs = now - 30 * 86400000;
      Object.keys(s.agg).forEach(function (key) {
        var a = s.agg[key];
        if (cutoffMs && a.lastTs && a.lastTs < cutoffMs) return;
        var parts = key.split('|');
        var dayNum = Number(parts[0].slice(1));
        var mod = parts[1];
        if (!days[dayNum]) days[dayNum] = {};
        days[dayNum][mod] = Core.aggregateView(a);
      });
      return days;
    },
    clearAllRecords: function () {
      if (storage) storage.removeItem(EVENTS_KEY);
      // 不碰 eng30_state_v1 / eng30_assess_* / eng30_final_unlocked
    },
    // 只读：读已有入学/期末成绩
    getExamScores: function () {
      function read(key) {
        if (!storage) return null;
        try {
          var raw = storage.getItem(key);
          return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
      }
      return { entrance: read(ENTRANCE_KEY), final: read(FINAL_KEY) };
    },
    // 测试钩子
    _core: Core,
    _setStorage: function (s) { storage = s; }
  };

  /* ============ 家长看板 UI ============ */
  function ParentDashboard() {}

  ParentDashboard.prototype = {
    constructor: ParentDashboard,

    init: function (container, options) {
      options = options || {};
      this.password = options.password || FINAL_PASSWORD;
      this.onClose  = options.onClose || function () {};
      this.range    = 'all';      // 'all' | '7d'
      this.selectedDay = null;    // 展开的日
      this.selectedMod = null;   // 展开的模块

      if (typeof container === 'string') container = document.querySelector(container);
      this.container = container;
      if (!this.container) return;

      this.renderGateOrDashboard();
    },

    isUnlocked: function () {
      try { return storage.getItem(PARENT_UNLOCK_KEY) === 'true'; }
      catch (e) { return false; }
    },
    setUnlocked: function (v) {
      try { storage.setItem(PARENT_UNLOCK_KEY, v ? 'true' : 'false'); }
      catch (e) {}
    },

    renderGateOrDashboard: function () {
      if (this.isUnlocked()) { this.renderDashboard(); }
      else { this.renderGate(); }
    },

    renderGate: function () {
      var self = this;
      this.container.innerHTML =
        '<div class="pd-mask">' +
          '<div class="pd-gate">' +
            '<h3 class="pd-title">家长看板</h3>' +
            '<p class="pd-notice">仅本机本地存储。此密码门槛仅作遮挡，<b>不是</b>真实安全防护。</p>' +
            '<input type="password" class="pd-pw" placeholder="输入期末密码" autocomplete="off">' +
            '<div class="pd-err"></div>' +
            '<div class="pd-actions">' +
              '<button class="pd-btn pd-cancel">关闭</button>' +
              '<button class="pd-btn pd-primary pd-unlock">解锁</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      var pw = this.container.querySelector('.pd-pw');
      this.container.querySelector('.pd-unlock').addEventListener('click', function () {
        if (pw.value === self.password) {
          self.setUnlocked(true);
          self.renderDashboard();
        } else {
          self.container.querySelector('.pd-err').textContent = '密码不正确';
        }
      });
      this.container.querySelector('.pd-cancel').addEventListener('click', function () {
        self.onClose();
      });
      pw.addEventListener('keydown', function (e) { if (e.key === 'Enter') self.container.querySelector('.pd-unlock').click(); });
      setTimeout(function () { pw.focus(); }, 0);
    },

    renderDashboard: function () {
      var self = this;
      var exams = Eng30Events.getExamScores();
      var eTxt = exams.entrance ? exams.entrance.total + ' 分' : '未开始';
      var fTxt = exams.final ? exams.final.total + ' 分' : (this.isFinalUnlockedReadOnly() ? '已解锁未测' : '未参加');

      this.container.innerHTML =
        '<div class="pd-mask">' +
          '<div class="pd-root">' +
            '<div class="pd-header">' +
              '<h3 class="pd-title">家长看板</h3>' +
              '<div class="pd-hdr-actions">' +
                '<button class="pd-btn pd-reset">重置全部记录</button>' +
                '<button class="pd-btn pd-close">关闭</button>' +
              '</div>' +
            '</div>' +
            '<p class="pd-notice">仅本机本地存储 · 不联网 · 不读取/修改学习进度勾选</p>' +

            '<div class="pd-exam">' +
              '<div class="pd-exam-item"><span class="pd-exam-label">入学测评</span><span class="pd-exam-val">' + eTxt + '</span></div>' +
              '<div class="pd-exam-item"><span class="pd-exam-label">期末测评</span><span class="pd-exam-val">' + fTxt + '</span></div>' +
            '</div>' +

            '<div class="pd-toggle">' +
              '<button data-r="7d" class="pd-tg' + (this.range === '7d' ? ' on' : '') + '">近 7 天</button>' +
              '<button data-r="all" class="pd-tg' + (this.range === 'all' ? ' on' : '') + '">全部</button>' +
            '</div>' +

            '<div class="pd-days"></div>' +
            '<div class="pd-detail"></div>' +
          '</div>' +
        '</div>';

      this.container.querySelector('.pd-close').addEventListener('click', function () { self.onClose(); });
      this.container.querySelector('.pd-reset').addEventListener('click', function () { self.confirmReset(); });
      this.container.querySelectorAll('.pd-tg').forEach(function (btn) {
        btn.addEventListener('click', function () {
          self.range = btn.getAttribute('data-r');
          self.renderDashboard();
        });
      });

      this.renderDays();
      if (this.selectedDay != null) this.renderDayDetail(this.selectedDay);
    },

    isFinalUnlockedReadOnly: function () {
      try { return storage.getItem('eng30_final_unlocked') === 'true'; } catch (e) { return false; }
    },

    renderDays: function () {
      var self = this;
      var wrap = this.container.querySelector('.pd-days');
      var all = Eng30Events.getAllStats(this.range);
      var html = '';
      for (var d = 1; d <= 30; d++) {
        var dayStats = all[d] || {};
        var totalAttempts = 0, totalCorrect = 0, modules = Object.keys(dayStats);
        modules.forEach(function (m) {
          totalAttempts += dayStats[m].attempts;
          totalCorrect  += dayStats[m].correct;
        });
        var cls = 'pd-day';
        if (totalAttempts > 0) cls += ' has';
        if (this.selectedDay === d) cls += ' sel';
        var label = totalAttempts > 0 ? Math.round(totalCorrect / totalAttempts * 100) + '%' : '未练习';
        html += '<div class="' + cls + '" data-day="' + d + '">' +
                  '<div class="pd-day-num">Day ' + d + '</div>' +
                  '<div class="pd-day-stat">' + label + '</div>' +
                '</div>';
      }
      wrap.innerHTML = html;
      wrap.querySelectorAll('.pd-day').forEach(function (el) {
        el.addEventListener('click', function () {
          var dd = Number(el.getAttribute('data-day'));
          self.selectedDay = (self.selectedDay === dd) ? null : dd;
          self.selectedMod = null;
          self.renderDashboard();
        });
      }, this);
    },

    renderDayDetail: function (day) {
      var self = this;
      var box = this.container.querySelector('.pd-detail');
      var stats = Eng30Events.getDayStats(day);
      var mods = Object.keys(stats);
      if (!mods.length) {
        box.innerHTML = '<div class="pd-dt-empty">Day ' + day + ' 暂无练习记录</div>';
        return;
      }
      var html = '<h4 class="pd-dt-title">Day ' + day + ' 各模块</h4>';
      html += '<table class="pd-table"><thead><tr>' +
        '<th>模块</th><th>尝试</th><th>正确</th><th>错误</th><th>重做</th>' +
        '<th>正确率</th><th>用时</th><th>最近分</th><th>最好分</th>' +
        '</tr></thead><tbody>';
      // 按已知模块顺序 + 未知模块追加
      var order = KNOWN_MODULES.map(function (m) { return m.id; }).filter(function (id) { return stats[id]; });
      mods.forEach(function (m) { if (order.indexOf(m) < 0) order.push(m); });
      order.forEach(function (mod) {
        var s = stats[mod];
        var modName = (KNOWN_MODULES.filter(function (k) { return k.id === mod; })[0] || { name: mod }).name;
        var acc = s.hasData ? s.accuracy + '%' : '未练习';
        var t = s.timeMs ? fmtDur(s.timeMs) : '—';
        var last = s.scoreLast != null ? s.scoreLast : '—';
        var best = s.scoreBest != null ? s.scoreBest : '—';
        var rowCls = (self.selectedMod === mod) ? ' class="sel"' : '';
        html += '<tr data-mod="' + mod + '"' + rowCls + '>' +
          '<td>' + modName + '</td>' +
          '<td>' + s.attempts + '</td>' +
          '<td>' + s.correct + '</td>' +
          '<td>' + s.wrong + '</td>' +
          '<td>' + s.redoCount + '</td>' +
          '<td>' + acc + '</td>' +
          '<td>' + t + '</td>' +
          '<td>' + last + '</td>' +
          '<td>' + best + '</td>' +
        '</tr>';
      });
      html += '</tbody></table>';
      box.innerHTML = html;

      box.querySelectorAll('tr[data-mod]').forEach(function (tr) {
        tr.addEventListener('click', function () {
          var m = tr.getAttribute('data-mod');
          self.selectedMod = (self.selectedMod === m) ? null : m;
          self.renderDayDetail(self.selectedDay);
        });
      });

      if (this.selectedMod) this.renderModDetail(day, this.selectedMod);
    },

    renderModDetail: function (day, mod) {
      var box = this.container.querySelector('.pd-detail');
      var detail = Eng30Events.getDetail(day, mod);
      if (!detail.length) return;
      var stats = Eng30Events.getDayStats(day, mod)[mod];
      var html = '<div class="pd-mod-dt"><h4>错题明细</h4>';
      if (stats && stats.wrongWords && stats.wrongWords.length) {
        html += '<div class="pd-wl"><b>错词：</b>' + stats.wrongWords.join('、') + '</div>';
      }
      if (stats && stats.wrongSentences && stats.wrongSentences.length) {
        html += '<div class="pd-sl"><b>错句：</b>' + escapeHtml(stats.wrongSentences.join(' / ')) + '</div>';
      }
      html += '<ul class="pd-times">';
      detail.slice().reverse().forEach(function (r) {
        var d = new Date(r.ts);
        var hh = String(d.getHours()).padStart(2, '0');
        var mm = String(d.getMinutes()).padStart(2, '0');
        var tag = r.mode === 'redo' ? '<span class="pd-tag">重做</span>' : '';
        html += '<li>' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hh + ':' + mm + tag +
          ' 对' + r.correct + ' / 错' + r.wrong +
          (r.score != null ? ' · 分' + r.score : '') +
          (r.timeMs ? ' · ' + fmtDur(r.timeMs) : '') +
        '</li>';
      });
      html += '</ul></div>';
      box.insertAdjacentHTML('beforeend', html);
    },

    confirmReset: function () {
      var self = this;
      if (!confirm('确定要清空所有练习记录吗？此操作不可恢复。')) return;
      if (!confirm('再次确认：真的要清空全部尝试/错题/用时记录吗？')) return;
      Eng30Events.clearAllRecords();
      self.selectedDay = null; self.selectedMod = null;
      self.renderDashboard();
    }
  };

  function fmtDur(ms) {
    var s = Math.round(ms / 1000);
    if (s < 60) return s + '秒';
    var m = Math.floor(s / 60); s = s % 60;
    if (m < 60) return m + '分' + (s ? s + '秒' : '');
    var h = Math.floor(m / 60); m = m % 60;
    return h + '时' + m + '分';
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ============ 导出 ============ */
  var PD = {
    init: function (container, options) {
      var inst = new ParentDashboard();
      inst.init(container, options);
      return inst;
    }
  };

  global.Eng30Events = Eng30Events;
  global.ParentDashboard = PD;

  // Node 测试
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      Eng30Events: Eng30Events,
      ParentDashboard: PD,
      Core: Core
    };
  }

})(typeof window !== 'undefined' ? window : globalThis);
