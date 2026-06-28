const { NPC_PERSONALITIES, createNPC, MIN_BET } = require('./npcs');
const { createGameContext, runRound, settleHand } = require('./game');
const { handValueAll, isBlackjack } = require('./cards');

async function main() {
  console.log('=== 端到端复现：玩家分A后其中一副补10凑21 ===\n');

  const ctx = createGameContext();

  const playerBet = 100;
  let playerChips = 1000;
  playerChips -= playerBet;

  const player = {
    name: '测试玩家',
    chips: playerChips,
    bet: playerBet,
    folded: false,
    hasSplit: false,
    hands: [],
    lastProfit: 0
  };

  const npcs = [
    createNPC('路人甲', NPC_PERSONALITIES.CONSERVATIVE, 5000)
  ];
  for (const n of npcs) { n.bet = MIN_BET; n.chips -= MIN_BET; n.hands = []; n.hasSplit = false; }

  let askCount = 0;
  const callbacks = {
    onPhase(p) { console.log(`  [阶段] ${p}`); },
    onMessage(m) { console.log(`  [消息] ${m.replace(/\x1B\[[0-9;]*m/g, '')}`); },
    onRequestRefresh() {},
    setActiveHand() {},
    revealDealer() {},
    bindDealer(d) { console.log(`  [庄家] 初始手牌: ${d.hand.map(c => c.rank + c.suit).join(' ')}`); },
    updatePlayerChips(c) { playerChips = c; player.chips = c; },
    async askPlayer() {
      askCount++;
      const h = player.hands[0];
      console.log(`  [交互 #${askCount}] 玩家当前手牌[0]: ${h ? h.hand.map(c => c.rank + c.suit).join(' ') : '无'}, canSplit: ${h && h.hand ? require('./cards').canSplit(h.hand) : false}`);
      if (askCount === 1 && h && require('./cards').canSplit(h.hand)) {
        console.log('    → 选择分牌 (p)');
        return 'p';
      }
      console.log('    → 选择停牌 (s)');
      return 's';
    },
    showHelp() {},
    sleep() { return Promise.resolve(); }
  };

  const result = await runRound(ctx, { player, npcs, callbacks });

  console.log('\n=== 结算结果 ===');
  console.log(`  玩家分牌: ${result.didSplit ? '是' : '否'}`);
  console.log(`  玩家手牌数: ${player.hands.length}`);
  player.hands.forEach((h, i) => {
    const cards = h.hand.map(c => c.rank + c.suit).join(' ');
    const v = handValueAll(h.hand);
    const bj = isBlackjack(h.hand);
    console.log(`  手牌${i + 1}: ${cards} = ${v}点 | BJ判定: ${bj} | fromSplit: ${h.fromSplit} | bet: $${h.bet} | profit: $${h.profit}`);
  });
  console.log(`  庄家点数: ${result.dealerValue}`);
  console.log(`  总利润: $${result.totalPlayerProfit}`);
  console.log(`  玩家剩余筹码: $${player.chips}`);
  console.log(`  总下注: $${result.totalBet}`);

  const expectedProfit = player.hands.reduce((sum, h) => {
    if (h.fromSplit && isBlackjack(h.hand)) {
      return sum + h.bet;
    }
    return sum + (h.profit || 0);
  }, 0);

  console.log(`\n  检查: 分牌后的21点是否按1:1赔付`);
  player.hands.forEach((h, i) => {
    if (h.fromSplit && isBlackjack(h.hand)) {
      const isCorrect = h.profit === h.bet;
      console.log(`    手牌${i + 1} (fromSplit且A+10): profit=$${h.profit}, 期望=$${h.bet} → ${isCorrect ? '✅ 正确' : '❌ 错误! 应该是1:1赔付'}`);
    }
  });
}

main().catch(err => {
  console.error('测试异常:', err);
  process.exit(1);
});
