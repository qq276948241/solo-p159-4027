const { handValueAll, isBlackjack, canSplit } = require('./cards');
const { settleHand, MIN_BET } = require('./game');
const { NPC_PERSONALITIES } = require('./npcs');

console.log('=== 深度检查：分牌后各字段状态 ===\n');

function makeHand(cards, fromSplit, bet) {
  return {
    hand: cards.map(([r, s]) => ({ rank: r, suit: s, faceUp: true })),
    bet,
    folded: false,
    doubledDown: false,
    isBust: false,
    hasBlackjack: false,
    fromSplit,
    isSplitHand: fromSplit,
    splitAces: fromSplit && cards[0][0] === 'A',
    done: false
  };
}

function testCase(name, handCards, fromSplit, dealerValue, dealerBJ, dealerBust, expectedProfit) {
  const h = makeHand(handCards, fromSplit, 100);
  h.hasBlackjack = isBlackjack(h.hand);
  const actual = settleHand(h, dealerValue, dealerBJ, dealerBust);
  const ok = actual === expectedProfit;
  console.log(`${ok ? '✅' : '❌'} ${name}`);
  console.log(`   牌面: ${handCards.map(([r, s]) => r + s).join(' ')}, fromSplit=${fromSplit}, hasBlackjack(字段)=${h.hasBlackjack}`);
  console.log(`   庄家: ${dealerValue}点${dealerBJ ? ' BJ' : ''}${dealerBust ? ' BUST' : ''}`);
  console.log(`   profit: 实际=$${actual}, 期望=$${expectedProfit}${ok ? '' : ' ← 错误!'}`);
  console.log();
  return ok;
}

let allPass = true;

console.log('--- 分牌后的 A+10 应该按普通21点 1:1 赔付 ---');
allPass &= testCase('分牌 A♠+10♠ vs 庄家18 → 赢100', [['A', '♠'], ['10', '♠']], true, 18, false, false, 100);
allPass &= testCase('分牌 A♥+K♦ vs 庄家17 → 赢100', [['A', '♥'], ['K', '♦']], true, 17, false, false, 100);

console.log('--- 自然起手 BJ 应该 1.5 倍赔付 ---');
allPass &= testCase('自然 A♠+K♥ vs 庄家18 → 赢150', [['A', '♠'], ['K', '♥']], false, 18, false, false, 150);
allPass &= testCase('自然 A♣+Q♦ vs 庄家20 → 赢150', [['A', '♣'], ['Q', '♦']], false, 20, false, false, 150);

console.log('--- 玩家 vs 庄家各种情况 ---');
allPass &= testCase('分牌 21点 vs 庄家 BJ → 平局0', [['A', '♠'], ['10', '♠']], true, 21, true, false, 0);
allPass &= testCase('自然 BJ vs 庄家 BJ → 平局0', [['A', '♠'], ['K', '♥']], false, 21, true, false, 0);
allPass &= testCase('分牌 21点 vs 庄家 BUST → 赢100', [['10', '♠'], ['J', '♠']], true, 25, false, true, 100);
allPass &= testCase('分牌 19点 vs 庄家 20 → 输100', [['9', '♠'], ['10', '♠']], true, 20, false, false, -100);

console.log(allPass ? '\n✅ 所有 settleHand 单测通过！' : '\n❌ 有测试失败！');

if (!allPass) {
  console.log('\n让我手动模拟 settleHand 看看问题：');
  const h = makeHand([['A', '♠'], ['10', '♠']], true, 100);
  console.log('  h.fromSplit =', h.fromSplit);
  console.log('  isBlackjack(h.hand) =', isBlackjack(h.hand));
  console.log('  seatBlackjack = isBlackjack(h.hand) && !h.fromSplit =', isBlackjack(h.hand) && !h.fromSplit);
}

console.log('\n=== 检查另一个可能的 bug 点：hand.hasBlackjack 残留 ===');
console.log('场景：起手两张A，初始 hasBlackjack=false（因为A+A=12≠21），分牌后应该还是 false');
console.log('场景：起手A+K → 本身就是BJ，且 canSplit=false（11≠10），不会分牌');
console.log('canSplit 判断依据是 cardValue 相等：A=11, K=10，所以 A+K 不能分牌 ✓');

console.log('\n=== 检查 runPlayerHand 开头的 hand.hasBlackjack 判断是否有影响 ===');
console.log('分牌后的新牌 hasBlackjack=false（handleSplit 里设置了），所以不会被跳过');
console.log('原手牌如果起手是两张A，hasBlackjack=false，分牌后也是 false，不会被跳过');
console.log('但——原手牌如果起手是 A+K(自然BJ)，canSplit=false，根本不会进分牌分支，所以没问题');
