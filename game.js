const chalk = require('chalk');
const {
  createDeck, shuffle, drawCard, handValueAll,
  isBlackjack, isBust, getHiLoCount, canSplit
} = require('./cards');
const {
  NPC_PERSONALITIES, MIN_BET, MAX_BET,
  decideAction, getPersonalityLabel
} = require('./npcs');

const DECKS_PER_SHOE = 6;
const RESHUFFLE_AT = 52;

function createGameContext() {
  const ctx = {
    deck: [],
    runningCount: 0,
    decksRemaining: DECKS_PER_SHOE,
    initShoe() {
      ctx.deck = shuffle(createDeck(DECKS_PER_SHOE));
      ctx.runningCount = 0;
      ctx.decksRemaining = DECKS_PER_SHOE;
    },
    needsReshuffle() {
      return ctx.deck.length <= RESHUFFLE_AT;
    },
    drawWithCount() {
      if (ctx.deck.length <= RESHUFFLE_AT) {
        ctx.initShoe();
      }
      const card = drawCard(ctx.deck);
      if (!card) {
        ctx.initShoe();
        return ctx.drawWithCount();
      }
      ctx.runningCount += getHiLoCount(card);
      ctx.decksRemaining = Math.max(1, Math.floor(ctx.deck.length / 52));
      return card;
    }
  };
  ctx.initShoe();
  return ctx;
}

function buildInitialHands(seat) {
  if (seat.folded) return [];
  return [{
    hand: [],
    bet: seat.bet,
    folded: false,
    doubledDown: false,
    isBust: false,
    hasBlackjack: false,
    fromSplit: false,
    isSplitHand: false,
    splitAces: false,
    done: false
  }];
}

async function dealInitialHands(ctx, player, npcs, dealer, cb) {
  cb.onMessage('发牌中...');
  cb.onRequestRefresh();
  await cb.sleep(400);

  player.hands = buildInitialHands(player);
  for (const npc of npcs) {
    npc.hands = buildInitialHands(npc);
  }
  dealer.hand = [];

  for (let round = 0; round < 2; round++) {
    if (!player.folded && player.hands.length > 0) {
      player.hands[0].hand.push(ctx.drawWithCount());
    }
    for (const npc of npcs) {
      if (!npc.folded && npc.hands.length > 0) {
        npc.hands[0].hand.push(ctx.drawWithCount());
      }
    }
    dealer.hand.push(ctx.drawWithCount());
    cb.onRequestRefresh();
    await cb.sleep(400);
  }

  dealer.hand[0].faceUp = false;

  for (const npc of npcs) {
    if (!npc.folded && npc.hands.length > 0) {
      npc.hands[0].hasBlackjack = isBlackjack(npc.hands[0].hand);
    }
  }
  if (player.hands.length > 0) {
    player.hands[0].hasBlackjack = isBlackjack(player.hands[0].hand);
    if (player.hands[0].hasBlackjack) {
      cb.onMessage(chalk.yellow('🎉 玩家拿到 BLACKJACK!'));
    }
  }

  cb.onRequestRefresh();
  await cb.sleep(800);
}

async function handleSplit(ctx, seat, hand, handIdx, personalityLabel, cb) {
  const splitRank = hand.hand[0].rank;
  const isAces = splitRank === 'A';

  seat.chips -= hand.bet;
  if (cb.updatePlayerChips) cb.updatePlayerChips(seat.chips);
  seat.hasSplit = true;

  const secondCard = hand.hand.pop();

  const newHand = {
    hand: [secondCard],
    bet: hand.bet,
    folded: false,
    doubledDown: false,
    isBust: false,
    hasBlackjack: false,
    fromSplit: true,
    isSplitHand: true,
    splitAces: isAces,
    done: false
  };
  hand.fromSplit = true;
  hand.isSplitHand = true;
  hand.splitAces = isAces;

  const card1 = ctx.drawWithCount();
  hand.hand.push(card1);
  const card2 = ctx.drawWithCount();
  newHand.hand.push(card2);

  seat.hands.splice(handIdx + 1, 0, newHand);

  const who = personalityLabel
    ? `${seat.name} [${personalityLabel}]`
    : '玩家';
  const handTag = seat.hands.length > 1 ? ` [手牌${handIdx + 1}]` : '';

  cb.onMessage(chalk.cyan(
    `🔀 ${who}${handTag} 分牌! ${splitRank}对拆为两手` +
    (isAces ? ' (分A只补一张)' : '') +
    (personalityLabel ? '' : ` | 补牌: ${card1.rank}${card1.suit} / ${card2.rank}${card2.suit}`)
  ));

  if (isAces) {
    hand.done = true;
    newHand.done = true;
  }

  cb.onRequestRefresh();
  await cb.sleep(personalityLabel ? 600 : 800);
  return { didSplit: true, isAces };
}

async function runPlayerHand(ctx, player, hand, handIdx, cb) {
  if (hand.folded || hand.hasBlackjack || hand.isBust || hand.done) return;

  const splitAcesDone = hand.splitAces && hand.hand.length > 2;
  if (splitAcesDone) return;

  while (true) {
    const v = handValueAll(hand.hand);
    if (v >= 21) break;
    if (hand.doubledDown) break;

    const canDouble = hand.hand.length === 2 && player.chips >= hand.bet;
    const canSplitNow = canSplit(hand.hand) && player.chips >= hand.bet && !player.hasSplit;
    const handLabel = player.hands.length > 1 ? ` [手牌${handIdx + 1}]` : '';

    cb.setActiveHand(handIdx);
    const msg = `${handLabel} 选择操作: ${chalk.green('h')}要牌 / ${chalk.green('s')}停牌` +
      (canDouble ? ` / ${chalk.magenta('d')}加倍` : '') +
      (canSplitNow ? ` / ${chalk.cyan('p')}分牌` : '') +
      ` / ${chalk.cyan('help')} / ${chalk.red('q')}uit`;
    cb.onMessage(msg);
    cb.onRequestRefresh();

    const action = await cb.askPlayer('你的选择: ');

    if (action === 'help') {
      cb.showHelp();
      continue;
    }
    if (action === 'q' || action === 'quit') {
      return { quit: true };
    }
    if (action === 's' || action === 'stand') {
      cb.onMessage(`玩家${handLabel}停牌`);
      break;
    }
    if (action === 'h' || action === 'hit') {
      const card = ctx.drawWithCount();
      hand.hand.push(card);
      cb.onMessage(`玩家${handLabel}要了一张: ${card.rank}${card.suit}`);
      if (isBust(hand.hand)) {
        hand.isBust = true;
        cb.onMessage(chalk.red(`💥 玩家${handLabel} BUST!`));
      }
      cb.onRequestRefresh();
      await cb.sleep(500);
      continue;
    }
    if (action === 'd' || action === 'double') {
      if (!canDouble) {
        cb.onMessage(chalk.red('无法加倍下注 (筹码不足或手牌>2张)'));
        continue;
      }
      player.chips -= hand.bet;
      hand.bet *= 2;
      hand.doubledDown = true;
      if (cb.updatePlayerChips) cb.updatePlayerChips(player.chips);
      const card = ctx.drawWithCount();
      hand.hand.push(card);
      cb.onMessage(chalk.magenta(`⬆ 玩家${handLabel}加倍至 $${hand.bet}，得: ${card.rank}${card.suit}`));
      if (isBust(hand.hand)) {
        hand.isBust = true;
        cb.onMessage(chalk.red(`💥 玩家${handLabel} BUST!`));
      }
      cb.onRequestRefresh();
      await cb.sleep(700);
      break;
    }
    if (action === 'p' || action === 'split') {
      if (!canSplitNow) {
        cb.onMessage(chalk.red('无法分牌 (筹码不足 / 非对子 / 已分过牌)'));
        continue;
      }
      const res = await handleSplit(ctx, player, hand, handIdx, null, cb);
      break;
    }

    cb.onMessage(chalk.red('无效指令!'));
  }

  return { quit: false };
}

async function runPlayerTurn(ctx, player, cb) {
  if (player.folded) return { quit: false };
  cb.onPhase('player_turn');

  for (let hi = 0; hi < player.hands.length; hi++) {
    const result = await runPlayerHand(ctx, player, player.hands[hi], hi, cb);
    if (result && result.quit) return { quit: true };
  }
  cb.setActiveHand(-1);
  return { quit: false };
}

async function runNPCHand(ctx, npc, hand, handIdx, dealerUp, cb) {
  if (hand.folded || hand.hasBlackjack || hand.isBust || hand.done) return;
  const splitAcesDone = hand.splitAces && hand.hand.length > 2;
  if (splitAcesDone) return;

  const personalityLabel = getPersonalityLabel(npc.personality);

  let safety = 0;
  while (safety < 30) {
    safety++;
    const v = handValueAll(hand.hand);
    if (v >= 21) break;
    if (hand.doubledDown) break;

    const fakeNpc = {
      ...npc,
      hand: hand.hand,
      bet: hand.bet,
      folded: hand.folded,
      doubledDown: hand.doubledDown,
      isBust: hand.isBust,
      hasBlackjack: hand.hasBlackjack,
      hasSplit: npc.hasSplit
    };
    const action = decideAction(fakeNpc, dealerUp, ctx.runningCount, ctx.decksRemaining);
    const handLabel = npc.hands.length > 1 ? ` [手牌${handIdx + 1}]` : '';

    if (action === 'split') {
      if (canSplit(hand.hand) && npc.chips >= hand.bet && !npc.hasSplit) {
        await handleSplit(ctx, npc, hand, handIdx, personalityLabel, cb);
        break;
      } else {
        continue;
      }
    }
    if (action === 'stand') {
      cb.onMessage(`${npc.name} [${personalityLabel}]${handLabel} 停牌`);
      cb.onRequestRefresh();
      await cb.sleep(500);
      break;
    }
    if (action === 'hit') {
      const card = ctx.drawWithCount();
      hand.hand.push(card);
      cb.onMessage(`${npc.name} [${personalityLabel}]${handLabel} 要牌: ${card.rank}${card.suit}`);
      if (isBust(hand.hand)) {
        hand.isBust = true;
        cb.onMessage(chalk.red(`💥 ${npc.name}${handLabel} BUST!`));
      }
      cb.onRequestRefresh();
      await cb.sleep(500);
      continue;
    }
    if (action === 'double') {
      if (hand.hand.length === 2 && npc.chips >= hand.bet) {
        npc.chips -= hand.bet;
        hand.bet *= 2;
        hand.doubledDown = true;
        const card = ctx.drawWithCount();
        hand.hand.push(card);
        cb.onMessage(chalk.magenta(`⬆ ${npc.name} [${personalityLabel}]${handLabel} 加倍至 $${hand.bet}，得: ${card.rank}${card.suit}`));
        if (isBust(hand.hand)) {
          hand.isBust = true;
          cb.onMessage(chalk.red(`💥 ${npc.name}${handLabel} BUST!`));
        }
        cb.onRequestRefresh();
        await cb.sleep(600);
        break;
      } else {
        cb.onMessage(`${npc.name} [${personalityLabel}]${handLabel} 停牌`);
        cb.onRequestRefresh();
        await cb.sleep(400);
        break;
      }
    }
  }
}

async function runNPCTurn(ctx, npcs, dealer, cb) {
  cb.onPhase('npc_turn');
  const dealerUp = dealer.hand[1] || dealer.hand[0];
  for (const npc of npcs) {
    if (npc.folded) continue;
    for (let hi = 0; hi < npc.hands.length; hi++) {
      await runNPCHand(ctx, npc, npc.hands[hi], hi, dealerUp, cb);
    }
  }
}

async function runDealerTurn(ctx, player, npcs, dealer, cb) {
  cb.onPhase('dealer_turn');
  cb.revealDealer();
  dealer.hand[0].faceUp = true;

  const playerActive = player.hands.some(h => !h.folded && !h.isBust && !h.hasBlackjack);
  const npcActive = npcs.some(n => n.hands.some(h => !h.folded && !h.isBust && !h.hasBlackjack));
  const anyActive = playerActive || npcActive;

  cb.onRequestRefresh();
  await cb.sleep(500);

  if (isBlackjack(dealer.hand)) {
    cb.onMessage(chalk.yellow('💀 庄家 BLACKJACK!'));
    cb.onRequestRefresh();
    await cb.sleep(1000);
    return;
  }

  if (!anyActive) {
    cb.onMessage('所有玩家爆牌或BJ，庄家无需补牌');
    cb.onRequestRefresh();
    await cb.sleep(500);
    return;
  }

  let safety = 0;
  while (safety < 30) {
    safety++;
    const v = handValueAll(dealer.hand);
    if (v >= 17) break;
    const card = ctx.drawWithCount();
    dealer.hand.push(card);
    cb.onMessage(`庄家要牌: ${card.rank}${card.suit}`);
    if (isBust(dealer.hand)) {
      cb.onMessage(chalk.green('💥 庄家 BUST!'));
    }
    cb.onRequestRefresh();
    await cb.sleep(600);
  }
}

function settleHand(h, dealerValue, dealerBlackjack, dealerBust) {
  if (h.folded) return 0;
  const seatValue = handValueAll(h.hand);
  const seatBlackjack = isBlackjack(h.hand) && !h.fromSplit;
  const seatBust = isBust(h.hand);

  let profit = 0;
  if (seatBust) profit = -h.bet;
  else if (seatBlackjack && !dealerBlackjack) profit = Math.floor(h.bet * 1.5);
  else if (dealerBust) profit = h.bet;
  else if (seatBlackjack && dealerBlackjack) profit = 0;
  else if (seatValue > dealerValue) profit = h.bet;
  else if (seatValue < dealerValue) profit = -h.bet;
  else profit = 0;

  h.profit = profit;
  return profit;
}

function settleAll(player, npcs, dealer, cb) {
  cb.onPhase('settlement');
  const dealerValue = handValueAll(dealer.hand);
  const dealerBlackjack = isBlackjack(dealer.hand);
  const dealerBust = isBust(dealer.hand);

  let totalPlayerProfit = 0;
  for (const h of player.hands) {
    totalPlayerProfit += settleHand(h, dealerValue, dealerBlackjack, dealerBust);
    player.chips += h.bet + (h.profit || 0);
  }

  for (const npc of npcs) {
    let totalNpcProfit = 0;
    for (const h of npc.hands) {
      totalNpcProfit += settleHand(h, dealerValue, dealerBlackjack, dealerBust);
      npc.chips += h.bet + (h.profit || 0);
    }
    npc.lastProfit = totalNpcProfit;
    if (npc.chips < MIN_BET) npc.chips = 2000;
  }

  const totalBet = player.hands.reduce((s, h) => s + h.bet, 0);
  return {
    totalPlayerProfit,
    totalBet,
    dealerValue,
    playerValue: player.hands.map(h => handValueAll(h.hand)).join('/'),
    didSplit: !!player.hasSplit
  };
}

async function runRound(ctx, { player, npcs, callbacks }) {
  const cb = callbacks;
  const dealer = { hand: [], revealed: false };
  cb.bindDealer(dealer);

  cb.onPhase('dealing');
  await dealInitialHands(ctx, player, npcs, dealer, cb);

  const ptRes = await runPlayerTurn(ctx, player, cb);
  if (ptRes && ptRes.quit) return { quit: true };

  await runNPCTurn(ctx, npcs, dealer, cb);
  await runDealerTurn(ctx, player, npcs, dealer, cb);

  const result = settleAll(player, npcs, dealer, cb);
  return { quit: false, dealer, ...result };
}

module.exports = {
  MIN_BET,
  MAX_BET,
  DECKS_PER_SHOE,
  RESHUFFLE_AT,
  createGameContext,
  runRound,
  handleSplit,
  settleHand
};
