# 终端 21 点游戏 · 架构说明

> 用大白话把这套代码从里到外讲明白。Node.js + chalk 纯终端实现，无任何外部框架。

---

## 一、模块依赖图（谁 import 谁）

```
                          ┌─────────────┐
                          │  cards.js   │  纯函数工具箱（无副作用）
                          │  牌/点数/算牌  │
                          └──────┬──────┘
                                 │
           ┌─────────────────────┼─────────────────────┐
           │                     │                     │
    ┌──────▼──────┐       ┌──────▼──────┐       ┌──────▼──────┐
    │  npcs.js    │       │   ui.js     │       │ storage.js  │
    │  NPC 决策层  │       │  chalk 渲染  │       │ JSON 持久化  │
    └──────┬──────┘       └─────────────┘       └──────┬──────┘
           │                                            │
           └──────────────────┬─────────────────────────┘
                              │
                       ┌──────▼──────┐
                       │  game.js    │  回合流程核心（状态机）
                       │ 发牌/决策/结算 │
                       └──────┬──────┘
                              │
                       ┌──────▼──────┐
                       │  index.js   │  程序入口（IO/主循环）
                       │ 键盘/借贷/存档 │
                       └─────────────┘
```

**记忆口诀**：`cards` 是地基（纯数据，谁都能用）→ `npcs`/`ui`/`storage` 是三个独立职能部门 → `game` 把它们串起来跑一回合 → `index` 管开门关门和收电费。

---

## 二、从敲回车到一回合打完：数据流转全流程

```
玩家敲回车
  │
  ▼
index.js: gameLoop() ──▶ newRound() 重置玩家/NPC/庄家状态
  │                       从 save_data.json 读筹码
  │
  ▼
index.js: phaseBetting() ──▶ 玩家输入下注额
  │                            └─ NPC 调 npcs.decideBet() 各自下注
  │                                 └─ 内部用 cards.getHiLoCount() 算真数
  │
  ▼
game.js:  runRound(ctx, {player, npcs, callbacks})
  │
  ├─ 1. dealInitialHands()
  │     两轮发牌，玩家/NPC/庄家各抽两张
  │     每抽一张 ctx.drawWithCount() 自动累计 Hi-Lo 计数
  │     庄家第一张牌标记 faceUp=false（暗牌）
  │
  ├─ 2. runPlayerTurn()
  │     遍历玩家每副手牌（分牌后可能多副）
  │     调 callbacks.askPlayer() 等键盘输入（h/s/p/d）
  │     选 p(split) → handleSplit() 拆牌、补牌、筹码翻倍
  │
  ├─ 3. runNPCTurn()
  │     每个 NPC 每副手牌调 npcs.decideAction()
  │     根据性格+手牌+庄家明牌+真数返回 hit/stand/split/double
  │
  ├─ 4. runDealerTurn()
  │     翻开暗牌，补到 ≥17 点停止
  │
  └─ 5. settleAll()
        每副手牌调 settleHand() 算盈亏
        └─ cards.isBlackjack() + game.isHandBlackjack() 判 BJ
        玩家筹码累加，写回 gameState
  │
  ▼
index.js: phaseSettlement()
  │
  ├─ 统计胜/负/平，写历史记录（最多 10 条）
  ├─ 有高利贷就自动扣款，还不上 → Game Over
  └─ storage.saveSave() 把 JSON 落盘
  │
  ▼
等玩家敲回车，进入下一局……
```

---

## 三、cards.js：纯函数工具箱（最底层，无副作用）

这个文件**不 import 任何其他模块**，也不读写任何外部状态。所有函数都是「给输入→给输出」的纯函数，方便测试和复用。

### 核心函数一览

| 函数 | 输入 | 输出 | 谁在调用 |
|---|---|---|---|
| `createDeck(6)` | 几副牌 | 312 张标准牌堆数组 | `game.js: createGameContext()` |
| `shuffle(deck)` | 牌堆 | Fisher-Yates 洗牌后的新数组 | `game.js: initShoe()` |
| `drawCard(deck)` | 牌堆引用 | 抽走并返回顶张（原地 shift） | `game.js: drawWithCount()` |
| `cardValue(card)` | 单张牌 | 点数（A=11, JQK=10, 其他=数字） | `handValue/All`, `canSplit` |
| `handValue(hand)` | 手牌（考虑 faceUp） | 最佳点数（A 自动变 1） | `ui.js: renderHand()` 显示用 |
| `handValueAll(hand)` | 手牌（忽略 faceUp） | 最佳点数（A 自动变 1） | 所有决策/结算逻辑 |
| `isBlackjack(hand)` | 手牌 | 是否恰好 2 张=21 点（**不区分是否分牌**） | `game.js`, `ui.js`, `npcs.js` |
| `isBust(hand)` | 手牌 | 是否爆牌（>21） | 各处 |
| `canSplit(hand)` | 手牌 | 是否恰 2 张且点数相等（A=11, 10=K=Q=J） | `game.js`, `npcs.js`, `ui.js` |
| `isSplitAces(hand)` | 手牌 | 是否恰好两张 A | `npcs.js: decideAction()` |
| `getHiLoCount(card)` | 单张牌 | Hi-Lo 点数（2-6=+1, 7-9=0, 10-A=-1） | `game.js: drawWithCount()` |

### 设计亮点

- **`handValue` vs `handValueAll`**：前者跳过 `faceUp=false` 的暗牌，用于 UI 显示；后者忽略明牌暗牌，用于内部决策。
- **`isBlackjack` 不管分牌来源**：它只看牌本身是不是「两张牌凑 21」。分牌后的 A+10 在 `isBlackjack` 里也是 true，但**上层调用者（game.js 的 `isHandBlackjack`）会额外加 `!fromSplit` 过滤**，确保分牌出来的 21 点不算 BJ。

---

## 四、storage.js：JSON 本地存档机制

### 文件位置

```
项目根目录 / save_data.json
```

### 数据结构

```json
{
  "chips": 850,
  "loanTaken": false,
  "loanAmount": 0,
  "history": [
    { "timestamp": "2026-06-28T10:00:00.000Z", "profit": 100, "playerValue": "20", "dealerValue": 18, "bet": 100, "result": "win", "split": false }
  ],
  "totalGames": 42,
  "totalWins": 23
}
```

### 读写流程

```
启动时 loadSave()
  │
  ├─ fs.existsSync 判断 save_data.json 存不存在
  ├─ 不存在 → 返回 DEFAULT_SAVE（筹码 1000，无贷款）
  ├─ 存在   → fs.readFileSync 读原始字符串 → JSON.parse
  └─ 每个字段做 typeof 校验，坏数据就用默认值兜底（防篡改）
  │
  ▼
内存里的 saveData 对象（index.js 的 gameState.saveData）
  │
  ▼
每局结束 phaseSettlement()
  │
  ├─ addHistory() 把新战绩 unshift 进去，.slice(-10) 只留最近 10 条
  ├─ 有高利贷就 repayLoan() 扣筹码
  └─ saveSave() → JSON.stringify(null, 2) 美化格式 → fs.writeFileSync 落盘
```

### 高利贷规则（硬编码在 storage.js）

| 常量 | 值 | 说明 |
|---|---|---|
| `LOAN_AMOUNT` | 500 | 借到手里的钱 |
| `LOAN_REPAY_MULTIPLIER` | 2 | 还款倍率，借 500 还 1000 |
| `canAffordLoan` | `!loanTaken` | 一生只能借一次 |

还不上直接 `triggerGameOver()` 游戏结束。

---

## 五、npcs.js：三个性格的 AI 决策

### 三种人格

```
AGGRESSIVE  激进 🔥  爱加注，见对就分，软 16 也敢要牌
CONSERVATIVE 保守 🛡️  只下小注，只分 A 和 8，能停就停
CARD_COUNTER 记牌 🧠  Hi-Lo 真数驱动，精确基本策略 + 算牌偏离
```

### 下注决策：`decideBet(npc, dealerUp, runningCount, decksRemaining)`

| 人格 | 策略 |
|---|---|
| 激进 | 基础 3×MIN_BET + 随机浮动，最高 MAX_BET |
| 保守 | 基本下 MIN_BET，偶尔 2×，15% 概率直接弃牌（不下注） |
| 记牌 | 真数 TC ≥ 2 就加注（TC+1 倍 MIN_BET），TC ≤ -2 有 40% 弃牌 |

真数公式：`TC = runningCount / decksRemaining`（牌堆越薄，真数波动越大）

### 行动决策：`decideAction(npc, dealerUp, runningCount, decksRemaining)`

执行顺序：**先看能不能分牌 → 再按人格分支**

#### 第一步：分牌判断（三个人格各自的 `decideSplit`）

| 对子 | 激进🔥 | 保守🛡️ | 记牌🧠 |
|---|---|---|---|
| A/A | ✅ 必分 | ✅ 必分 | ✅ 必分 |
| 8/8 | ✅ 必分 | ✅ 必分 | ✅ 必分 |
| 9/9 | 70% 概率分 | ❌ | 庄家≠7 且 ≤9 时分 |
| 7/7, 6/6 | 70% | ❌ | TC≥0 且庄家 2-7 时分 |
| 3/3, 2/2 | 70% | ❌ | TC≥1 且庄家 2-7 时分 |
| 4/4 | 20% | ❌ | TC≥2 且庄家 5-6 时分 |
| 10/10, J/Q/K | 40% | ❌ | ❌ 永不分 |
| 5/5 | 20% | ❌ | ❌ 永不分 |

#### 第二步：要牌/停牌/加倍

**激进🔥**：≤11 必要，12 对庄家 2-3 要，13-16 对庄家 ≥7 要，35% 概率乱要。9-11 点筹码够就加倍。

**保守🛡️**：≤8 要，9 对 3-6 要，10-11 对 ≤9 要，12 对 4-6 才停，13-16 对 2-6 停，≥17 停。20% 概率保守停牌。

**记牌🧠**：实现了完整的**基本策略 + 算牌偏离**：
- 软点（含 A 且未爆）和硬点分开处理
- 软 18 对 3-6 加倍、对 2/7/8 停、其余要
- 硬 11 必加倍，硬 10 对 ≤9 加倍，硬 9 对 3-6 加倍
- 算牌偏离：硬 16 对 9 且 TC≥1 停、硬 15 对 10 且 TC≥2 停、硬 12 对 2-3 且 TC≥2 停……这些都是职业 21 点的真实算牌打法。

---

## 六、game.js：回合状态机（重构后的核心）

这是第三轮重构拆出来的新模块，专门负责**单回合的完整生命周期**，index.js 只管 IO 不插手流程。

### 对外接口

```js
// 1. 创建游戏上下文（牌堆 + 算牌器）
const ctx = createGameContext();
ctx.initShoe();        // 洗牌重置
ctx.needsReshuffle();  // 牌堆 ≤52 张时返回 true
ctx.drawWithCount();   // 抽一张 + 自动累计 Hi-Lo + 不够自动重洗

// 2. 跑一整回合（唯一入口）
const result = await runRound(ctx, {
  player,          // 玩家对象（含 chips, bet, hands[]）
  npcs,            // NPC 数组
  callbacks        // IO 回调桥（下面详说）
});
// 返回: { quit, totalPlayerProfit, totalBet, dealerValue, playerValue, didSplit }
```

### Callbacks 桥：解耦 IO 的关键

`game.js` 本身不读键盘、不画屏幕、不 `console.log`。所有和外部世界打交道都通过 `callbacks` 对象传进来：

| 回调 | index.js 里做什么 |
|---|---|
| `onPhase(phase)` | 更新 gameState.phase（下注/发牌/玩家/…） |
| `onMessage(msg)` | 更新状态栏消息 |
| `onRequestRefresh()` | 重绘整个屏幕 |
| `setActiveHand(idx)` | 高亮当前正在操作的分牌手牌 |
| `revealDealer()` | 标记庄家暗牌已翻开 |
| `bindDealer(d)` | 把 dealer 对象挂到 gameState 供渲染 |
| `updatePlayerChips(c)` | 同步筹码到 saveData |
| `askPlayer(q)` | 读键盘输入（h/s/p/d/help/q） |
| `showHelp()` | 弹帮助菜单 |
| `sleep(ms)` | 延迟（发牌动画节奏） |

这种设计让 `game.js` 可以在**无终端环境下做自动化测试**——只要把 `askPlayer` 换成返回固定值的 mock 函数，就能跑成千上万局模拟验证逻辑。

### 内部状态机流转

```
runRound()
  │
  ▼
dealing ────── dealInitialHands() 两轮发牌，庄家第一张暗牌
  │                每抽一张自动更新 runningCount / decksRemaining
  │
  ▼
player_turn ── runPlayerTurn()
  │              遍历 hands[]（分牌后可能 2 副）
  │              对每副调用 runPlayerHand()
  │                ├─ 分 A 且手牌>2 张 → 强制结束（规则硬限制）
  │                ├─ 循环：askPlayer → h要牌 / s停牌 / d加倍 / p分牌
  │                └─ 选 p → handleSplit() 内部处理
  │
  ▼
npc_turn ───── runNPCTurn()
  │              每个 NPC 每副手牌 → runNPCHand()
  │                └─ decideAction() → hit/stand/split/double
  │
  ▼
dealer_turn ── runDealerTurn()
  │              翻暗牌 → 补到 ≥17 点
  │              所有人都爆/BJ 就跳过补牌
  │
  ▼
settlement ─── settleAll()
                 每副手牌 settleHand()：
                   爆牌 → -bet
                   BJ vs 非BJ → 1.5×bet（分牌出来的不算 BJ）
                   庄家爆 → +bet
                   点数比大小 → ±bet / 0
                 筹码累加到 player.chips / npc.chips
```

### handleSplit：分牌逻辑独立封装

这是重构重点抽出来的函数，玩家和 NPC 共用同一份逻辑：

```
输入: ctx, seat, hand, handIdx, personalityLabel, cb
  │
  ├─ seat.chips -= hand.bet     // 再扣一份下注
  ├─ seat.hasSplit = true       // 标记已分过（防止二次分牌）
  ├─ hand.pop() 拆出第二张牌
  ├─ 两手各补一张新牌
  ├─ 是 A 对 → 两手都标记 done=true（分 A 只补一张不能继续要）
  └─ 返回 { didSplit, isAces }
```

**分牌规则硬编码**：分 A 只补一张且不可再 hit，分其他对子可以正常要牌，整局只能分一次。

---

## 七、新手阅读路线建议（第一次接触代码按这个顺序翻）

### 🟢 第 1 站：cards.js（20 分钟）
最纯粹的一层，全是纯函数，没有任何外部依赖。从 `createDeck` 看到 `getHiLoCount`，搞懂：
- 一张牌长什么样（`{rank, suit, faceUp}`）
- 点数怎么算，A 怎么从 11 变 1
- Hi-Lo 算牌系统怎么工作

### 🟢 第 2 站：ui.js（30 分钟）
纯渲染层，最直观。看 `renderCardLine` 和 `renderPlayerSeat` 就能明白 ASCII 扑克牌是怎么拼出来的。chalk 的彩色 API 也集中在这里。

### 🟡 第 3 站：storage.js（15 分钟）
最简单的模块，`loadSave` / `saveSave` / `addHistory` 三个函数看懂就够。高利贷规则也在这。

### 🟡 第 4 站：npcs.js（40 分钟）
先看 `NPC_PERSONALITIES` 三种人格枚举，再看 `decideBet`，最后啃 `decideAction`（最厚的一块，但里面每个 case 都是大白话的 21 点基本策略）。

### 🔴 第 5 站：game.js（60 分钟）
重构的核心。按顺序读：
1. `createGameContext` — 牌堆和算牌器
2. `isHandBlackjack` — BJ 判断辅助函数
3. `handleSplit` — 分牌逻辑
4. `runRound` — 顺着 phase 顺序把 5 个子函数串起来看
5. `settleHand` / `settleAll` — 结算公式

### 🔴 第 6 站：index.js（30 分钟）
最后看入口。`gameState` 对象是全局状态中心，`makeCallbacks()` 把状态更新桥接给 game.js，`gameLoop()` 是最外层的大循环。

> **总耗时估计**：认真读一遍大概 3 小时左右，读完就能在任何位置加功能（比如保险、投降、多副牌分牌）不迷路。

---

## 八、后续加新功能的推荐切入点

| 想加的功能 | 改哪个文件 | 改哪里 |
|---|---|---|
| 保险（Insurance） | `game.js` + `ui.js` | `runPlayerHand` 里加新分支，庄家明牌 A 时询问 |
| 投降（Surrender） | `game.js` + `npcs.js` | `runPlayerHand` 加 `r` 指令，`decideAction` 加判断 |
| 二次分牌（Re-split） | `game.js: handleSplit` | 去掉 `hasSplit` 只能一次的限制 |
| 新 NPC 人格 | `npcs.js` | `NPC_PERSONALITIES` 加枚举，`decideBet`/`decideAction` 加 case |
| Web 版界面 | 不动核心，新建 `web-ui.js` | 把 ui.js 的 chalk 输出换成 DOM 渲染，game.js 完全复用 |

核心逻辑（cards/npcs/game）和 IO（index/ui/storage）分层清晰，改底层不影响上层，加新功能不会让某个文件继续膨胀。
