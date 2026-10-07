# 家长看板 + 事件记录 — 集成说明

本模块完全独立，**不修改** `index.html` / `app.js` / `styles.css` / `data.js` / `assessments.js` / `shadowing.js` / `typing-dictation.js`。

新增文件：

| 文件 | 作用 |
|---|---|
| `parent-dashboard.js` | 事件记录核心 + 家长看板 UI（纯原生 JS，零依赖） |
| `parent-dashboard.css` | 看板样式（全部 scoped 到 `.pd-*`） |

---

## 1. 挂载（3 处最小改动）

### ① `<head>` 内追加 CSS（在 `styles.css` 之后）

```html
<link rel="stylesheet" href="styles.css">
<link rel="stylesheet" href="parent-dashboard.css">  <!-- 新增 -->
```

### ② `</body>` 前追加 JS（在 `app.js` 之后）

```html
<script src="data.js"></script>
<script src="assessments.js"></script>
<script src="app.js"></script>
<script src="parent-dashboard.js"></script>  <!-- 新增 -->
```

### ③ 加一个"家长看板"入口按钮（任意位置）

```html
<button id="open-parent">家长看板</button>
<div id="parent-root"></div>

<script>
  document.getElementById('open-parent').addEventListener('click', function () {
    ParentDashboard.init('#parent-root', {
      onClose: function () {
        document.getElementById('parent-root').innerHTML = '';
      }
    });
  });
</script>
```

`init(container, options)` 会把整段 UI（密码门 / Day1-30 表格 / 错题明细 / 成绩对比 / 重置）动态渲染进 `container`。关闭时调用 `options.onClose()`。

---

## 2. 事件 API（`window.Eng30Events`）

现有练习模块在**批改完成**时调用 `recordAttempt`，在**进入重做轮次**时调用 `recordRedo`。

### `recordAttempt(event)`

增量记录一次作答。字段：

```js
Eng30Events.recordAttempt({
  day: 1,                 // 1-30，必填
  module: 'dictation',    // 模块 id，必填。建议用：reading / copying / dictation / vocabulary / shadowing / typing
  ts: Date.now(),         // 可选，默认当前时间
  correct: 5,              // 本次正确题数（若给 items 则自动从 items 推导）
  wrong: 3,                // 本次错误题数
  items: [                 // 可选，逐题明细
    { id: 'q1', correct: true  },
    { id: 'q2', correct: false, text: 'banana' }
  ],
  timeMs: 12000,           // 本次用时（毫秒）
  score: 80,               // 本次得分（0-100 或任意标尺）
  total: 8,                // 本次总分分母（可选）
  wrongWords: ['banana'],   // 错词列表
  wrongSentences: ['I go to school yesterday.']  // 错句列表
});
```

**聚合规则**：同一题错 2 次再对 1 次 → 该 (day, module) 累计 **2 错 / 1 对 / 3 次尝试**。
只要把每题结果按次传进来，聚合自动正确，不需要调用方去重。

### `recordRedo(event)`

```js
Eng30Events.recordRedo({ day: 1, module: 'dictation' });
```

**只增 `redoCount`，不碰 correct/wrong/attempts/timeMs/score**。每 (day, module) 独立计数。

### 其他只读 API

```js
Eng30Events.getDayStats(day, range)
  // range 省略或 'all' → 该天所有模块
  // range = 'dictation' → 仅该模块
  // 返回 { [module]: { attempts, correct, wrong, redoCount, accuracy, timeMs,
  //                    scoreLast, scoreBest, scoreAvg, wrongWords, wrongSentences,
  //                    firstTs, lastTs, hasData } }
  // accuracy/score* 在无数据时为 null

Eng30Events.getDetail(day, module)
  // 返回该 (day, module) 最近 50 条逐次记录（时间正序）

Eng30Events.getAllStats(range)
  // range: 'all' | '7d' | '30d'
  // 返回 { [day]: { [module]: aggView } }

Eng30Events.clearAllRecords()
  // 清空 eng30_events_v1（家长看板 UI 里有二次确认按钮）
```

---

## 3. 存储与隐私边界

| localStorage key | 本模块是否读写 | 说明 |
|---|---|---|
| `eng30_events_v1` | **读写** | 事件流 + 聚合 + 明细，本模块唯一可写的业务键 |
| `eng30_parent_unlocked` | **读写** | 家长看板独立解锁键 |
| `eng30_state_v1` | **绝不碰** | 既有学习进度勾选，保持原样 |
| `eng30_final_unlocked` | **绝不碰** | 期末测评密码锁，与本模块解锁完全独立 |
| `eng30_assess_entrance` | **只读** | 入学成绩展示 |
| `eng30_assess_final` | **只读** | 期末成绩展示 |

- 家长看板密码与期末测评使用**同一口令** `deltaforce`，但**解锁键完全独立**（`eng30_parent_unlocked` vs `eng30_final_unlocked`），互不影响。
- UI 已显著标注"仅本机本地存储，密码门槛仅作遮挡，非真实安全"。
- 旧版本无 `eng30_events_v1` 时安全空态，看板显示"未练习"，不报错、不清旧数据。

---

## 4. 容量与降级

- 全局事件流上限 **1000 条**（FIFO 淘汰）。
- 每 (day, module) 明细上限 **50 条**（FIFO 淘汰）。
- 聚合统计（attempts/correct/wrong/redoCount/timeMs/score*/wrongWords/wrongSentences）**单独维护**，淘汰原始事件不丢累计。
- `localStorage` 写失败（隐私模式/配额满）静默降级，不影响练习主流程。

---

## 5. 验收口径

- 同题错 2 次再对 1 次 → `getDayStats(day).dictation` = `{ attempts:3, correct:1, wrong:2, accuracy:33.3 }`。
- 不同模块 `recordRedo` 互不影响；`recordAttempt` 不增 `redoCount`。
- 看板零数据格子显示"未练习"，**不显示 0%**。
- 点某天 → 展开各模块表；点某模块行 → 展开错词/错句 + 每次作答时间。
- 顶部展示入学 / 期末已有成绩（未参加则"未开始"）。
- "重置全部记录"需两次 `confirm`；只清 `eng30_events_v1`。
