/* ===== 30天英语短文学习 — 应用逻辑 ===== */

const STORAGE_KEY = 'eng30_state_v1';
const EBBINGHAUS_INTERVALS = [1, 2, 4, 8, 16]; // 相对于学习日的复习间隔（天）

// ===== 状态管理 =====
const state = {
  currentDay: 1,
  currentStep: 'reading',
  progress: {},      // { dayN: {reading:bool, copying:bool, dictation:bool, vocabulary:bool} }
  wordStatus: {},    // { "day_word": {stage:0-5, nextReview:dayNum, learnedOn:dayNum} }
  settings: { ttsRate: 0.75 },
  dictSentenceIdx: 0
};

function loadState() {
  try {
    const saved = Eng30Storage.get(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      Object.assign(state.progress, parsed.progress || {});
      Object.assign(state.wordStatus, parsed.wordStatus || {});
      Object.assign(state.settings, parsed.settings || {});
    }
  } catch (e) {
    console.warn('Failed to load state:', e);
  }
}

function saveState() {
  try {
    Eng30Storage.set(STORAGE_KEY, JSON.stringify({
      progress: state.progress,
      wordStatus: state.wordStatus,
      settings: state.settings
    }));
  } catch (e) {
    console.warn('Failed to save state:', e);
  }
}

// 显式暴露给统一 TTS 控制器（tts-controller.js 通过 window.state 懒读取）。
// 顶层 const state 不会自动成为 window 属性，必须手动挂接。
window.state = state;
window.saveState = saveState;

function getDayProgress(day) {
  return state.progress['day' + day] || { reading: false, copying: false, dictation: false, vocabulary: false };
}

function setDayProgress(day, key, val) {
  const p = getDayProgress(day);
  p[key] = val;
  state.progress['day' + day] = p;
  saveState();
}

function isDayComplete(day) {
  const p = getDayProgress(day);
  return p.reading && p.copying && p.dictation && p.vocabulary;
}

function isDayPartial(day) {
  const p = getDayProgress(day);
  return p.reading || p.copying || p.dictation || p.vocabulary;
}

const STEP_NAMES = { reading: '朗读阅读', copying: '抄写', dictation: '默写', vocabulary: '单词学习' };
function getMissingDaySteps(progress) { return Object.keys(STEP_NAMES).filter(key => !progress[key]); }
window.Eng30CompletionCore = { getMissingDaySteps };

// ===== 艾宾浩斯单词调度 =====
function wordKey(day, word) {
  return day + '_' + word.toLowerCase();
}

function scheduleWordReviews(day) {
  const dayData = DAYS.find(d => d.day === day);
  if (!dayData) return;
  dayData.words.forEach(w => {
    const key = wordKey(day, w.word);
    if (!state.wordStatus[key]) {
      state.wordStatus[key] = {
        stage: 0,
        nextReview: day + EBBINGHAUS_INTERVALS[0],
        learnedOn: day,
        word: w.word,
        day: day
      };
    }
  });
  saveState();
}

function getDueReviewWords(currentDay) {
  const due = [];
  for (const key in state.wordStatus) {
    const ws = state.wordStatus[key];
    if (ws.nextReview <= currentDay && ws.stage < EBBINGHAUS_INTERVALS.length) {
      // 找到这个单词的完整数据
      const dayData = DAYS.find(d => d.day === ws.day);
      if (dayData) {
        const wordData = dayData.words.find(w => w.word.toLowerCase() === ws.word.toLowerCase());
        if (wordData) {
          due.push({ ...wordData, status: ws, key: key });
        }
      }
    }
  }
  return due;
}

function markWordRemember(key) {
  const ws = state.wordStatus[key];
  if (!ws) return;
  ws.stage += 1;
  if (ws.stage < EBBINGHAUS_INTERVALS.length) {
    ws.nextReview = ws.learnedOn + getCumulativeInterval(ws.stage);
  }
  saveState();
}

function markWordForget(key) {
  const ws = state.wordStatus[key];
  if (!ws) return;
  ws.stage = 0;
  ws.nextReview = ws.learnedOn + EBBINGHAUS_INTERVALS[0];
  // 如果已经超过了复习日，设为明天
  if (ws.nextReview <= state.currentDay) {
    ws.nextReview = state.currentDay + 1;
  }
  saveState();
}

function getCumulativeInterval(stage) {
  // stage 0 -> 1, stage 1 -> 1+2=3, stage 2 -> 1+2+4=7, stage 3 -> 15, stage 4 -> 31
  let sum = 0;
  for (let i = 0; i <= stage && i < EBBINGHAUS_INTERVALS.length; i++) {
    sum += EBBINGHAUS_INTERVALS[i];
  }
  return sum;
}

function countWordsLearned() {
  return Object.keys(state.wordStatus).length;
}

function countDueReviews() {
  return getDueReviewWords(state.currentDay).length;
}

function countStreak() {
  let streak = 0;
  for (let d = 1; d <= 30; d++) {
    if (isDayComplete(d)) streak++;
    else break;
  }
  return streak;
}

// ===== TTS 语音合成（统一委托给 Eng30TTS，避免双控制器） =====
// Eng30TTS 已在 tts-controller.js 中加载；此处仅做向后兼容的薄封装。
let synth = (typeof window !== 'undefined' && window.speechSynthesis) || null;
let currentUtterance = null;
let speakingSentenceIdx = -1;

function speakText(text, rate, onend) {
  if (window.Shadowing && Shadowing.stopAll) Shadowing.stopAll();
  if (window.VocabSpeaking && VocabSpeaking.stopAll) VocabSpeaking.stopAll();
  if (typeof Eng30TTS !== 'undefined') {
    Eng30TTS.speakText(text, { rate: (typeof rate === 'number' ? rate : undefined) }, onend);
    return;
  }
  // 兜底（Eng30TTS 未加载时）
  if (!synth) { alert('当前浏览器不支持语音合成功能'); return; }
  synth.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'en-US';
  utter.rate = rate || state.settings.ttsRate;
  utter.pitch = 1.0;
  currentUtterance = utter;
  if (onend) utter.onend = onend;
  synth.speak(utter);
}

function speakSentences(sentences, startIdx, rate) {
  if (typeof Eng30TTS !== 'undefined') {
    Eng30TTS.speakSentences(sentences, startIdx, {
      highlightSelector: '#reading-text .sentence'
    });
    return;
  }
  // 兜底
  if (!synth) return;
  if (startIdx >= sentences.length) {
    speakingSentenceIdx = -1;
    highlightSentence(-1);
    return;
  }
  speakingSentenceIdx = startIdx;
  highlightSentence(startIdx);
  speakText(sentences[startIdx], rate, () => {
    speakSentences(sentences, startIdx + 1, rate);
  });
}

function highlightSentence(idx) {
  const spans = document.querySelectorAll('#reading-text .sentence');
  spans.forEach((s, i) => {
    s.classList.toggle('speaking', i === idx);
  });
}

function stopSpeaking() {
  if (typeof Eng30TTS !== 'undefined') { Eng30TTS.stop(); return; }
  if (synth) synth.cancel();
  speakingSentenceIdx = -1;
  highlightSentence(-1);
}

function splitIntoSentences(text) {
  // 按句号、问号、感叹号分割，保留标点
  const matches = text.match(/[^.!?]+[.!?]+/g);
  return matches ? matches.map(s => s.trim()) : [text];
}

// ===== 路由 =====
function navigate(hash) {
  if (hash.startsWith('#/day/')) {
    const day = parseInt(hash.replace('#/day/', ''), 10);
    if (day >= 1 && day <= 30) {
      state.currentDay = day;
      state.currentStep = 'reading';
      state.dictSentenceIdx = 0;
      showView('day');
      renderDay();
    }
  } else if (hash === '#/settings') {
    showView('settings');
  } else if (hash === '#/parent') {
    showView('parent');
    setTimeout(openParentDashboard, 0);
  } else {
    showView('home');
    renderHome();
  }
}

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById('view-' + name).classList.remove('hidden');
  const titles = { home: '李江震的30天英语读写默写', day: '每日学习', settings: '设置', parent: '家长看板' };
  document.getElementById('page-title').textContent = titles[name] || '30天英语短文';
  window.scrollTo(0, 0);
}

// ===== 渲染首页 =====
function renderHome() {
  // 进度环
  let completed = 0;
  for (let d = 1; d <= 30; d++) {
    if (isDayComplete(d)) completed++;
  }
  const pct = completed / 30;
  const circumference = 2 * Math.PI * 52;
  const ring = document.getElementById('progress-ring-fg');
  ring.style.strokeDasharray = circumference;
  ring.style.strokeDashoffset = circumference * (1 - pct);
  document.getElementById('progress-num').textContent = completed;

  // 统计
  document.getElementById('stat-words').textContent = countWordsLearned();
  document.getElementById('stat-review').textContent = countDueReviews();
  document.getElementById('stat-streak').textContent = countStreak();

  // 30天网格
  const grid = document.getElementById('day-grid');
  grid.innerHTML = '';
  for (let d = 1; d <= 30; d++) {
    const cell = document.createElement('div');
    cell.className = 'day-cell';
    if (isDayComplete(d)) cell.classList.add('completed');
    else if (isDayPartial(d)) cell.classList.add('partial');

    // 当前天 = 第一个未完成的天
    let currentDayNum = 1;
    for (let i = 1; i <= 30; i++) {
      if (!isDayComplete(i)) { currentDayNum = i; break; }
      if (i === 30) currentDayNum = 30;
    }
    if (d === currentDayNum && !isDayComplete(d)) cell.classList.add('current');

    const dayData = DAYS.find(x => x.day === d);
    const levelLabel = dayData ? (dayData.level === 'easy' ? '入门' : dayData.level === 'medium' ? '进阶' : '挑战') : '';

    cell.innerHTML = `
      <span class="cell-num">${d}</span>
      <span class="cell-label">${levelLabel}</span>
      ${isDayComplete(d) ? '<span class="cell-check">✓</span>' : ''}
    `;
    cell.addEventListener('click', () => {
      location.hash = '#/day/' + d;
    });
    grid.appendChild(cell);
  }
}

// ===== 渲染每日学习 =====
function renderDay() {
  const dayData = DAYS.find(d => d.day === state.currentDay);
  if (!dayData) return;

  document.getElementById('day-badge').textContent = 'Day ' + state.currentDay;
  document.getElementById('day-title').textContent = dayData.title;
  document.getElementById('day-source').textContent = dayData.sourceCn + ' · ' + (dayData.level === 'easy' ? '入门' : dayData.level === 'medium' ? '进阶' : '挑战');

  // 环节标签状态
  const p = getDayProgress(state.currentDay);
  document.querySelectorAll('.step-tab').forEach(tab => {
    const step = tab.dataset.step;
    tab.classList.toggle('active', step === state.currentStep);
    tab.classList.toggle('done', p[step]);
  });

  // 渲染当前环节
  renderStepPanel();

  // 今日完成按钮状态
  updateCompleteButton();

  // 底部按钮
  document.getElementById('btn-prev-day').disabled = state.currentDay <= 1;
  document.getElementById('btn-next-day').disabled = state.currentDay >= 30;
}

function updateCompleteButton() {
  const p = getDayProgress(state.currentDay);
  const doneCount = [p.reading, p.copying, p.dictation, p.vocabulary].filter(Boolean).length;
  const btn = document.getElementById('btn-day-complete');
  const progress = document.getElementById('complete-progress');
  if (!btn || !progress) return;
  progress.textContent = '已完成 ' + doneCount + '/4 环节';
  if (doneCount === 4) {
    btn.classList.add('done');
    btn.querySelector('span').textContent = '今日已完成';
  } else {
    btn.classList.remove('done');
    btn.querySelector('span').textContent = '标记今日完成';
  }
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.add('hidden'), 2000);
}

function renderStepPanel() {
  document.querySelectorAll('.step-panel').forEach(p => p.classList.add('hidden'));
  document.getElementById('panel-' + state.currentStep).classList.remove('hidden');

  const dayData = DAYS.find(d => d.day === state.currentDay);
  if (!dayData) return;

  if (state.currentStep === 'reading') {
    renderReading(dayData);
  } else if (state.currentStep === 'copying') {
    renderCopying(dayData);
  } else if (state.currentStep === 'dictation') {
    renderDictation(dayData);
  } else if (state.currentStep === 'vocabulary') {
    renderVocabulary(dayData);
  }

  // 同步checkbox状态
  const p = getDayProgress(state.currentDay);
  const checkMap = { reading: 'check-reading', copying: 'check-copying', dictation: 'check-dictation', vocabulary: 'check-vocabulary' };
  const cb = document.getElementById(checkMap[state.currentStep]);
  if (cb) cb.checked = p[state.currentStep];
}

function renderReading(dayData) {
  const container = document.getElementById('reading-text');
  const sentences = splitIntoSentences(dayData.text);
  container.innerHTML = sentences.map((s, i) =>
    `<span class="sentence" data-idx="${i}">${s}</span> `
  ).join('');
  document.getElementById('reading-translation').textContent = dayData.translation;
  if (window.Shadowing) {
    if (!window._engShadowMounted) { Shadowing.mount('shadowing-mount'); window._engShadowMounted = true; window._engShadowDay = dayData.day; }
    else if (window._engShadowDay !== dayData.day) { window._engShadowDay = dayData.day; Shadowing.refresh(); }
  }

  // 点击句子单独朗读
  container.querySelectorAll('.sentence').forEach(span => {
    span.addEventListener('click', () => {
      const idx = parseInt(span.dataset.idx, 10);
      if (typeof Eng30TTS !== 'undefined') {
        Eng30TTS.speakSentence(sentences[idx], idx, { highlightSelector: '#reading-text .sentence' });
      } else {
        speakText(sentences[idx], state.settings.ttsRate);
        speakingSentenceIdx = idx;
        highlightSentence(idx);
      }
    });
  });
}

function renderCopying(dayData) {
  document.getElementById('copying-text').textContent = dayData.text;
}

function renderDictation(dayData) {
  const sentences = splitIntoSentences(dayData.text);
  if (state.dictSentenceIdx >= sentences.length) state.dictSentenceIdx = 0;

  document.getElementById('dict-progress').textContent = (state.dictSentenceIdx + 1) + ' / ' + sentences.length;

  // 显示提示句（如果有对应的dictationHints）
  const hintEl = document.getElementById('dictation-hint');
  if (dayData.dictationHints && dayData.dictationHints[state.dictSentenceIdx]) {
    hintEl.textContent = dayData.dictationHints[state.dictSentenceIdx];
    hintEl.style.display = 'block';
  } else if (dayData.dictationHints && dayData.dictationHints.length > 0) {
    // 循环使用提示
    hintEl.textContent = dayData.dictationHints[state.dictSentenceIdx % dayData.dictationHints.length];
    hintEl.style.display = 'block';
  } else {
    hintEl.style.display = 'none';
  }

  // 答案区域重置为隐藏
  document.getElementById('dictation-answer').classList.add('hidden');
  document.getElementById('dictation-answer').textContent = '';
}

function renderVocabulary(dayData) {
  if (window.VocabSpeaking) {
    if (!window._engVocabMounted) { VocabSpeaking.mount('vocab-speaking-mount', dayData); window._engVocabMounted = true; window._engVocabDay = dayData.day; }
    else if (window._engVocabDay !== dayData.day) { window._engVocabDay = dayData.day; VocabSpeaking.refresh(dayData); }
  }
  // 今日新词
  const newContainer = document.getElementById('vocab-new-cards');
  newContainer.innerHTML = dayData.words.map(w => `
    <div class="vocab-card">
      <div class="word-head">
        <span class="word-en">${w.word}</span>
        <span class="word-phonetic">${w.phonetic}</span>
        <span class="word-pos">${w.pos}</span>
      </div>
      <div class="word-meaning">${w.meaning}</div>
      <div class="word-example">${w.example}</div>
    </div>
  `).join('');

  // 点击单词卡片朗读
  newContainer.querySelectorAll('.vocab-card').forEach((card, i) => {
    card.addEventListener('click', () => {
      speakText(dayData.words[i].word + '. ' + dayData.words[i].example, state.settings.ttsRate);
    });
  });

  // 艾宾浩斯复习
  const dueWords = getDueReviewWords(state.currentDay);
  const reviewContainer = document.getElementById('vocab-review-cards');
  const reviewEmpty = document.getElementById('review-empty');
  const reviewCount = document.getElementById('review-count');

  if (dueWords.length > 0) {
    reviewCount.textContent = dueWords.length + '个';
    reviewEmpty.classList.add('hidden');
    reviewContainer.innerHTML = dueWords.map(w => `
      <div class="vocab-card review-card" data-key="${w.key}">
        <div class="word-head">
          <span class="word-en">${w.word}</span>
          <span class="word-phonetic">${w.phonetic}</span>
          <span class="word-pos">${w.pos}</span>
        </div>
        <div class="word-meaning">${w.meaning}</div>
        <div class="word-example">${w.example}</div>
        <div class="word-actions">
          <button class="word-action-btn remember" data-key="${w.key}">记住了</button>
          <button class="word-action-btn forget" data-key="${w.key}">没记住</button>
        </div>
      </div>
    `).join('');

    // 复习卡片操作
    reviewContainer.querySelectorAll('.word-action-btn.remember').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        markWordRemember(btn.dataset.key);
        renderVocabulary(dayData);
      });
    });
    reviewContainer.querySelectorAll('.word-action-btn.forget').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        markWordForget(btn.dataset.key);
        renderVocabulary(dayData);
      });
    });
    reviewContainer.querySelectorAll('.vocab-card').forEach(card => {
      card.addEventListener('click', () => {
        const word = card.querySelector('.word-en').textContent;
        speakText(word, state.settings.ttsRate);
      });
    });
  } else {
    reviewCount.textContent = '';
    reviewContainer.innerHTML = '';
    reviewEmpty.classList.remove('hidden');
  }
}

// ===== 事件绑定 =====
function bindEvents() {
  // 导航
  document.getElementById('btn-home').addEventListener('click', () => {
    stopSpeaking();
    location.hash = '#/';
  });
  document.getElementById('btn-settings').addEventListener('click', () => {
    stopSpeaking();
    location.hash = '#/settings';
  });
  document.getElementById('btn-open-parent').addEventListener('click', () => {
    stopSpeaking();
    location.hash = '#/parent';
  });

  // 环节切换
  document.querySelectorAll('.step-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      stopSpeaking();
      state.currentStep = tab.dataset.step;
      renderDay();
    });
  });

  // 朗读控制
  document.getElementById('tts-play').addEventListener('click', () => {
    const dayData = DAYS.find(d => d.day === state.currentDay);
    if (!dayData) return;
    const sentences = splitIntoSentences(dayData.text);
    speakSentences(sentences, 0, state.settings.ttsRate);
  });
  document.getElementById('tts-pause').addEventListener('click', () => {
    // 走统一控制器，保持真实播放/暂停状态与按钮文案
    if (typeof Eng30TTS !== 'undefined') {
      if (synth && synth.paused) Eng30TTS.resume();
      else Eng30TTS.pause();
      return;
    }
    if (synth) {
      if (synth.paused) synth.resume();
      else synth.pause();
    }
  });
  document.getElementById('tts-stop').addEventListener('click', stopSpeaking);

  // 语速控件由 Eng30TTS 统一绑定（含档位按钮/range/文案/持久化/播放中改速重播）。
  // 这里仅做一次初始同步；Eng30TTS 未加载时回退到旧逻辑。
  if (typeof Eng30TTS === 'undefined') {
    const rateSlider = document.getElementById('tts-rate');
    const rateVal = document.getElementById('tts-rate-val');
    if (rateSlider && rateVal) {
      rateSlider.value = state.settings.ttsRate;
      rateVal.textContent = state.settings.ttsRate.toFixed(1) + 'x';
      rateSlider.addEventListener('input', () => {
        state.settings.ttsRate = parseFloat(rateSlider.value);
        rateVal.textContent = state.settings.ttsRate.toFixed(1) + 'x';
        saveState();
      });
    }
  }

  // 默写控制
  document.getElementById('dict-play-sentence').addEventListener('click', () => {
    const dayData = DAYS.find(d => d.day === state.currentDay);
    if (!dayData) return;
    const sentences = splitIntoSentences(dayData.text);
    if (state.dictSentenceIdx < sentences.length) {
      speakText(sentences[state.dictSentenceIdx], state.settings.ttsRate);
    }
  });
  document.getElementById('dict-prev').addEventListener('click', () => {
    if (state.dictSentenceIdx > 0) {
      state.dictSentenceIdx--;
      renderDictation(DAYS.find(d => d.day === state.currentDay));
    }
  });
  document.getElementById('dict-next').addEventListener('click', () => {
    const dayData = DAYS.find(d => d.day === state.currentDay);
    const sentences = splitIntoSentences(dayData.text);
    if (state.dictSentenceIdx < sentences.length - 1) {
      state.dictSentenceIdx++;
      renderDictation(dayData);
    }
  });
  document.getElementById('dict-reveal').addEventListener('click', () => {
    const dayData = DAYS.find(d => d.day === state.currentDay);
    const sentences = splitIntoSentences(dayData.text);
    const answerEl = document.getElementById('dictation-answer');
    answerEl.textContent = sentences[state.dictSentenceIdx];
    answerEl.classList.remove('hidden');
  });

  // 完成checkbox
  ['reading', 'copying', 'dictation', 'vocabulary'].forEach(step => {
    const cb = document.getElementById('check-' + step);
    if (cb) {
      cb.addEventListener('change', () => {
        setDayProgress(state.currentDay, step, cb.checked);
        // 单词完成时调度艾宾浩斯复习
        if (step === 'vocabulary' && cb.checked) {
          scheduleWordReviews(state.currentDay);
        }
        updateCompleteButton();
        // 更新环节标签
        document.querySelectorAll('.step-tab').forEach(tab => {
          const s = tab.dataset.step;
          tab.classList.toggle('done', getDayProgress(state.currentDay)[s]);
        });
      });
    }
  });

  // 今日完成按钮
  document.getElementById('btn-day-complete').addEventListener('click', () => {
    const missing = getMissingDaySteps(getDayProgress(state.currentDay));
    if (missing.length) { showToast('还差：' + missing.map(key => STEP_NAMES[key]).join('、') + '。请逐项完成后再收尾。'); return; }
    updateCompleteButton();
    showToast('Day ' + state.currentDay + ' 四个环节均已完成！');
  });

  // 底部导航
  document.getElementById('btn-prev-day').addEventListener('click', () => {
    if (state.currentDay > 1) {
      stopSpeaking();
      location.hash = '#/day/' + (state.currentDay - 1);
    }
  });
  document.getElementById('btn-next-day').addEventListener('click', () => {
    if (state.currentDay < 30) {
      stopSpeaking();
      location.hash = '#/day/' + (state.currentDay + 1);
    }
  });
  document.getElementById('btn-back-home').addEventListener('click', () => {
    stopSpeaking();
    location.hash = '#/';
  });

  // 设置页语速：同样由 Eng30TTS 统一绑定；未加载时回退。
  if (typeof Eng30TTS === 'undefined') {
    const settingsRate = document.getElementById('settings-rate');
    const settingsRateVal = document.getElementById('settings-rate-val');
    if (settingsRate && settingsRateVal) {
      settingsRate.value = state.settings.ttsRate;
      settingsRateVal.textContent = state.settings.ttsRate.toFixed(1) + 'x';
      settingsRate.addEventListener('input', () => {
        state.settings.ttsRate = parseFloat(settingsRate.value);
        settingsRateVal.textContent = state.settings.ttsRate.toFixed(1) + 'x';
        saveState();
      });
    }
  }

  document.getElementById('btn-reset-day').addEventListener('click', () => {
    showModal('确定要重置当天（Day ' + state.currentDay + '）的学习进度吗？', () => {
      delete state.progress['day' + state.currentDay];
      saveState();
      if (location.hash.startsWith('#/day/')) {
        renderDay();
      } else {
        renderHome();
      }
    });
  });

  document.getElementById('btn-reset-all').addEventListener('click', () => {
    showModal('确定要重置全部30天的学习进度吗？此操作不可恢复。', () => {
      state.progress = {};
      state.wordStatus = {};
      saveState();
      location.hash = '#/';
    });
  });

  // 弹窗
  document.getElementById('modal-cancel').addEventListener('click', hideModal);
}

let modalCallback = null;
function showModal(text, onConfirm) {
  document.getElementById('modal-text').textContent = text;
  document.getElementById('modal-overlay').classList.remove('hidden');
  modalCallback = onConfirm;
}
function hideModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  modalCallback = null;
}
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('modal-confirm').addEventListener('click', () => {
    if (modalCallback) modalCallback();
    hideModal();
  });
});


function openParentDashboard() {
  const root = document.getElementById('parent-dashboard-root');
  if (!root) return;
  if (!window.ParentDashboard) {
    root.innerHTML = '<div class="settings-group">家长看板加载中，请稍候…</div>';
    setTimeout(openParentDashboard, 50);
    return;
  }
  ParentDashboard.init(root, { onClose: function () { location.hash = '#/settings'; } });
}

// ===== 初始化 =====
function bindBackupEvents() {
  const exportBtn=document.getElementById('btn-export-data'); const importBtn=document.getElementById('btn-import-data'); const input=document.getElementById('input-import-data');
  if (exportBtn) exportBtn.addEventListener('click', async () => { try { const json=await Eng30Storage.exportJSON(); const blob=new Blob([json], {type:'application/json;charset=utf-8'}); const url=URL.createObjectURL(blob); const link=document.createElement('a'); link.href=url; link.download='eng30-v13-backup-'+new Date().toISOString().slice(0,10)+'.json'; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),1000); showToast('备份已导出'); } catch(e) { alert('导出失败：'+e.message); } });
  if (importBtn && input) importBtn.addEventListener('click', () => input.click());
  if (input) input.addEventListener('change', async () => { const file=input.files && input.files[0]; if (!file) return; try { if (!confirm('导入会覆盖当前数据，系统会先自动保存快照。确定继续吗？')) return; await Eng30Storage.importJSON(await file.text()); alert('导入成功，页面将刷新。'); location.reload(); } catch(e) { alert('导入失败，原数据未变：'+e.message); } input.value=''; });
}

async function init() {
  await Eng30Storage.ready;
  loadState();
  // file:// 本地测试提示：仅在 file 协议下醒目显示；HTTPS/PWA 下保持 hidden，不弱化打扰。
  try {
    if (location.protocol === 'file:') {
      ['file-local-notice-home', 'file-local-notice-about'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.hidden = false;
      });
    }
  } catch (e) { /* 无节点或异常时忽略，保持 hidden */ }
  // loadState 后：把旧 ttsRate 钳制到 [0.6,1.0] 并回写，再同步统一控件 UI。
  // setRate(getRate()) 在未播放时只持久化+同步，不会触发重播。
  if (typeof Eng30TTS !== 'undefined') {
    Eng30TTS.setRate(Eng30TTS.getRate());
  }
  bindEvents();
  bindAssessmentEvents();
  updateAssessmentHome();
  bindBackupEvents();
  window.addEventListener('pagehide', saveAssessmentDraftNow);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveAssessmentDraftNow(); });

  // 注册 Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js', { scope: './' }).catch(err => {
      console.warn('Service Worker registration failed:', err);
    });
  }

  // 路由
  window.addEventListener('hashchange', () => navigate(location.hash));
  navigate(location.hash || '#/');
}


/* ===== 测评模块 ===== */
// 本地门槛密码（英文小写）。仅作遮挡，非真实安全防护。
const FINAL_PASSWORD = 'deltaforce';
const ASSESS_STORAGE = {
  entrance: 'eng30_assess_entrance',
  final: 'eng30_assess_final',
  unlocked: 'eng30_final_unlocked'
};

const assessState = {
  currentTest: null,
  currentSection: 'choice',
  answers: {},
  writingText: '',
  writingScores: {},
  timeRemaining: 0,
  deadlineAt: null,
  timerInterval: null,
  draftInterval: null,
  draftDebounce: null,
  result: null
};

function getAssessData(id) {
  if (typeof ASSESSMENTS !== 'undefined' && ASSESSMENTS[id]) return ASSESSMENTS[id];
  return null;
}

function loadAssessResult(id) {
  try {
    const raw = Eng30Storage.get(ASSESS_STORAGE[id]);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function saveAssessResult(id, result) {
  try {
    Eng30Storage.set(ASSESS_STORAGE[id], JSON.stringify(result));
  } catch (e) { console.warn('Save assess result failed:', e); }
}

function isFinalUnlocked() {
  return Eng30Storage.get(ASSESS_STORAGE.unlocked) === 'true';
}

function setFinalUnlocked(val) {
  Eng30Storage.set(ASSESS_STORAGE.unlocked, val ? 'true' : 'false');
}

/* ===== 测评首页状态更新 ===== */
function updateAssessmentHome() {
  const entranceResult = loadAssessResult('entrance');
  const finalResult = loadAssessResult('final');
  const unlocked = isFinalUnlocked();

  const entranceStatus = document.getElementById('status-entrance');
  const finalStatus = document.getElementById('status-final');
  const finalCard = document.getElementById('card-final');

  if (entranceResult) {
    entranceStatus.textContent = entranceResult.total + '分';
    entranceStatus.classList.add('done');
  } else {
    entranceStatus.textContent = '未开始';
    entranceStatus.classList.remove('done');
  }

  if (finalResult) {
    finalStatus.textContent = finalResult.total + '分';
    finalStatus.classList.add('done');
    finalCard.classList.remove('locked');
  } else if (unlocked) {
    finalStatus.textContent = '已解锁';
    finalStatus.classList.remove('done');
    finalCard.classList.remove('locked');
  } else {
    finalStatus.textContent = '已锁定';
    finalStatus.classList.remove('done');
    finalCard.classList.add('locked');
  }

  // 对比报告入口
  const compareBar = document.getElementById('compare-bar');
  if (entranceResult && finalResult) {
    compareBar.style.display = 'block';
  } else {
    compareBar.style.display = 'none';
  }
}

/* ===== 开始测评 ===== */
function assessmentDraftKey(id) { return AssessmentDraftCore.key(id); }
function readAssessmentDraft(id) {
  try { const raw = Eng30Storage.get(assessmentDraftKey(id)); return raw ? AssessmentDraftCore.normalize(JSON.parse(raw), id) : null; } catch (e) { return null; }
}
function saveAssessmentDraftNow() {
  if (!assessState.currentTest || !assessState.deadlineAt) return;
  const draft = { assessmentId: assessState.currentTest, answers: assessState.answers, writingText: assessState.writingText, currentSection: assessState.currentSection, deadlineAt: assessState.deadlineAt, remaining: AssessmentDraftCore.remaining(assessState.deadlineAt, Date.now()), savedAt: Date.now() };
  Eng30Storage.set(assessmentDraftKey(assessState.currentTest), JSON.stringify(draft));
}
function scheduleAssessmentDraftSave() { clearTimeout(assessState.draftDebounce); assessState.draftDebounce = setTimeout(saveAssessmentDraftNow, 450); }
function clearAssessmentDraft(id) { clearTimeout(assessState.draftDebounce); if (assessState.draftInterval) clearInterval(assessState.draftInterval); assessState.draftInterval = null; return Eng30Storage.remove(assessmentDraftKey(id)); }
function startAssessment(id) {
  const data = getAssessData(id); if (!data) { alert('测评数据加载中，请稍后再试'); return; }
  const draft = readAssessmentDraft(id);
  if (draft && AssessmentDraftCore.isValid(draft, Date.now()) && confirm('发现未完成测评。确定继续，取消重新开始。')) {
    assessState.currentTest=id; assessState.currentSection=draft.currentSection; assessState.answers=draft.answers; assessState.writingText=draft.writingText; assessState.writingScores={}; assessState.deadlineAt=draft.deadlineAt; assessState.result=null; beginTest(true); return;
  }
  if (draft) clearAssessmentDraft(id); assessState.currentTest=id; assessState.currentSection='choice'; assessState.answers={}; assessState.writingText=''; assessState.writingScores={}; assessState.timeRemaining=data.duration*60; assessState.deadlineAt=null; assessState.result=null;
  document.getElementById('assess-start-title').textContent=data.title; document.getElementById('assess-start-duration').textContent=data.duration; showView('assessment-start');
}
function beginTest(resuming) {
  const data=getAssessData(assessState.currentTest); if (!data) return; document.getElementById('test-title').textContent=data.title; if (resuming !== true) { assessState.currentSection='choice'; assessState.deadlineAt=Date.now()+data.duration*60000; } updateTestTabs(); renderTestSection(); startTimer(); showView('assessment-test'); saveAssessmentDraftNow(); if (assessState.draftInterval) clearInterval(assessState.draftInterval); assessState.draftInterval=setInterval(saveAssessmentDraftNow,5000);
}
function startTimer() { updateTimerDisplay(); if (assessState.timerInterval) clearInterval(assessState.timerInterval); assessState.timerInterval=setInterval(() => { assessState.timeRemaining=AssessmentDraftCore.remaining(assessState.deadlineAt,Date.now()); updateTimerDisplay(); if (assessState.timeRemaining<=0) { stopTimer(); submitTest(true); } },1000); }
function stopTimer() { if (assessState.timerInterval) clearInterval(assessState.timerInterval); assessState.timerInterval=null; }
function updateTimerDisplay() { assessState.timeRemaining=AssessmentDraftCore.remaining(assessState.deadlineAt,Date.now()); const m=Math.floor(assessState.timeRemaining/60); const sec=assessState.timeRemaining%60; const el=document.getElementById('test-timer'); el.textContent=String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0'); el.classList.toggle('warning',assessState.timeRemaining<=300); }

function updateTestTabs() {
  document.querySelectorAll('.test-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.section === assessState.currentSection);
  });
  // 标记已作答
  const data = getAssessData(assessState.currentTest);
  if (!data) return;
  document.querySelectorAll('.test-tab').forEach(tab => {
    const section = tab.dataset.section;
    let answered = false;
    if (section === 'choice') {
      answered = data.sections.choice.questions.every(q => assessState.answers[q.id]);
    } else if (section === 'reading') {
      let all = true;
      data.sections.reading.passages.forEach(p => p.questions.forEach(q => {
        if (!assessState.answers[q.id]) all = false;
      }));
      answered = all;
    } else if (section === 'writing') {
      answered = assessState.writingText.trim().length > 0;
    }
    tab.classList.toggle('answered', answered);
  });
}

function renderTestSection() {
  const data = getAssessData(assessState.currentTest);
  if (!data) return;
  const container = document.getElementById('test-content');

  if (assessState.currentSection === 'choice') {
    renderChoiceSection(data, container);
  } else if (assessState.currentSection === 'reading') {
    renderReadingSection(data, container);
  } else if (assessState.currentSection === 'writing') {
    renderWritingSection(data, container);
  }

  // 底部按钮状态
  document.getElementById('btn-test-prev').disabled = assessState.currentSection === 'choice';
  document.getElementById('btn-test-next').disabled = assessState.currentSection === 'writing';
}

function renderChoiceSection(data, container) {
  const questions = data.sections.choice.questions;
  let html = '';
  questions.forEach((q, idx) => {
    const selected = assessState.answers[q.id] || '';
    html += '<div class="choice-question">';
    html += '<div class="choice-q-text"><span class="choice-q-num">' + (idx + 1) + '.</span> ' + escapeHtml(q.question) + '</div>';
    html += '<div class="choice-options">';
    q.options.forEach((opt, oi) => {
      const letter = String.fromCharCode(65 + oi);
      const isSel = selected === letter;
      html += '<label class="choice-option' + (isSel ? ' selected' : '') + '" data-qid="' + q.id + '" data-letter="' + letter + '">';
      html += '<input type="radio" name="' + q.id + '" value="' + letter + '"' + (isSel ? ' checked' : '') + '>';
      html += '<span>' + escapeHtml(opt) + '</span>';
      html += '</label>';
    });
    html += '</div></div>';
  });
  container.innerHTML = html;

  // 绑定选择事件
  container.querySelectorAll('.choice-option').forEach(label => {
    label.addEventListener('click', () => {
      const qid = label.dataset.qid;
      const letter = label.dataset.letter;
      assessState.answers[qid] = letter;
      scheduleAssessmentDraftSave();
      // 更新视觉
      container.querySelectorAll('.choice-option[data-qid="' + qid + '"]').forEach(l => l.classList.remove('selected'));
      label.classList.add('selected');
      label.querySelector('input').checked = true;
      updateTestTabs();
    });
  });
}

function renderReadingSection(data, container) {
  const passages = data.sections.reading.passages;
  const typeLabels = { literal: '字面理解', vocabulary: '词义推断', integration: '信息整合', mainidea: '主旨大意', inference: '合理推断' };
  let html = '';
  passages.forEach((p, pi) => {
    html += '<div class="reading-passage">';
    html += '<div class="reading-passage-title">Passage ' + (pi + 1) + ': ' + escapeHtml(p.title) + '</div>';
    html += '<div class="reading-passage-text">' + escapeHtml(p.text) + '</div>';
    p.questions.forEach((q, qi) => {
      const selected = assessState.answers[q.id] || '';
      html += '<div class="reading-question">';
      html += '<span class="reading-q-type">' + (typeLabels[q.type] || q.type) + '</span>';
      html += '<div class="choice-q-text"><span class="choice-q-num">' + (pi + 1) + '.' + (qi + 1) + '</span> ' + escapeHtml(q.question) + '</div>';
      html += '<div class="choice-options">';
      q.options.forEach((opt, oi) => {
        const letter = String.fromCharCode(65 + oi);
        const isSel = selected === letter;
        html += '<label class="choice-option' + (isSel ? ' selected' : '') + '" data-qid="' + q.id + '" data-letter="' + letter + '">';
        html += '<input type="radio" name="' + q.id + '" value="' + letter + '"' + (isSel ? ' checked' : '') + '>';
        html += '<span>' + escapeHtml(opt) + '</span>';
        html += '</label>';
      });
      html += '</div></div>';
    });
    html += '</div>';
  });
  container.innerHTML = html;

  container.querySelectorAll('.choice-option').forEach(label => {
    label.addEventListener('click', () => {
      const qid = label.dataset.qid;
      const letter = label.dataset.letter;
      assessState.answers[qid] = letter;
      scheduleAssessmentDraftSave();
      container.querySelectorAll('.choice-option[data-qid="' + qid + '"]').forEach(l => l.classList.remove('selected'));
      label.classList.add('selected');
      label.querySelector('input').checked = true;
      updateTestTabs();
    });
  });
}

function renderWritingSection(data, container) {
  const w = data.sections.writing;
  let html = '<div class="writing-task">';
  html += '<h4>写作任务</h4>';
  html += '<div class="writing-task-desc">' + escapeHtml(w.task) + '</div>';
  html += '<div class="writing-word-count">词数要求：' + escapeHtml(w.wordCount) + '</div>';
  html += '</div>';
  html += '<textarea class="writing-textarea" id="writing-input" placeholder="在此写下你的作文...">' + escapeHtml(assessState.writingText) + '</textarea>';
  html += '<div class="writing-counter" id="writing-counter">0 词</div>';
  container.innerHTML = html;

  const textarea = document.getElementById('writing-input');
  const counter = document.getElementById('writing-counter');
  const updateCount = () => {
    assessState.writingText = textarea.value;
    scheduleAssessmentDraftSave();
    const words = textarea.value.trim() ? textarea.value.trim().split(/\s+/).length : 0;
    counter.textContent = words + ' 词';
    updateTestTabs();
  };
  textarea.addEventListener('input', updateCount);
  updateCount();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ===== 交卷与评分 ===== */
function submitTest(auto) {
  if (!auto) {
    const unanswered = countUnanswered();
    if (unanswered > 0) {
      if (!confirm('还有 ' + unanswered + ' 道题未作答，未作答不得分。确定交卷吗？')) return;
    } else {
      if (!confirm('确定要交卷吗？')) return;
    }
  }
  stopTimer();
  const result = scoreTest();
  assessState.result = result;
  saveAssessResult(assessState.currentTest, result);
  clearAssessmentDraft(assessState.currentTest);
  renderResult(result);
  showView('assessment-result');
}

function countUnanswered() {
  const data = getAssessData(assessState.currentTest);
  if (!data) return 0;
  let count = 0;
  data.sections.choice.questions.forEach(q => { if (!assessState.answers[q.id]) count++; });
  data.sections.reading.passages.forEach(p => p.questions.forEach(q => { if (!assessState.answers[q.id]) count++; }));
  if (!assessState.writingText.trim()) count++;
  return count;
}

function scoreTest() {
  const data = getAssessData(assessState.currentTest);
  if (!data) return null;

  let choiceScore = 0;
  const wrongChoice = [];
  data.sections.choice.questions.forEach(q => {
    const userAns = assessState.answers[q.id] || '';
    if (userAns === q.answer) {
      choiceScore += q.points;
    } else {
      wrongChoice.push({ ...q, userAnswer: userAns || '未作答' });
    }
  });

  let readingScore = 0;
  const wrongReading = [];
  data.sections.reading.passages.forEach(p => {
    p.questions.forEach(q => {
      const userAns = assessState.answers[q.id] || '';
      if (userAns === q.answer) {
        readingScore += q.points;
      } else {
        wrongReading.push({ ...q, userAnswer: userAns || '未作答', passageTitle: p.title });
      }
    });
  });

  // 写作默认0分，需要用户在结果页按量表评分
  const writingScore = 0;

  const total = choiceScore + readingScore + writingScore;

  return {
    testId: assessState.currentTest,
    testTitle: data.title,
    date: new Date().toISOString(),
    choiceScore: choiceScore,
    readingScore: readingScore,
    writingScore: writingScore,
    total: total,
    writingText: assessState.writingText,
    writingScores: {},
    wrongChoice: wrongChoice,
    wrongReading: wrongReading
  };
}

/* ===== 结果页渲染 ===== */
function renderResult(result) {
  document.getElementById('result-title').textContent = result.testTitle + ' - 成绩报告';
  document.getElementById('result-total-score').textContent = result.total;
  document.getElementById('subscore-choice').textContent = result.choiceScore + ' / 30';
  document.getElementById('subscore-reading').textContent = result.readingScore + ' / 50';
  document.getElementById('subscore-writing').textContent = result.writingScore + ' / 20';

  // 写作评分区
  const data = getAssessData(result.testId);
  const w = data.sections.writing;

  document.getElementById('writing-text-preview').textContent = result.writingText || '(未作答)';
  document.getElementById('writing-example').textContent = w.example;
  document.getElementById('writing-analysis').textContent = w.analysis;

  // 量表输入
  const rubricContainer = document.getElementById('rubric-list');
  let rubricHtml = '';
  w.rubric.forEach((r, i) => {
    const saved = result.writingScores[r.criteria] || 0;
    rubricHtml += '<div class="rubric-item">';
    rubricHtml += '<label>' + escapeHtml(r.criteria) + '（' + escapeHtml(r.description) + '）</label>';
    rubricHtml += '<input type="number" min="0" max="' + r.points + '" value="' + saved + '" data-criteria="' + escapeHtml(r.criteria) + '" data-max="' + r.points + '">';
    rubricHtml += '<span class="rubric-max">/ ' + r.points + '分</span>';
    rubricHtml += '</div>';
  });
  rubricContainer.innerHTML = rubricHtml;

  // 错题解析
  const wrongList = document.getElementById('wrong-list');
  const allCorrect = document.getElementById('all-correct');
  const allWrong = result.wrongChoice.concat(result.wrongReading);

  if (allWrong.length === 0) {
    wrongList.innerHTML = '';
    allCorrect.classList.remove('hidden');
  } else {
    allCorrect.classList.add('hidden');
    let html = '';
    result.wrongChoice.forEach(q => {
      html += renderWrongItem(q, '选择题');
    });
    result.wrongReading.forEach(q => {
      html += renderWrongItem(q, '阅读 - ' + q.passageTitle);
    });
    wrongList.innerHTML = html;
  }
}

function renderWrongItem(q, sectionLabel) {
  let html = '<div class="wrong-item">';
  html += '<div class="wrong-q-text">[' + sectionLabel + '] ' + escapeHtml(q.question) + '</div>';
  html += '<div class="wrong-answer-row">';
  html += '<span class="wrong-user">你的答案：' + escapeHtml(q.userAnswer) + '</span>';
  html += '<span class="wrong-correct">正确答案：' + escapeHtml(q.answer) + '</span>';
  html += '</div>';
  html += '<div class="wrong-explanation">' + escapeHtml(q.explanation) + '</div>';
  html += '</div>';
  return html;
}

function updateWritingScore() {
  const result = assessState.result;
  if (!result) return;
  const data = getAssessData(result.testId);
  const w = data.sections.writing;

  let total = 0;
  const scores = {};
  document.querySelectorAll('#rubric-list input[type="number"]').forEach(input => {
    const criteria = input.dataset.criteria;
    const max = parseInt(input.dataset.max, 10);
    let val = parseInt(input.value, 10) || 0;
    if (val < 0) val = 0;
    if (val > max) val = max;
    input.value = val;
    scores[criteria] = val;
    total += val;
  });

  result.writingScore = total;
  result.writingScores = scores;
  result.total = result.choiceScore + result.readingScore + result.writingScore;
  saveAssessResult(result.testId, result);

  document.getElementById('result-total-score').textContent = result.total;
  document.getElementById('subscore-writing').textContent = result.writingScore + ' / 20';
  showToast('写作得分已更新：' + total + '分');
}

/* ===== 对比报告 ===== */
function renderCompare() {
  const entrance = loadAssessResult('entrance');
  const final = loadAssessResult('final');
  const tbody = document.getElementById('compare-tbody');
  const summary = document.getElementById('compare-summary');

  if (!entrance || !final) {
    tbody.innerHTML = '<tr><td colspan="4">需要完成入学测评和期末测评后才能对比</td></tr>';
    summary.innerHTML = '';
    return;
  }

  const rows = [
    { name: '总分', e: entrance.total, f: final.total, max: 100 },
    { name: '选择题', e: entrance.choiceScore, f: final.choiceScore, max: 30 },
    { name: '阅读理解', e: entrance.readingScore, f: final.readingScore, max: 50 },
    { name: '写作', e: entrance.writingScore, f: final.writingScore, max: 20 }
  ];

  let html = '';
  rows.forEach(r => {
    const diff = r.f - r.e;
    const cls = diff > 0 ? 'up' : diff < 0 ? 'down' : 'same';
    const sign = diff > 0 ? '+' : '';
    html += '<tr>';
    html += '<td>' + r.name + '</td>';
    html += '<td>' + r.e + ' / ' + r.max + '</td>';
    html += '<td>' + r.f + ' / ' + r.max + '</td>';
    html += '<td class="' + cls + '">' + sign + diff + '</td>';
    html += '</tr>';
  });
  tbody.innerHTML = html;

  const totalDiff = final.total - entrance.total;
  const pct = ((final.total - entrance.total) / 100 * 100).toFixed(0);
  let summaryText = '';
  if (totalDiff > 0) {
    summaryText = '经过30天的学习，总分从 ' + entrance.total + ' 提升到 ' + final.total + '，提高了 ' + totalDiff + ' 分（' + pct + '%）。';
    if (final.choiceScore > entrance.choiceScore) summaryText += '选择题进步 ' + (final.choiceScore - entrance.choiceScore) + ' 分。';
    if (final.readingScore > entrance.readingScore) summaryText += '阅读理解进步 ' + (final.readingScore - entrance.readingScore) + ' 分。';
    summaryText += '继续保持！';
  } else if (totalDiff < 0) {
    summaryText = '总分从 ' + entrance.total + ' 变为 ' + final.total + '，下降了 ' + Math.abs(totalDiff) + ' 分。建议回顾错题解析，加强薄弱环节。';
  } else {
    summaryText = '总分持平（' + entrance.total + '分），可以针对错题进行专项练习。';
  }
  summary.textContent = summaryText;
}

/* ===== 测评事件绑定 ===== */
function bindAssessmentEvents() {
  // 首页测评卡片
  document.getElementById('card-entrance').addEventListener('click', () => {
    startAssessment('entrance');
  });
  document.getElementById('card-final').addEventListener('click', () => {
    if (isFinalUnlocked() || loadAssessResult('final')) {
      startAssessment('final');
    } else {
      showView('assessment-lock');
    }
  });

  // 开始按钮
  document.getElementById('btn-assess-start').addEventListener('click', beginTest);

  // 密码解锁
  document.getElementById('btn-lock-unlock').addEventListener('click', () => {
    const input = document.getElementById('lock-password');
    const error = document.getElementById('lock-error');
    if (input.value === FINAL_PASSWORD) {
      setFinalUnlocked(true);
      error.classList.add('hidden');
      input.value = '';
      startAssessment('final');
    } else {
      error.classList.remove('hidden');
    }
  });
  document.getElementById('lock-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-lock-unlock').click();
  });
  document.getElementById('btn-lock-back').addEventListener('click', () => {
    location.hash = '#/';
  });

  // 答题部分切换
  document.querySelectorAll('.test-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      assessState.currentSection = tab.dataset.section;
      scheduleAssessmentDraftSave();
      updateTestTabs();
      renderTestSection();
    });
  });

  // 答题导航
  document.getElementById('btn-test-prev').addEventListener('click', () => {
    const sections = ['choice', 'reading', 'writing'];
    const idx = sections.indexOf(assessState.currentSection);
    if (idx > 0) {
      assessState.currentSection = sections[idx - 1];
      scheduleAssessmentDraftSave();
      updateTestTabs();
      renderTestSection();
    }
  });
  document.getElementById('btn-test-next').addEventListener('click', () => {
    const sections = ['choice', 'reading', 'writing'];
    const idx = sections.indexOf(assessState.currentSection);
    if (idx < sections.length - 1) {
      assessState.currentSection = sections[idx + 1];
      scheduleAssessmentDraftSave();
      updateTestTabs();
      renderTestSection();
    }
  });

  // 交卷
  document.getElementById('btn-test-submit').addEventListener('click', () => submitTest(false));

  // 写作评分更新
  document.getElementById('btn-update-writing-score').addEventListener('click', updateWritingScore);

  // 结果页导航
  document.getElementById('btn-result-home').addEventListener('click', () => {
    stopTimer();
    location.hash = '#/';
  });
  document.getElementById('btn-result-compare').addEventListener('click', () => {
    renderCompare();
    showView('assessment-compare');
  });

  // 对比页
  document.getElementById('btn-compare').addEventListener('click', () => {
    renderCompare();
    showView('assessment-compare');
  });
  document.getElementById('btn-compare-home').addEventListener('click', () => {
    location.hash = '#/';
  });
}

// 测评模块初始化（init已在上方直接调用，此处直接绑定测评事件）
init();

/* ===== 隐藏平台注入水印 ===== */
(function removeWatermark() {
  function tryRemove() {
    const wm = document.querySelector('.watermark-root');
    if (wm) wm.remove();
    // 同时检查 shadow DOM
    document.querySelectorAll('*').forEach(el => {
      if (el.shadowRoot) {
        const swm = el.shadowRoot.querySelector('.watermark-root');
        if (swm) swm.remove();
      }
    });
  }
  tryRemove();
  const observer = new MutationObserver(() => tryRemove());
  observer.observe(document.body, { childList: true, subtree: true });
  // 3秒后再检查一次（平台可能延迟注入）
  setTimeout(tryRemove, 3000);
})();
