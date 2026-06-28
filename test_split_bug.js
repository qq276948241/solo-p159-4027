const { handValueAll, isBlackjack } = require('./cards');
const { settleHand } = require('./game');

console.log('=== 复现分牌后 A+10 被错判 BJ 的 bug ===\n');

const handFromSplit = {
  folded: false,
  fromSplit: true,
  isSplitHand: true,
  hand: [
    { rank: 'A', suit: '♠', faceUp: true },
    { rank: '10', suit: '♠', faceUp: true }
  ],
  bet: 100
};

const handNormalBJ = {
  folded: false,
  fromSplit: false,
  hand: [
    { rank: 'A', suit: '♠', faceUp: true },
    { rank: 'K', suit: '♥', faceUp: true }
  ],
  bet: 100
};

console.log('【分牌后 A+10】');
console.log('  handValueAll:', handValueAll(handFromSplit.hand));
console.log('  isBlackjack:', isBlackjack(handFromSplit.hand));
console.log('  fromSplit:', handFromSplit.fromSplit);
const profit1 = settleHand(handFromSplit, 18, false, false);
console.log('  settleHand(庄家18点) profit:', profit1);
console.log('  期望值: 100 (普通21点1:1)');
console.log('  是否正确:', profit1 === 100 ? '✅' : '❌ BUG! 多赔了 ' + (profit1 - 100));

console.log('\n【起手自然 BJ A+K】');
console.log('  handValueAll:', handValueAll(handNormalBJ.hand));
console.log('  isBlackjack:', isBlackjack(handNormalBJ.hand));
console.log('  fromSplit:', handNormalBJ.fromSplit);
const profit2 = settleHand(handNormalBJ, 18, false, false);
console.log('  settleHand(庄家18点) profit:', profit2);
console.log('  期望值: 150 (BJ 1.5倍)');
console.log('  是否正确:', profit2 === 150 ? '✅' : '❌');

console.log('\n=== 检查 isBlackjack 判断是否受牌张来源影响 ===');
console.log('  isBlackjack 只看手牌内容，不看 fromSplit 标记');
console.log('  所以需要在 settleHand 里额外加 !fromSplit 过滤');
