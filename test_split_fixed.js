const { handValueAll, isBlackjack, canSplit } = require('./cards');
const { createGameContext, runRound, settleHand } = require('./game');
const { NPC_PERSONALITIES, createNPC, MIN_BET } = require('./npcs');

async function main() {
  console.log('=== 固定牌堆精确复现：起手两张A → 分牌 → 一副补10凑21 ===\n');

  const ctx = createGameContext();

  ctx.deck = [
    { rank: 'A', suit: '♠', faceUp: true },
    { rank: '10', suit: '♦', faceUp: true },
    { rank: 'K', suit: '♣', faceUp: true },
    { rank: 'A', suit: '♥', faceUp: true },
    { rank: '10', suit: '♠', faceUp: true },
    { rank: '5', suit: '♠', faceUp: true },
    { rank: 'Q', suit: '♥', faceUp: true },
    { rank: '7', suit: '♦', faceUp: true },
  ];

  console.log('牌堆顺序 (按抽牌顺序):');
  ctx.deck.forEach((c, i) => console.log(`  [${i}] ${c.rank}${c.suit}`));

  const playerBet = 100;
  const player = {
    name: '测试玩家', chips: 900, bet: playerBet,
    folded: false, hasSplit: false, hands: [], lastProfit: 0
  };

  const npcs = [
    createNPC('NPC', NPC_PERSONALITIES.CONSERVATIVE, 5000)
  ];
  for (const n of npcs) { n.bet = MIN_BET; n.chips -= MIN_BET; n.hands = []; n.hasSplit = false; }

  let askCount = 0;
  const callbacks = {
    onPhase(p) { console.log(`\n  [阶段] ${p}`); },
    onMessage(m) { console.log(`  ${m.replace(/\x1B\[[0-9;]*m/g, '')}`); },
    onRequestRefresh() {},
    setActiveHand() {},
    revealDealer() {},
    bindDealer(d) {},
    updatePlayerChips(c) { player.chips = c; },
    async askPlayer() {
      askCount++;
      const activeH = player.hands[player.hands.length > 1 ? askCount - 1 : 0] || player.hands[0];
      if (activeH && canSplit(activeH.hand) && player.chips >= activeH.bet && !player.hasSplit) {
        console.log(`  [交互#${askCount}] 可分牌 → 返回 p`);
        return 'p';
      }
      console.log(`  [交互#${askCount}] 停牌 → 返回 s`);
      return 's';
    },
    showHelp() {},
    sleep() { return Promise.resolve(); }
  };

  const result = await runRound(ctx, { player, npcs, callbacks });

  console.log('\n========== 详细结算检查 ==========');
  console.log(`玩家分牌标记: didSplit=${result.didSplit}, hasSplit=${player.hasSplit}`);
  console.log(`玩家手牌数量: ${player.hands.length}`);

  player.hands.forEach((h, i) => {
    const cards = h.hand.map(c => c.rank + c.suit).join(' ');
    const v = handValueAll(h.hand);
    const bj = isBlackjack(h.hand);
    console.log(`\n  [手牌${i + 1}] ${cards} = ${v}点`);
    console.log(`    fromSplit: ${h.fromSplit}, isSplitHand: ${h.isSplitHand}`);
    console.log(`    isBlackjack(仅看牌面): ${bj}`);
    console.log(`    下注: $${h.bet}`);
    console.log(`    profit(已结算): $${h.profit}`);

    if (h.fromSplit && bj) {
      const correct = h.profit === h.bet;
      const extra = h.profit - h.bet;
      console.log(`    ⚠ 分牌后A+10 → profit=$${h.profit}, 期望=$${h.bet} → ${correct ? '✅ 正确(1:1赔付)' : `❌ BUG! 多赔了 $${extra}（应该1:1，不是1.5倍）`}`);
    }
    if (!h.fromSplit && bj) {
      const correct = h.profit === Math.floor(h.bet * 1.5);
      console.log(`    ⚠ 自然BJ → profit=$${h.profit}, 期望=$${Math.floor(h.bet * 1.5)} → ${correct ? '✅ 正确(1.5倍赔付)' : '❌ 错误'}`);
    }
  });

  console.log(`\n  总利润: $${result.totalPlayerProfit}`);
  console.log(`  玩家最终筹码: $${player.chips}`);
}

main().catch(err => {
  console.error('异常:', err);
  process.exit(1);
});
