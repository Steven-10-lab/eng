#!/usr/bin/env node
/* P0 验收测试：统一 TTS 控制器 Eng30TTS
 * 用 mock speechSynthesis 在 Node 下验证：
 *  - 默认 0.75；旧值钳制 [0.6,1.0]
 *  - 未播放调速：仅持久化，不重播
 *  - 播放中调速：cancel 后从「当前句头」自动重播
 *  - 队列中间句：onend 自动推进到下一句
 *  - 停止后调速：不重播
 *  - 持久化 state.settings.ttsRate
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', 'source');
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.error('  ✗ ' + name); }
}

// ---- 构建沙箱 ----
function makeMockSynth() {
  const spoken = [];
  const api = {
    cancelled: 0,
    current: null,
    speakCount: 0,
    spoken: spoken,
    speak(u) { this.speakCount++; this.current = u; spoken.push(u); },
    cancel() { this.cancelled++; const c = this.current; this.current = null; if (c) c.__cancelled = true; },
    pause() {}, resume() {},
    // 手动触发当前句结束
    endCurrent() { const c = this.current; this.current = null; if (c && c.onend) c.onend(); },
  };
  return api;
}

function createUtteranceCtor() {
  return function SpeechSynthesisUtterance(text) {
    this.text = text; this.rate = 1; this.lang = 'en-US'; this.pitch = 1;
    this.onend = null; this.onerror = null; this.__cancelled = false;
  };
}

function loadController() {
  const code = fs.readFileSync(path.join(root, 'tts-controller.js'), 'utf8');
  const sandbox = {};
  sandbox.globalThis = sandbox;
  sandbox.window = undefined;
  sandbox.console = console;
  // state / saveState 由宿主（app.js）提供，这里注入
  sandbox.state = { settings: { ttsRate: 1.0 } };
  sandbox.saveState = function () {};
  sandbox.SpeechSynthesisUtterance = createUtteranceCtor();
  sandbox.setTimeout = setTimeout;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'tts-controller.js' });
  return sandbox;
}

let s = loadController();
let T = s.Eng30TTS;

console.log('\n[1] 默认值与旧值钳制');
s.state.settings.ttsRate = 1.0; // 旧默认
check('首次 getRate() 旧值1.0 → 1.0（在范围内）', T.getRate() === 1.0);
s.state.settings.ttsRate = 1.5; // 旧设置滑到过 1.5
check('旧值 1.5 钳制到 1.0', T.getRate() === 1.0);
s.state.settings.ttsRate = 0.3;
check('旧值 0.3 钳制到 0.6', T.getRate() === 0.6);
s.state.settings.ttsRate = 0.75;
check('默认 0.75 学习速度', T.getRate() === 0.75);
check('档位包含 0.6/0.75/0.9/1.0',
  [0.6, 0.75, 0.9, 1.0].every(r => T.PRESETS.some(p => Math.abs(p.rate - r) < 1e-9)));
check('rateLabel(0.75) = "0.75× 学习速度"', T.rateLabel(0.75) === '0.75× 学习速度');
check('rateLabel(0.6) = "0.6× 慢速速度"', T.rateLabel(0.6) === '0.6× 慢速速度');
check('getWordRate(0.75) ≈ 0.6（单词慢速）', Math.abs(T.getWordRate() - 0.6) < 1e-9);

console.log('\n[2] 未播放时调速：仅持久化，不重播');
{
  const mock = makeMockSynth();
  T.__test.installMockSynth(mock);
  T.__test.reset();
  s.state.settings.ttsRate = 0.75;
  const speakBefore = mock.speakCount;
  T.setRate(0.9);
  check('setRate(0.9) 持久化到 state.settings.ttsRate', s.state.settings.ttsRate === 0.9);
  check('未播放时 setRate 不触发任何 speak', mock.speakCount === speakBefore);
  check('isSpeaking() 为 false', T.isSpeaking() === false);
}

console.log('\n[3] 播放中调速：cancel 后从当前句头重播');
{
  const mock = makeMockSynth();
  T.__test.installMockSynth(mock);
  T.__test.reset();
  s.state.settings.ttsRate = 0.75;
  const sentences = ['A.', 'B.', 'C.'];
  T.speakSentences(sentences, 0);
  check('队列启动：第1句被播放', mock.spoken[0] && mock.spoken[0].text === 'A.');
  check('当前 index = 0', T.currentIndex() === 0);
  // 播完 A. → 推进到 B.
  mock.endCurrent();
  check('播完 A. 后当前 index = 1', T.currentIndex() === 1);
  check('现在播放 B.', mock.spoken[mock.spoken.length - 1].text === 'B.');
  const speakBeforeRateChange = mock.speakCount;
  // 播放中调速到 0.6
  T.setRate(0.6);
  check('播放中调速触发了新的 speak（重播当前句）', mock.speakCount === speakBeforeRateChange + 1);
  const last = mock.spoken[mock.spoken.length - 1];
  check('重播的是当前句头 B.（而非跳到 C.）', last.text === 'B.');
  check('重播使用了新速率 0.6', last.rate === 0.6);
  check('cancel 被调用过', mock.cancelled >= 1);
}

console.log('\n[4] 队列中间句：onend 自动推进');
{
  const mock = makeMockSynth();
  T.__test.installMockSynth(mock);
  T.__test.reset();
  s.state.settings.ttsRate = 0.75;
  T.speakSentences(['X.', 'Y.', 'Z.'], 0);
  mock.endCurrent(); // X done → Y
  check('X 结束后播 Y', mock.spoken[mock.spoken.length - 1].text === 'Y.');
  mock.endCurrent(); // Y done → Z
  check('Y 结束后播 Z', mock.spoken[mock.spoken.length - 1].text === 'Z.');
  mock.endCurrent(); // Z done → end
  check('队列播完后 isSpeaking=false', T.isSpeaking() === false);
  check('队列播完后 index=-1（无残留）', T.currentIndex() === -1);
}

console.log('\n[5] 停止后调速：不重播');
{
  const mock = makeMockSynth();
  T.__test.installMockSynth(mock);
  T.__test.reset();
  s.state.settings.ttsRate = 0.75;
  T.speakSentences(['P.', 'Q.'], 0);
  mock.endCurrent(); // advance to Q
  check('停前正在播 Q', mock.spoken[mock.spoken.length - 1].text === 'Q.');
  T.stop();
  check('stop() 后 isSpeaking=false', T.isSpeaking() === false);
  const speakBefore = mock.speakCount;
  T.setRate(0.9);
  check('停止后 setRate 不触发 speak', mock.speakCount === speakBefore);
  check('停止后 setRate 仍持久化', s.state.settings.ttsRate === 0.9);
}

console.log('\n[6] 持久化与档位往返');
{
  const mock = makeMockSynth();
  T.__test.installMockSynth(mock);
  T.__test.reset();
  s.state.settings.ttsRate = 0.75;
  T.setRate(1.0);
  check('点标准档 → state.settings.ttsRate=1.0', s.state.settings.ttsRate === 1.0);
  T.setRate(0.6);
  check('点慢速档 → state.settings.ttsRate=0.6', s.state.settings.ttsRate === 0.6);
}

console.log('\n[7] 页面级持久化：window.state 暴露 + 旧值钳制回写 localStorage');
{
  // 模拟真实浏览器：localStorage 持久层 + app.js 暴露的 window.state/saveState
  const STORAGE_KEY = 'eng30_state_v1';
  const store = {};
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
  // 旧版本用户：已把 ttsRate 滑到过 1.5（超出新范围）
  store[STORAGE_KEY] = JSON.stringify({
    progress: {}, wordStatus: {}, settings: { ttsRate: 1.5 }
  });

  const sb = {};
  sb.globalThis = sb;
  sb.window = sb;            // 浏览器里 window 即全局
  sb.console = console;
  sb.localStorage = localStorage;
  sb.SpeechSynthesisUtterance = createUtteranceCtor();
  sb.setTimeout = setTimeout;
  // 注意：此时先不挂 state（模拟真实顺序：tts-controller.js 先加载，app.js 后跑）。

  // 先加载 tts-controller.js（脚本顺序在 app.js 之前）
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(root, 'tts-controller.js'), 'utf8'), sb);
  const ET = sb.Eng30TTS;

  // 再模拟 app.js：顶层 state + 显式暴露 window.state/window.saveState
  sb.state = { settings: { ttsRate: 1.0 } };
  sb.saveState = function () {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings: sb.state.settings }));
  };

  // 模拟 app.js loadState()：从 localStorage 读出旧设置 1.5
  const savedAll = JSON.parse(localStorage.getItem(STORAGE_KEY));
  Object.assign(sb.state.settings, savedAll.settings || {});
  check('app.loadState 读到旧设置 ttsRate=1.5', sb.state.settings.ttsRate === 1.5);
  check('getRate() 立即钳制为 1.0', ET.getRate() === 1.0);
  // 模拟 app.js init() 里的钳制回写：Eng30TTS.setRate(Eng30TTS.getRate())
  ET.setRate(ET.getRate());
  check('init 钳制后内存 state.settings.ttsRate=1.0', sb.state.settings.ttsRate === 1.0);
  const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY));
  check('init 钳制回写 localStorage → settings.ttsRate=1.0', persisted.settings.ttsRate === 1.0);

  // 旧值 0.3 的用户同样钳制到 0.6
  store[STORAGE_KEY] = JSON.stringify({ settings: { ttsRate: 0.3 } });
  sb.state.settings.ttsRate = 0.3;
  ET.setRate(ET.getRate());
  check('旧值 0.3 钳制后 localStorage=0.6',
    JSON.parse(localStorage.getItem(STORAGE_KEY)).settings.ttsRate === 0.6);
}

console.log('\n========================================');
console.log(`结果：${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
