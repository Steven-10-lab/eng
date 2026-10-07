# 单词听说练习模块 — 集成说明

本模块完全独立，**不修改** `index.html` / `app.js` / `styles.css` / `data.js`，
仅需插入 **1 个容器 div** + **2 行静态资源引用** + **1 行初始化**。

新增文件（已就位）：

| 文件 | 作用 |
|---|---|
| `vocab-speaking.js` | 模块本体（纯原生 JS，零依赖，ES5 语法可在 Node 直接 require） |
| `vocab-speaking.css` | 模块样式（全部 scoped 到 `.vsp-box`，复用既有 CSS 变量） |

---

## 1. 这个模块做什么

针对当天 `dayData.words`（`[{word, phonetic, pos, meaning, example}, …]`）逐个单词做
**「听示范 → 跟读 → 反馈 → 再来一次/下一个」**渐进练习：

- 每个词提供四种声音能力：
  1. **系统标准发音**（TTS 读单词本体，1.0 倍速）
  2. **慢速播放**（同词 0.5 倍速）
  3. **例句朗读**（TTS 读 `example`）
  4. **麦克风跟读**（`SpeechRecognition / webkitSpeechRecognition`，`en-US`）
- **单词判定**：识别文本经 `normalizeWord` 归一化后与目标词**精确匹配**
  （容忍 "grass hopper" 拆词拼接成 "grasshopper"，但多余实义词即判错）。
- **例句跟读**：走 `alignWords` 按词序 DP 对齐，展示
  **正确 / 错 / 漏 / 多**词着色与计数，文本准确度 0–100。
- 所有反馈区均显著标注：
  **「文本准确度仅作参考，不是专业音素/发音评分」**。

## 2. 在 `index.html` 中插入（共 3 处最小改动）

### ① `<head>` 内追加 CSS（在 `styles.css` 之后）

```html
<link rel="stylesheet" href="styles.css">
<link rel="stylesheet" href="vocab-speaking.css">   <!-- 新增 -->
```

### ② 单词面板里插入挂载点（建议放在单词列表区末尾）

```html
<!-- ↓↓↓ 单词听说练习挂载点（仅此一个 div） ↓↓↓ -->
<div id="vocab-speaking-mount"></div>
<!-- ↑↑↑ 单词听说练习挂载点 ↑↑↑ -->
```

模块会自己往这个 div 里动态渲染全部 UI（单词卡/进度/阶段按钮/反馈/历史），
**不需要**再写任何 HTML。

### ③ `</body>` 前追加 JS（在 `app.js` 之后）

```html
<script src="data.js"></script>
<script src="assessments.js"></script>
<script src="app.js"></script>
<script src="shadowing.js"></script>          <!-- 已有的并行模块，可选 -->
<script src="vocab-speaking.js"></script>     <!-- 新增 -->
<script>
  // 挂载：传入当天 dayData 和容器
  var _vspDay = DAYS.find(function (d) { return d.day === state.currentDay; });
  VocabSpeaking.mount('vocab-speaking-mount', _vspDay);
</script>
```

## 3. 切 Day 后自动刷新（可选，1 行）

模块挂载时读一次传入的 `dayData`。若希望**切天后自动换词表**，
可在 `app.js` 渲染单词区的末尾加一行（可选改动）：

```js
if (window.VocabSpeaking && VocabSpeaking.refresh) {
  VocabSpeaking.refresh(dayData);   // ← 新增
}
```

不加也能用：模块右上角有「重读本天单词」按钮，手动点一下即可。

---

## 4. 对外 API

```js
// 挂载（重复调用会先清空旧实例）
VocabSpeaking.mount(containerOrId, dayData, { /* 保留 */ });

// 换 dayData 后重置进度
VocabSpeaking.refresh(dayData);

// 纯函数（Node 下直接 require('vocab-speaking.js') 即用）
VocabSpeakingCore.normalizeWord(w)      // 大小写/弯直撇号/标点/口语变体等价
VocabSpeakingCore.checkWord(refWord, heardText)
                                        // {pass, target, tokens, joined}
VocabSpeakingCore.alignWords(ref, hyp)   // 按词序对齐：correct/wrong/missing/extra + score
VocabSpeakingCore.pushLimited(list, rec, max)  // 限量追加
```

> **对齐核心的加载顺序**：运行时优先复用 `window.ShadowingCore`
> （若 `shadowing.js` 已加载），否则用本文件内置的同构实现。
> 两个文件谁先加载都能正常工作，不构成硬依赖。

---

## 5. 与既有艾宾浩斯逻辑的边界（重要）

- 本模块把每次跟读结果只当作**一次练习记录**：
  - 写入**独立** `localStorage` key：`eng30_vocab_speaking_v1`；
  - **绝不读写** `eng30_state_v1`，不碰 `state.words` / `nextReview` / `stage`。
- 单词在本模块「读对」**不会**触发任何「已记住」标记。
- 页面上原有的 **「记住 / 没记住」按钮继续由 `app.js` 旧逻辑管理**，
  本模块不监听、不改动它们。
- 事件桥：若 `window.Eng30Events` 存在，会防御式调用：
  - 每次跟读完成 → `Eng30Events.recordAttempt({day, word, pass, heard, manual, attempts})`
  - 点「重做错词」 → `Eng30Events.recordRedo({day, words:[...]})`

## 6. 状态与持久化结构

```
eng30_vocab_speaking_v1 = {
  words: {
    "<normalizeWord>": {
      word: "grasshopper",
      attempts: 3,            // 总尝试次数
      correct: 2, wrong: 1,   // 对/错计数
      best: 100,              // 最好成绩（词读对=100）
      last: {ts, day, pass, heard, manual},
      history: [ …最近 20 次… ]
    }
  },
  wrongList: [ {ts, day, word, heard}, … ]   // 错词历史，限量 50
}
```

页面底部展示：总尝试 / 正确率 / 最近一词 / 最近 5 个错词。

## 7. TTS 与识别互斥

- 点任何「听示范」按钮 → 先 `abort()` 掉识别，再 `speak()`；
- 点任何「跟读」按钮 → 先 `cancel()` 掉 TTS，再 `rec.start()`；
- 双方持锁期间，对方的按钮自动 `disabled`（CSS 灰化 + 禁点）。

## 8. 降级与提示链路

| 场景 | 表现 |
|---|---|
| 浏览器无 `SpeechRecognition/webkitSpeechRecognition` | 顶部黄条提示，自动降级为「听标准朗读 + 保存录音」，麦克风类按钮禁用 |
| `file://` 本地打开 | 顶部黄条提示：识别通常不可用，建议 Safari 添加到主屏幕 |
| 麦克风权限被拒（`not-allowed`） | 顶部红条提示，自动切「保存录音待重新评分」，麦克风类按钮禁用 |
| 识别 `no-speech` | 反馈区提示「没有识别到语音，点重录再试」 |
| 识别 `network` 失败 | 顶部提示需联网，降级为听标准朗读对照 |
| 无 `speechSynthesis` | 顶部提示当前浏览器不支持语音合成 |

所有「不支持」路径下，**标准朗读按钮始终可用**，按钮均有明确禁用态。

## 9. 兼容性

- iOS：需 **Safari 17+**（WebKit 才实现 SpeechRecognition）；低版本保存录音待重新评分。
- 安卓/桌面：Chrome / Edge 支持 `webkitSpeechRecognition`。
- `file://` 协议下识别多不可用，属浏览器安全策略，模块有提示。
