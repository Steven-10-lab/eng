# 逐句跟读评分模块 — 集成说明

本模块完全独立，**不修改** `index.html` / `app.js` / `styles.css` / `data.js`，
仅需在既有「每日学习 → 朗读」面板里插入 **1 个容器 div** + **2 行静态资源引用** + **1 行初始化**。

新增文件（已就位）：

| 文件 | 作用 |
|---|---|
| `shadowing.js` | 模块本体（纯原生 JS，零依赖） |
| `shadowing.css` | 模块样式（全部 scoped 到 `.sh-box`，复用既有 CSS 变量） |

---

## 1. 在 `index.html` 中插入（共 3 处最小改动）

### ① `<head>` 内追加 CSS（在 `styles.css` 之后）

```html
<link rel="stylesheet" href="styles.css">
<link rel="stylesheet" href="shadowing.css">   <!-- 新增 -->
```

### ② `#panel-reading` 内插入挂载点（建议放在 `#reading-translation` 之后）

```html
<div class="passage-text" id="reading-text"></div>
<div class="passage-translation" id="reading-translation"></div>

<!-- ↓↓↓ 逐句跟读评分挂载点（仅此一个 div） ↓↓↓ -->
<div id="shadowing-mount"></div>
<!-- ↑↑↑ 逐句跟读评分挂载点 ↑↑↑ -->

<div class="complete-bar">
  <label class="check-label"><input type="checkbox" id="check-reading"> 朗读完成</label>
</div>
```

模块会自己往这个 div 里动态渲染全部 UI（标题/进度/句子高亮/按钮/历史），
**不需要**再写任何 HTML。

### ③ `</body>` 前追加 JS（在 `app.js` 之后）

```html
<script src="data.js"></script>
<script src="assessments.js"></script>
<script src="app.js"></script>
<script src="shadowing.js"></script>   <!-- 新增 -->
<script>
  // 挂载：默认自动读取全局 DAYS + state.currentDay 的英文原文
  Shadowing.mount('shadowing-mount');
</script>
```

---

## 2. 切换 Day 后自动刷新（可选，1 行）

模块默认在挂载时读一次 `state.currentDay`。若希望**切天后自动重读原文**，
可在 `app.js` 的 `renderReading(dayData)` 末尾加一行（可选改动）：

```js
function renderReading(dayData) {
  const container = document.getElementById('reading-text');
  // ……既有代码不变……
  container.querySelectorAll('.sentence').forEach(span => { /* …… */ });

  if (window.Shadowing && Shadowing.refresh) Shadowing.refresh(); // ← 新增
}
```

不加也能用：模块右上角有「重读今日文章」按钮，手动点一下即可。

---

## 3. 对外 API

```js
// 挂载（重复调用会先清空旧实例）
Shadowing.mount(containerOrId, {
  // 可选：自定义取文函数。默认读 DAYS.find(d => d.day === state.currentDay).text
  getDayText: function () { return { text: '...', day: 1 }; }
});

// 重新读取当前 day 原文（切天/重进朗读页后调用）
Shadowing.refresh();

// 纯函数（也挂在 ShadowingCore，Node 下直接 require('shadowing.js') 即用）
ShadowingCore.splitSentences(text)      // 科学切句
ShadowingCore.normalizeWord(w)          // 大小写/弯直撇号/标点/缩写等价
ShadowingCore.alignWords(ref, hyp)      // 按词序对齐：correct/wrong/missing/extra
ShadowingCore.scoreSentence(ref, hyp)   // 0-100
ShadowingCore.scorePassage(scores, sents) // 按目标词数加权
ShadowingCore.pushRecord(list, rec, 20) // 保留最近 20 次
```

---

## 4. 行为与降级说明

- **切句**：按 `. ! ?` 切句；缩写点号（Mr./Dr.）不切；对话归属语 `"…," he said.` 不切碎。
- **互斥**：TTS 开始前必停识别，识别开始前必停 TTS（代码内双向 `stop*()` 保证）。
- **评分**：词级 F1（正确/(参考词+识别词)×2），**非专业音素/发音评分**，UI 已显著标注。
- **降级链路**：
  1. 浏览器无 `SpeechRecognition/webkitSpeechRecognition` → 顶部黄条提示，自动降级为「标准朗读 + 保存录音 + 稍后重新启麦评分」；
  2. `file://` 本地打开 → 提示识别通常不可用，建议 Safari 添加到主屏幕后使用；
  3. 麦克风权限拒绝 → 红条提示，自动切到「听标准朗读对照」模式；
  4. 识别 `no-speech / network / audio-capture` 失败 → 明确中文提示 + 重录按钮。
- **录音回放**：若浏览器支持 `MediaRecorder + getUserMedia`，跟读时自动录音并提供「录音回放」按钮；否则自动隐藏，退化为「听标准朗读对照」。
- **历史记录**：完成整篇后点「保存本次成绩」，独立存入 `localStorage` key：

  ```
  eng30_shadowing_v1 = { "records": [ {ts, day, total, perSentence:[...]}, … ] }
  ```

  **绝不读写 `eng30_state_v1`**，不污染既有进度数据。展示「最近 / 最好 / 较上次变化」，仅保留最近 20 次。

## 5. 兼容性

- iOS：需 **Safari 17+**（WebKit 才实现 SpeechRecognition）；低版本自动降级。
- 安卓/桌面：Chrome / Edge 支持 `webkitSpeechRecognition`。
- `file://` 协议下识别多不可用，属浏览器安全策略，模块有提示。

---

## 6. 统一事件上报（宿主可选注入）

模块保持独立：**若宿主在 `window` 上注入了 `Eng30Events`**，模块会在关键时机回调，
未注入则静默跳过，不影响任何功能。

| 时机 | 回调 | payload |
|---|---|---|
| 每次跟读尝试完成（识别成功） | `Eng30Events.recordAttempt` | `{status:'success', day, sentenceIdx, ref, hyp, score, alignment:{correct,wrong,missing,extra,refWords,hypWords}, durationMs}` |
| 识别错误/无语音/权限拒绝/网络失败/启动失败 | 同上 | `status ∈ {'error','no-speech','denied','network','start-failure','empty'}`，带 `error` 字段，`score/alignment=null` |
| 整篇「重做整篇」按钮 | `Eng30Events.recordRedo` | `{day, sentenceIdx, cleared}` |

示例（宿主若需接入，自行加这段；不需要则忽略）：

```html
<script>
  window.Eng30Events = {
    recordAttempt: function (p) { console.log('[shadowing]', p); /* 上报到宿主统计 */ },
    recordRedo:    function (p) { console.log('[shadowing redo]', p); }
  };
</script>
```

## 7. 儿童端体验：渐进披露 + 完成/质量分离

- **渐进披露**：界面默认只显示「本次句子反馈（词色高亮）+ 下一步提示（开始跟读 / 下一句 / 保存成绩）」。
  历史统计（最近 / 最好 / 较上次）**默认折叠**，要点「历史成绩」按钮才展开，避免数字焦虑。
  模块自身的 localStorage 限量历史（20 次）仍保留作为兜底，宿主统计不可用时不丢数据。
- **完成状态与质量分离**：
  - 进度条 + 「已完成 X/Y 句」= **完成状态**（是否跟读完）；
  - 右侧 0-100 分 = **质量**（词级对齐分）；
  - 两者独立展示，不互相替代。

