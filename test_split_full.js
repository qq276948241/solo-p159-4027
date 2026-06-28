const { handValueAll, isBlackjack, canSplit } = require('./cards');
const { createGameContext, handleSplit, settleHand } = require('./game');
const { NPC_PERSONALITIES, createNPC, MIN_BET } = require('./npcs');

async function main() {
  console.log('=== 完整复现：从分牌到结算全流程检查 ===\n');

  const ctx = createGameContext();

  const player = {
    name: '测试玩家',
    chips: 1000,
    bet: 100,
    folded: false,
    hasSplit: false,
    hands: [{
      hand: [
        { rank: 'A', suit: '♠', faceUp: true },
        { rank: 'A', suit: '♥', faceUp: true }
      ],
      bet: 100,
      folded: false,
      doubledDown: false,
      isBust: false,
      hasBlackjack: false,
      fromSplit: false,
      isSplitHand: false,
      splitAces: false,
      done: false
    }],
    lastProfit: 0
  };
  player.chips -= 100;

  console.log('【初始状态】');
  console.log(`  玩家筹码: $${player.chips}`);
  console.log(`  手牌: ${player.hands[0].hand.map(c => c.rank + c.suit).join(' ')}`);
  console.log(`  canSplit: ${canSplit(player.hands[0].hand)} (A=11, A=11, 点数相同 ✓)`);
  console.log();

  const fakeCb = {
    onMessage(m) { console.log(`  ${m.replace(/\x1B\[[0-9;]*m/g, '')}`); },
    onRequestRefresh() {},
    updatePlayerChips(c) { player.chips = c; },
    sleep() { return Promise.resolve(); }
  };

  console.log('【调用 handleSplit】');
  await handleSplit(ctx, player, player.hands[0], 0, null, fakeCb);
  console.log();

  console.log('【分牌后状态】');
  console.log(`  玩家筹码: $${player.chips} (初始900 - 额外下注100 = 800)`);
  console.log(`  player.hasSplit: ${player.hasSplit}`);
  console.log(`  手牌数量: ${player.hands.length}`);
  player.hands.forEach((h, i) => {
    const cards = h.hand.map(c => c.rank + c.suit).join(' ');
    console.log(`  手牌${i + 1}: ${cards} (${handValueAll(h.hand)}点) | bet=$${h.bet} | fromSplit=${h.fromSplit} | hasBlackjack=${h.hasBlackjack} | done=${h.done}`);
  });
  console.log();

  console.log('【现在手动把第一副手牌改成 A+10 (模拟补到10凑21)】');
  player.hands[0].hand = [
    { rank: 'A', suit: '♠', faceUp: true },
    { rank: '10', suit: '♦', faceUp: true }
  ];
  player.hands[0].done = true;
  console.log(`  手牌1: ${player.hands[0].hand.map(c => c.rank + c.suit).join(' ')} = ${handValueAll(player.hands[0].hand)}点`);
  console.log(`  isBlackjack(手牌1): ${isBlackjack(player.hands[0].hand)}`);
  console.log(`  fromSplit: ${player.hands[0].fromSplit}`);
  console.log();

  console.log('【模拟庄家 18 点，进行结算】');
  const dealerValue = 18;
  const dealerBJ = false;
  const dealerBust = false;

  let totalProfit = 0;
  const chipsBeforeSettle = player.chips;
  console.log(`  结算前筹码: $${chipsBeforeSettle}`);

  player.hands.forEach((h, i) => {
    const cards = h.hand.map(c => c.rank + c.suit).join(' ');
    const v = handValueAll(h.hand);
    const bj = isBlackjack(h.hand);
    const profit = settleHand(h, dealerValue, dealerBJ, dealerBust);
    totalProfit += profit;
    player.chips += h.bet + profit;

    console.log(`\n  [手牌${i + 1}] ${cards} = ${v}点`);
    console.log(`    isBlackjack(纯牌面): ${bj}`);
    console.log(`    fromSplit: ${h.fromSplit}`);
    console.log(`    seatBlackjack(应该=bj && !fromSplit): ${bj && !h.fromSplit}`);
    console.log(`    下注: $${h.bet}`);
    console.log(`    profit: $${profit}`);
    console.log(`    返还筹码(本金+利润): $${h.bet + profit}`);

    if (h.fromSplit && bj) {
      const expected = h.bet;
      if (profit === expected) {
        console.log(`    ✅ 分牌后21点按1:1赔付正确`);
      } else {
        console.log(`    ❌ BUG! 分牌后21点 profit=$${profit}，应该是 $${expected}，多赔了 $${profit - expected}`);
      }
    }
    if (!h.fromSplit && bj) {
      const expected = Math.floor(h.bet * 1.5);
      if (profit === expected) {
        console.log(`    ✅ 自然BJ按1.5倍赔付正确`);
      } else {
        console.log(`    ❌ BUG! 自然BJ profit=$${profit}，应该是 $${expected}`);
      }
    }
  });

  console.log(`\n  总利润: $${totalProfit}`);
  console.log(`  结算后筹码: $${player.chips}`);
  console.log(`  筹码变化: $${chipsBeforeSettle} → $${player.chips}`);

  console.log('\n=== 检查 canSplit 对 A+K 的判断（用户说"起手A和K选了分牌"）===');
  const akHand = [{rank:'A',suit:'♠'},{rank:'K',suit:'♥'}];
  console.log(`  A+K 两张牌: A=11点, K=10点`);
  console.log(`  canSplit(A+K): ${canSplit(akHand)} (应该是 false，因为点数不同)`);
  console.log(`  所以 A+K 在当前规则下不能分牌，用户可能实际是两张 A 或两张 10 点`);
}

main().catch(err => { console.error(err); process.exit(1); });
