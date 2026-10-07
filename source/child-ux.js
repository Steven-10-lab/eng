/* =========================================================================
 * child-ux.js — 儿童端 UX 补丁（可选加载，不修改 index.html / app.js / styles.css）
 *
 * 设计目标：
 *  - 首页突出「继续今天学习」+ 4 个顺序阶段（朗读15/抄写10/默写20/单词15=60分钟）
 *  - 每阶段引导「听示范 → 尝试 → 看反馈 → 订正/再来 → 打勾完成」
 *  - 主要按钮统一（复用 .footer-btn.primary）；返回不丢进度（复用既有 localStorage）
 *  - 儿童端默认隐藏复杂统计 / 测评中心 / 高级历史；家长入口在「设置」页
 *  - 空态 / 失败 / 已提交 / 禁用态有统一横幅文案（见 Cux.banner）
 *
 * 依赖：后于 app.js 加载，可直接读全局 state / getDayProgress / isDayComplete /
 *       renderDay / DAYS；全部 DOM 注入幂等（带 data-cux 标记）。
 * ========================================================================= */
(function () {
  'use strict';

  var ORDER = ['reading', 'copying', 'dictation', 'vocabulary'];
  var META = {
    reading:    { name: '朗读', min: 15 },
    copying:    { name: '抄写', min: 10 },
    dictation:  { name: '默写', min: 20 },
    vocabulary: { name: '单词', min: 15 }
  };
  var PARENT_KEY = 'eng30_cux_parent';

  /* 每阶段五步流程：与页面上真实存在的控件一一对应 */
  var FLOW = {
    reading: [
      { head: '听示范', body: '点「▶ 朗读全文」，先听一遍标准发音。' },
      { head: '试一试', body: '点「开始跟读」，跟着录音一句一句读。' },
      { head: '看反馈', body: '读错或漏读的词会变红，看到哪里错了。' },
      { head: '再来一次', body: '点「重录当前句」，把变红的词再读一遍。' },
      { head: '打勾完成', body: '读好后，勾选下面的「朗读完成」。' }
    ],
    copying: [
      { head: '听示范', body: '先点「▶ 朗读全文」听一遍，读准每个词。' },
      { head: '试一试', body: '在练习本上，对照短文工整抄写。' },
      { head: '看反馈', body: '抄完抬头对照屏幕原文，找找漏了哪个词。' },
      { head: '订正', body: '把漏掉的词、错的标点补在句子后面。' },
      { head: '打勾完成', body: '检查完，勾选「抄写完成」。' }
    ],
    dictation: [
      { head: '听示范', body: '点「▶ 播放当前句」，先听清楚整句话。' },
      { head: '试一试', body: '在练习本上写下听到的句子（或用 iPad 输入默写）。' },
      { head: '看反馈', body: '点「显示原文对照」，一句一句对一对。' },
      { head: '订正/再来', body: '错句点「重听」再听一遍，或点「只重做错题」。' },
      { head: '打勾完成', body: '全部句子对完，勾选「默写完成」。' }
    ],
    vocabulary: [
      { head: '听示范', body: '点单词卡片，听发音和例句。' },
      { head: '试一试', body: '看着单词读 3 遍，记住中文意思。' },
      { head: '看反馈', body: '复习的单词想一想：记住了吗？' },
      { head: '再来一次', body: '点「没记住」，这个词明天会再出现。' },
      { head: '打勾完成', body: '新词学完、复习过完，勾选「单词学习完成」。' }
    ]
  };

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /* ------------------------------------------------------------------
   * 家长模式
   * ------------------------------------------------------------------ */
  function initParentMode() { document.body.classList.add('cux'); }
  function setParentMode() {}


  /* ------------------------------------------------------------------
   * 工具：当前该学的那一天 = 第一个未完成的天
   * ------------------------------------------------------------------ */
  function todayNum() {
    for (var d = 1; d <= 30; d++) {
      if (typeof isDayComplete === 'function' && !isDayComplete(d)) return d;
    }
    return 30;
  }

  /* ------------------------------------------------------------------
   * 首页：继续学习主卡
   * ------------------------------------------------------------------ */
  function injectHome() {
    var home = $('#view-home');
    if (!home || $('[data-cux="hero"]', home)) return;

    var hero = document.createElement('div');
    hero.setAttribute('data-cux', 'hero');
    hero.className = 'cux-hero';
    hero.innerHTML =
      '<div class="cux-hero-hello">今天也要继续加油哦！</div>' +
      '<button type="button" class="cux-hero-btn" id="cux-hero-btn">' +
      '  <span class="cux-hero-day" id="cux-hero-day">开始学习</span>' +
      '  <span class="cux-hero-sub">朗读 → 抄写 → 默写 → 单词 · 共约 60 分钟</span>' +
      '</button>' +
      '<div class="cux-hero-steps" id="cux-hero-steps"></div>';
    home.insertBefore(hero, home.firstChild);

    $('#cux-hero-btn').addEventListener('click', function () {
      location.hash = '#/day/' + todayNum();
    });

    /* 修正每日流程提示卡时长：朗读15 / 抄写10 / 默写20 / 单词15 = 60 */
    var lis = $all('.home-tips .tip-card ol li');
    var fixed = ['朗读 15分钟', '抄写 10分钟', '默写 20分钟', '单词 15分钟'];
    lis.forEach(function (li, i) {
      if (i >= fixed.length) return;
      var strong = li.querySelector('strong');
      if (strong) strong.textContent = fixed[i];
    });

    renderHero();
  }

  function renderHero() {
    var day = todayNum();
    var doneAll = (typeof isDayComplete === 'function') && isDayComplete(30) && isDayComplete(day);
    var dayLabel = $('#cux-hero-day');
    var chips = $('#cux-hero-steps');
    if (!dayLabel || !chips) return;

    var p = (typeof getDayProgress === 'function') ? getDayProgress(day) : {};
    var doneCount = ORDER.filter(function (s) { return p[s]; }).length;

    if (doneAll) {
      dayLabel.textContent = '30 天全部完成，太棒了！';
    } else if (doneCount > 0) {
      dayLabel.textContent = '继续 Day ' + day + '（已完成 ' + doneCount + '/4 步）';
    } else {
      dayLabel.textContent = '开始 Day ' + day;
    }

    chips.innerHTML = ORDER.map(function (s) {
      var done = !!p[s];
      return '<div class="cux-hero-chip' + (done ? ' done' : '') + '">' +
        (done ? '✓ ' : '') + META[s].name +
        '<small>' + META[s].min + '分钟</small></div>';
    }).join('');
  }

  /* ------------------------------------------------------------------
   * 每日页：步骤引导条（听示范→尝试→反馈→订正→打勾）+ 下一步主按钮
   * ------------------------------------------------------------------ */
  function injectGuide() {
    var tabs = $('#step-tabs');
    if (!tabs || $('[data-cux="guide"]')) return;

    var guide = document.createElement('div');
    guide.setAttribute('data-cux', 'guide');
    guide.className = 'cux-guide';
    guide.innerHTML =
      '<div class="cux-guide-head">' +
      '  <span class="cux-guide-step" id="cux-guide-step"></span>' +
      '  <span class="cux-guide-state" id="cux-guide-state"></span>' +
      '</div>' +
      '<ol class="cux-flow" id="cux-guide-flow"></ol>' +
      '<button type="button" class="footer-btn primary cux-next-btn" id="cux-next-btn">下一步</button>';
    tabs.parentNode.insertBefore(guide, tabs.nextSibling);

    /* 步骤标签上加时长小徽章 */
    $all('.step-tab').forEach(function (tab) {
      var step = tab.getAttribute('data-step');
      if (META[step] && !$('.cux-dur', tab)) {
        var dur = document.createElement('span');
        dur.className = 'cux-dur';
        dur.textContent = META[step].min + '′';
        tab.appendChild(dur);
      }
    });

    $('#cux-next-btn').addEventListener('click', function () {
      var i = ORDER.indexOf(state.currentStep);
      var p = getDayProgress(state.currentDay);
      if (i < 3 && p[state.currentStep]) {
        state.currentStep = ORDER[i + 1];
        if (typeof renderDay === 'function') renderDay();
        updateGuide();
        window.scrollTo(0, 0);
      } else if (i === 3 && p.vocabulary) {
        /* 4 步都勾完 → 引导去点底部「标记今日完成」 */
        var bar = $('.day-complete-bar');
        if (bar) bar.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });

    updateGuide();
  }

  function updateGuide() {
    var step = (typeof state !== 'undefined') ? state.currentStep : 'reading';
    var i = ORDER.indexOf(step);
    if (i < 0) i = 0;
    var p = (typeof getDayProgress === 'function') ? getDayProgress(state.currentDay) : {};
    var done = !!p[step];

    var stepEl = $('#cux-guide-step');
    var stateEl = $('#cux-guide-state');
    var flowEl = $('#cux-guide-flow');
    var btn = $('#cux-next-btn');
    if (!stepEl || !stateEl || !flowEl || !btn) return;

    stepEl.textContent = '第 ' + (i + 1) + '/4 步 · ' + META[step].name + ' · 约 ' + META[step].min + ' 分钟';
    stateEl.textContent = done ? '已完成 ✓' : '进行中';
    stateEl.className = 'cux-guide-state' + (done ? ' done' : '');

    flowEl.innerHTML = FLOW[step].map(function (f, k) {
      return '<li><b>' + (k + 1) + ' ' + f.head + '</b>' + f.body + '</li>';
    }).join('');

    if (i < 3) {
      btn.disabled = !done;
      btn.textContent = done
        ? '下一步：' + META[ORDER[i + 1]].name + ' →'
        : '先打勾完成本步，再去「' + META[ORDER[i + 1]].name + '」';
    } else {
      btn.disabled = !done;
      btn.textContent = done ? '4 步都完成啦，去「标记今日完成」→' : '这是最后一步，完成后记得打勾';
    }
  }

  /* ------------------------------------------------------------------
   * 设置页：家长专区入口（儿童端不显示复杂统计/测评，由此进入）
   * ------------------------------------------------------------------ */
  function injectGate() {
    var view = $('#view-settings');
    if (!view || $('[data-cux="gate"]')) return;
    var card = document.createElement('div');
    card.setAttribute('data-cux', 'gate');
    card.className = 'settings-group';
    card.innerHTML =
      '<h2 class="section-title">家长专区</h2>' +
      '<p class="cux-gate-desc">孩子视图只显示「今天学什么」。切到家长视图，可以看到学习统计、测评中心和历史成绩。</p>' +
      '<button type="button" class="footer-btn cux-gate-btn" id="cux-gate-btn">切到家长视图</button>';
    view.insertBefore(card, view.firstChild);
    $('#cux-gate-btn').addEventListener('click', function () {
      var on = !document.body.classList.contains('cux-parent');
      setParentMode(on);
    });
    syncGateBtn();
  }

  function syncGateBtn() {
    var btn = $('#cux-gate-btn');
    if (!btn) return;
    var on = document.body.classList.contains('cux-parent');
    btn.textContent = on ? '切回孩子视图' : '切到家长视图';
    btn.classList.toggle('on', on);
  }

  /* ------------------------------------------------------------------
   * 通用状态横幅（空态 / 识别中 / 失败 / 已提交）
   * 用法：Cux.banner(容器, 'info|warn|err|ok', '文案', '按钮文字', 回调)
   * ------------------------------------------------------------------ */
  function banner(container, type, msg, actionText, onAction) {
    if (!container) return null;
    $all('.cux-banner', container).forEach(function (b) { b.remove(); });
    var b = document.createElement('div');
    b.className = 'cux-banner ' + (type || 'info');
    b.innerHTML = '<span class="cux-banner-msg"></span>' +
      (actionText ? '<button type="button" class="cux-banner-act"></button>' : '');
    b.querySelector('.cux-banner-msg').textContent = msg;
    if (actionText) {
      var act = b.querySelector('.cux-banner-act');
      act.textContent = actionText;
      act.addEventListener('click', function () {
        act.disabled = true;
        if (onAction) onAction(function (retryMsg) {
          if (retryMsg) b.querySelector('.cux-banner-msg').textContent = retryMsg;
          act.disabled = false;
        });
      });
    }
    container.insertBefore(b, container.firstChild);
    return b;
  }

  /* ------------------------------------------------------------------
   * 路由：切天 / 回首页时，自动回到「第一个没做完的步骤」，返回不丢进度
   * ------------------------------------------------------------------ */
  function onRoute() {
    var hash = location.hash || '#/';
    if (hash.indexOf('#/day/') === 0 && typeof state !== 'undefined') {
      injectGuide();
      var p = getDayProgress(state.currentDay);
      if (typeof isDayComplete === 'function' && !isDayComplete(state.currentDay)) {
        var resume = null;
        for (var k = 0; k < ORDER.length; k++) { if (!p[ORDER[k]]) { resume = ORDER[k]; break; } }
        if (resume && state.currentStep !== resume) {
          state.currentStep = resume;
          if (typeof renderDay === 'function') renderDay();
        }
      }
      updateGuide();
      if (state.currentStep === 'reading' && window.Shadowing) {
        try {
          if (!window._engShadowMounted) {
            window.Shadowing.mount('shadowing-mount');
            window._engShadowMounted = true;
            window._engShadowDay = state.currentDay;
          } else if (typeof window.Shadowing.refresh === 'function') {
            window.Shadowing.refresh();
          }
        } catch (e) {}
      }
    } else if (hash === '#/settings') {
      /* 家长看板由设置页独立密码入口打开 */
    } else {
      injectHome();
      renderHero();
    }
  }

  /* 完成勾选 / 标记今日完成后，同步刷新首页主卡与引导条 */
  document.addEventListener('change', function (e) {
    if (e.target && /^check-/.test(e.target.id || '')) {
      updateGuide();
      renderHero();
    }
  });
  document.addEventListener('click', function (e) {
    if (e.target && e.target.id === 'btn-day-complete') {
      setTimeout(function () { renderHero(); }, 50);
    }
  });

  window.addEventListener('hashchange', onRoute);

  document.addEventListener('DOMContentLoaded', function () {
    initParentMode();
    onRoute();
  });
  /* 脚本在 body 末尾同步执行时，DOM 已就绪，直接跑一次 */
  initParentMode();
  onRoute();

  /* 对外暴露：供后续阶段（识别中/失败重试等）直接调用 */
  window.Cux = {
    banner: banner,
    setParentMode: setParentMode,
    parentMode: function () { return false; }
  };
})();
