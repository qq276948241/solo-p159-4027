const { handValueAll, isBlackjack } = require('./cards');
const { createGameContext, handleSplit, settleHand, isHandBlackjack } = require('./game');
const { NPC_PERSONALITIES, createNPC, MIN_BET } = require('./npcs');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.log(`  ✗ ${msg}`); }
}

function makeHand(cards, opts = {}) {
  return {
    hand: cards.map(([r, s]) => ({ rank: r, suit: s, faceUp: true })),
    bet: opts.bet || 100,
    folded: false,
    doubledDown: false,
    isBust: false,
    hasBlackjack: opts.hasBlackjack !== undefined ? opts.hasBlackjack : false,
    fromSplit: !!opts.fromSplit,
    isSplitHand: !!opts.isSplitHand,
    splitAces: !!opts.splitAces,
    done: false
  };
}

async function main() {
  console.log('\n═══ 分牌 BJ Bug 修复验证 ═══\n');

  console.log('【1. isHandBlackjack 辅助函数】');
  {
    const normalBJ = makeHand([['A', '♠'], ['K', '♥']]);
    assert(isHandBlackjack(normalBJ) === true, '自然 A+K → isHandBlackjack=true');

    const splitBJ = makeHand([['A', '♠'], ['10', '♠']], { fromSplit: true });
    assert(isHandBlackjack(splitBJ) === false, '分牌 A+10 (fromSplit=true) → isHandBlackjack=false');

    const splitHandBJ = makeHand([['A', '♦'], ['Q', '♣']], { isSplitHand: true });
    assert(isHandBlackjack(splitHandBJ) === false, '分牌 A+Q (isSplitHand=true) → isHandBlackjack=false');

    const both = makeHand([['A', '♣'], ['J', '♦']], { fromSplit: true, isSplitHand: true });
    assert(isHandBlackjack(both) === false, '分牌 A+J (双标记) → isHandBlackjack=false');

    const not21 = makeHand([['10', '♠'], ['9', '♥']]);
    assert(isHandBlackjack(not21) === false, '19点 → isHandBlackjack=false');
  }

  console.log('\n【2. settleHand 结算金额】');
  {
    const h1 = makeHand([['A', '♠'], ['10', '♠']], { fromSplit: true, bet: 200 });
    assert(settleHand(h1, 18, false, false) === 200, '分牌 A+10 vs 18 → 1:1 赢 $200 (非1.5倍)');

    const h2 = makeHand([['A', '♠'], ['K', '♥']], { bet: 200 });
    assert(settleHand(h2, 18, false, false) === 300, '自然 A+K vs 18 → 1.5倍 赢 $300');

    const h3 = makeHand([['A', '♠'], ['10', '♠']], { isSplitHand: true, bet: 100 });
    assert(settleHand(h3, 21, true, false) === 0, '分牌 A+10 vs 庄家BJ → 平局 $0');

    const h4 = makeHand([['A', '♠'], ['K', '♥']], { bet: 100 });
    assert(settleHand(h4, 21, true, false) === 0, '自然BJ vs 庄家BJ → 平局 $0');
  }

  console.log('\n【3. handleSplit 状态重置】');
  {
    const ctx = createGameContext();
    const player = {
      name: 'T', chips: 500, bet: 100, folded: false, hasSplit: false,
      hands: [makeHand([['A', '♠'], ['A', '♥']], { hasBlackjack: false })],
      lastProfit: 0
    };
    player.chips -= 100;

    const cb = {
      onMessage() {}, onRequestRefresh() {}, updatePlayerChips() {},
      sleep() { return Promise.resolve(); }
    };
    await handleSplit(ctx, player, player.hands[0], 0, null, cb);

    assert(player.hands.length === 2, '分牌后产生 2 副手牌');
    assert(player.hands[0].fromSplit === true, '原手牌 fromSplit=true');
    assert(player.hands[0].isSplitHand === true, '原手牌 isSplitHand=true');
    assert(player.hands[0].hasBlackjack === false, '原手牌 hasBlackjack 被重置为 false');
    assert(player.hands[1].fromSplit === true, '新手牌 fromSplit=true');
    assert(player.hands[1].hasBlackjack === false, '新手牌 hasBlackjack=false');

    player.hands[0].hand = [{rank:'A',suit:'♠',faceUp:true},{rank:'10',suit:'♦',faceUp:true}];
    assert(isHandBlackjack(player.hands[0]) === false, '分牌第一副补成A+10 → isHandBlackjack=false');
    assert(settleHand(player.hands[0], 18, false, false) === 100, '分牌第一副A+10结算 → 1:1 $100');
  }

  console.log(`\n═══ 结果: ${passed} 通过, ${failed} 失败 ═══\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
