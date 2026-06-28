const {
  createDeck, shuffle, drawCard, handValueAll,
  isBlackjack, isBust, getHiLoCount, canSplit
} = require('./cards');
const {
  NPC_PERSONALITIES, createNPC, decideBet, decideAction,
  decideSplit, MIN_BET
} = require('./npcs');
const {
  createGameContext, runRound, settleHand
} = require('./game');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.log(`  ✗ ${msg}`); }
}

async function main() {
  console.log('\n═══ 重构后 game.js 接口测试 ═══\n');

  console.log('【createGameContext】');
  {
    const ctx = createGameContext();
    assert(typeof ctx.initShoe === 'function', 'ctx.initShoe 存在');
    assert(typeof ctx.drawWithCount === 'function', 'ctx.drawWithCount 存在');
    assert(typeof ctx.needsReshuffle === 'function', 'ctx.needsReshuffle 存在');
    assert(Array.isArray(ctx.deck), 'ctx.deck 是数组');
    assert(ctx.deck.length === 6 * 52, `初始牌堆 6*52=${ctx.deck.length} 张`);
    assert(typeof ctx.runningCount === 'number' && ctx.runningCount === 0, 'runningCount 初始 0');
    assert(ctx.decksRemaining === 6, 'decksRemaining 初始 6');
  }

  console.log('\n【ctx.drawWithCount】');
  {
    const ctx = createGameContext();
    const before = ctx.deck.length;
    const c = ctx.drawWithCount();
    assert(c && c.rank && c.suit, '抽到一张有效牌');
    assert(ctx.deck.length === before - 1, '牌堆减少 1');
  }

  console.log('\n【settleHand 结算函数】');
  {
    const hand1 = { folded: false, hand: [{rank:'10',suit:'♠'},{rank:'K',suit:'♥'}], bet: 50 };
    const profit = settleHand(hand1, 18, false, false);
    assert(profit === 50, '玩家 20 vs 庄家 18 → 赢 50');
    assert(hand1.profit === 50, 'hand.profit 记录正确');

    const hand2 = { folded: false, hand: [{rank:'10',suit:'♠'},{rank:'7',suit:'♥'}], bet: 50 };
    const profit2 = settleHand(hand2, 18, false, false);
    assert(profit2 === -50, '玩家 17 vs 庄家 18 → 输 50');

    const hand3 = { folded: false, fromSplit: false, hand: [{rank:'A',suit:'♠'},{rank:'K',suit:'♥'}], bet: 100 };
    const profit3 = settleHand(hand3, 18, false, false);
    assert(profit3 === 150, '玩家 BJ vs 18 → 1.5倍 150');

    const hand4 = { folded: false, fromSplit: true, hand: [{rank:'A',suit:'♠'},{rank:'K',suit:'♥'}], bet: 100 };
    const profit4 = settleHand(hand4, 18, false, false);
    assert(profit4 === 100, '分牌后 A+K=21 不算 BJ，赢 1 倍 100');

    const hand5 = { folded: false, hand: [{rank:'10',suit:'♠'},{rank:'6',suit:'♥'},{rank:'7',suit:'♦'}], bet: 100 };
    const profit5 = settleHand(hand5, 18, false, false);
    assert(profit5 === -100, '玩家 bust → -100');

    const hand6 = { folded: false, hand: [{rank:'10',suit:'♠'},{rank:'7',suit:'♥'}], bet: 100 };
    const profit6 = settleHand(hand6, 25, false, true);
    assert(profit6 === 100, '庄家 bust → 赢 100');
  }

  console.log('\n【runRound 模拟 100 局（默认停牌）】');
  {
    const ctx = createGameContext();
    let errors = 0;
    let totalProfit = 0;
    let splitCount = 0;
    let playerChips = 1000;

    for (let i = 0; i < 100; i++) {
      try {
        const player = { chips: playerChips, bet: 10, folded: false, hasSplit: false, hands: [], lastProfit: 0 };
        playerChips -= 10;
        const npcs = [
          createNPC('T1', NPC_PERSONALITIES.AGGRESSIVE, 5000),
          createNPC('T2', NPC_PERSONALITIES.CONSERVATIVE, 5000),
          createNPC('T3', NPC_PERSONALITIES.CARD_COUNTER, 5000)
        ];
        for (const n of npcs) { n.bet = 50; n.chips -= 50; n.hands = []; n.hasSplit = false; }

        const callbacks = {
          onPhase() {}, onMessage() {}, onRequestRefresh() {}, setActiveHand() {},
          revealDealer() {}, bindDealer() {}, updatePlayerChips(c) { playerChips = c; },
          askPlayer() { return Promise.resolve('s'); },
          showHelp() {}, sleep() { return Promise.resolve(); }
        };

        const result = await runRound(ctx, { player, npcs, callbacks });
        assert(!result.quit, `局 ${i}: runRound 不返回 quit`);
        assert(typeof result.totalPlayerProfit === 'number', `局 ${i}: 返回 totalPlayerProfit`);
        assert(typeof result.dealerValue === 'number', `局 ${i}: 返回 dealerValue`);
        assert(Array.isArray(player.hands) && player.hands.length > 0, `局 ${i}: player.hands 已填充`);
        totalProfit += result.totalPlayerProfit;
        playerChips = player.chips;
        if (result.didSplit) splitCount++;
      } catch (e) {
        errors++;
        console.log(`   局 ${i} 异常:`, e.message, e.stack.split('\n')[1]);
      }
    }

    console.log(`   100局: 总利润${totalProfit >= 0 ? '+' : ''}${totalProfit} 剩余筹码$${playerChips} 分牌${splitCount}次`);
    assert(errors === 0, `100局无异常 (${errors})`);
    assert(playerChips > 0, `玩家筹码 $${playerChips} > 0`);
  }

  console.log('\n【runRound 模拟 100 局（自动分牌+要牌）】');
  {
    const ctx = createGameContext();
    let errors = 0;
    let playerChips = 1000;
    let splitHappened = 0;

    for (let i = 0; i < 100; i++) {
      try {
        const playerBet = 20;
        playerChips -= playerBet;
        const player = { chips: playerChips, bet: playerBet, folded: false, hasSplit: false, hands: [], lastProfit: 0 };
        const npcs = [
          createNPC('A', NPC_PERSONALITIES.AGGRESSIVE, 5000),
          createNPC('C', NPC_PERSONALITIES.CONSERVATIVE, 5000),
          createNPC('X', NPC_PERSONALITIES.CARD_COUNTER, 5000)
        ];
        for (const n of npcs) { n.bet = 50; n.chips -= 50; n.hands = []; n.hasSplit = false; }

        let currentHandIdx = 0;
        const callbacks = {
          onPhase() {}, onMessage() {}, onRequestRefresh() {},
          setActiveHand(idx) { currentHandIdx = idx; },
          revealDealer() {}, bindDealer() {},
          updatePlayerChips(c) { playerChips = c; player.chips = c; },
          async askPlayer() {
            const h = player.hands[currentHandIdx];
            if (!h) return 's';
            if (h.splitAces && h.hand.length > 2) return 's';
            if (canSplit(h.hand) && player.chips >= h.bet && !player.hasSplit) {
              splitHappened++;
              return 'p';
            }
            const v = handValueAll(h.hand);
            if (v < 17) return 'h';
            return 's';
          },
          showHelp() {}, sleep() { return Promise.resolve(); }
        };

        const result = await runRound(ctx, { player, npcs, callbacks });
        playerChips = player.chips;
      } catch (e) {
        errors++;
        console.log(`   局 ${i} 异常:`, e.message);
      }
    }

    console.log(`   100局: 分牌触发${splitHappened}次 最终筹码$${playerChips}`);
    assert(errors === 0, `100局自动分牌无异常 (${errors})`);
    assert(splitHappened > 0, `至少触发过 1 次玩家分牌 (${splitHappened})`);
  }

  console.log(`\n═══ 测试结果: ${passed} 通过, ${failed} 失败 ═══\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('测试运行异常:', err);
  process.exit(1);
});
