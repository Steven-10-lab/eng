# 输入式填空默写模块 — 集成说明

新增两个文件：

| 文件 | 说明 |
|---|---|
| `typing-dictation.js` | 模块主体。纯逻辑函数可在 Node 直接测试；浏览器端自动注入 UI。 |
| `typing-dictation.css` | 模块样式，全部 `.td-` 作用域，不污染既有样式。 |

**不修改** `index.html` / `app.js` / `styles.css` / `data.js`；既有“手写逐句播放”模式完整保留。

---

## 一、最小集成步骤（共 3 处改动）

### 1. `index.html` `<head>` 内引入样式

在已有 `<link rel="stylesheet" href="styles.css">` 附近加一行：

```html
<link rel="stylesheet" href="typing-dictation.css">
```

### 2. `index.html` `</body>` 前引入脚本

在已有 `<script src="app.js"></script>` **之后**加一行：

```html
<script src="typing-dictation.js"></script>
```

### 3. 最小 HTML 挂载点（每日默写区）

模块默认会自动挂到既有 `#panel-dictation`（环节 3「默写」面板）内部，无需手写任何结构即可工作。
若想显式指定挂载点，在 `#panel-dictation` 内、`<div class="complete-bar">` **之前**放一个空 div：

```html
<div id="panel-dictation">
  <!-- 既有听写控件保持原样，不要删 -->
  <div class="dictation-controls"> ... </div>
  <div class="dictation-hint" id="dictation-hint"></div>
  <div class="dictation-write-area"> ... </div>
  <div class="dictation-reveal"> ... </div>

  <!-- ★ 新增：输入式填空默写挂载点（仅此一行） -->
  <div id="typing-dictation-mount"></div>

  <div class="complete-bar"> ... </div>
</div>
```

### 4. 初始化调用

脚本加载后**自动**在 `DOMContentLoaded` 时完成注入，无需手动调用。
如需手动初始化（例如动态注入场景）：

```html
<script>
  TypingDictation.init();   // 幂等：重复调用不会重复注入
</script>
```

---

## 二、运行行为

- 进入「Day N → 默写」环节，面板顶部出现模式切换：
  - **手写 · 逐句播放**（默认）：与原来完全一致，逐句播放、显示提示、原文对照。
  - **iPad 输入默写**：切换后隐藏手写区，展示本模块 UI。模式选择会记忆。
- 题目自动由当天数据生成：
  - 优先 `dictationHints` 人工挖空句（答案反查自当天 `text`，反查不到的安全跳过）；
  - 再从 `words[]` 重点词在原文中出现处挖空；
  - 每题保留整句上下文，最多 12 空。
- 每题一个 iPad 可输入框（已关自动大写/纠错/拼写检查），每句可单独「批改本句」，也可「全部提交」。
- 提交前不显示任何答案；批改后逐空标 ✓/✗、正确答案、简短词性词义说明。
- 容错：大小写、首尾/中间多余空格、弯撇号 ’‘→直撇号、常见缩写撇号、多打的标点引号；**拼写错误一律判错**。
- 批改后展示：本次得分 / 正确率 / 错词清单，并提供「只重做错题」「重做整篇（清空旧输入）」。
- **儿童端渐进披露**：默认只突出本次反馈（得分/错词）；历次历史折叠为一行“最近成绩”，点击「展开历次」才显示最好/较上次与明细。

## 三、统一事件上报（可选接入）

模块不依赖上报通道，但宿主若在全局提供 `window.Eng30Events`，模块会自动调用：

```js
// 每个空每次“批改本句 / 全部提交”都会增量调用一条；同题连续多次错误也逐条真实记录
window.Eng30Events.recordAttempt({
  day: 1,                       // 第几天
  module: 'typing_dictation',   // 固定
  itemId: 0,                    // 该空在当天题序中的 id
  correct: false,               // 本空是否答对
  score: 1,                     // 当前重做范围内已答对累计数
  total: 5,                     // 当前重做范围总空数
  answer: 'sumer',              // 用户原始输入
  expected: 'summer',            // 正确答案
  errorWords: ['summer'],       // 当前累计错词
  durationMs: 1234,             // 从该空展示到提交的耗时
  timestamp: 1728000000000
});

// 点击“重做整篇 / 只重做错题”时调用
window.Eng30Events.recordRedo({
  day: 1,
  module: 'typing_dictation',
  type: 'all' | 'wrong-only',
  timestamp: 1728000000000
});
```

宿主未提供时静默跳过，不影响使用。

## 四、数据存储（与旧数据隔离）

| 项 | 值 |
|---|---|
| 历史记录 key | `eng30_typingdict_v1`（全新独立 key，事件上报缺失时的本地兜底） |
| 结构 | `{ "dayN": { done:bool, attempts:[{ts,score,total,accuracy,wrongWords,mode}] } }` |
| 每条保留 | 时间、得分、正确率、错词、是否错题重做 |
| 上限 | 每天最多 20 条，超出丢弃最早；**重做只追加、不覆盖旧记录** |
| 展示 | 最近一次（常驻一行）/ 最好 / 较上次（折叠展开） |
| 完成状态与质量分离 | `done` 只表示“已提交过至少一次”，与正确率解耦：0 分提交也置 done，重做不撤销 done；本模块**全程不读不写** `eng30_state_v1`，旧进度与勾选完全不受影响 |

## 五、Node 纯函数测试

```bash
node --check typing-dictation.js        # 语法检查
node -e "const TD=require('./typing-dictation.js'); console.log(Object.keys(TD))"
```

可测纯函数：`normalizeAnswer`、`gradeBlank`、`recoverAnswer`、`buildQuestions(dayData)`、
`scoreSession(questions, answers)`、`buildAttemptPayload(opts)`、`buildRedoPayload(opts)`、
`appendHistory(store, day, attempt)`、`summarizeHistory(attempts)`、`sentenceList`、`tokenizeNorm`。

## 六、验收自检结果

- `node --check` 通过；Node 纯函数测试 **44/44 通过**：全对、大小写/标点/撇号容错、拼写错判错、未答、错题重做、历史追加/上限20/最近·最好·较上次、上报载荷字段齐全、同题连续错误逐条记录、完成状态与质量分离。
- 30 天全量扫描：所有题目答案均来自当天原文，无答案泄漏；人工提示句反查 87/90（剩余 3 条为与原文改写对不上的句子，安全跳过，由重点词挖空补位）。
