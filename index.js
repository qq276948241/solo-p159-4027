const readline = require('readline');
const chalk = require('chalk');
const {
  createDeck, shuffle, drawCard, handValueAll,
  isBlackjack, isBust, getHiLoCount, canSplit, isSplitAces
} = require('./cards');
const {
  NPC_PERSONALITIES, MIN_BET, MAX_BET,
  createNPC, decideBet, decideAction, decideSplit, getPersonalityLabel
} = require('./npcs');
const {
  loadSave, saveSave, addHistory, takeLoan,
  repayLoan, canAffordLoan, needsRepayment, getLoanInfo
} = require('./storage');
const {
  renderTable, renderStatusBar, renderHelp,
  renderHistory, clearScreen, print
} = require('./ui');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: true
});

const NPC_CONFIGS = [
  { name: '阿烈', personality: NPC_PERSONALITIES.AGGRESSIVE, chips: 2000 },
  { name: '老守', personality: NPC_PERSONALITIES.CONSERVATIVE, chips: 2000 },
  { name: '算师', personality: NPC_PERSONALITIES.CARD_COUNTER, chips: 2000 }
];

const DECKS_PER_SHOE = 6;
const RESHUFFLE_AT = 52;

let gameState = {
  deck: [],
  runningCount: 0,
  saveData: loadSave(),
  player: null,
  npcs: [],
  dealer: null,
  phase: 'idle',
  message: '',
  gameOver: false,
  roundBet: 0,
  playerProfit: 0,
  playerResult: null,
  dealerRevealed: false,
  decksRemaining: DECKS_PER_SHOE,
  activeHandIdx: 0
};

function initShoe() {
  gameState.deck = shuffle(createDeck(DECKS_PER_SHOE));
  gameState.runningCount = 0;
  gameState.decksRemaining = DECKS_PER_SHOE;
}

function newRound() {
  if (gameState.deck.length <= RESHUFFLE_AT) {
    initShoe();
    gameState.message = '🔄 牌堆已重新洗牌';
  }

  gameState.dealerRevealed = false;
  gameState.playerProfit = 0;
  gameState.playerResult = null;
  gameState.activeHandIdx = 0;

  gameState.player = {
    name: '你',
    personality: null,
    chips: gameState.saveData.chips,
    hands: [],
    bet: 0,
    folded: false,
    hasSplit: false,
    lastProfit: gameState.player ? gameState.player.lastProfit : 0,
    loanDue: gameState.saveData.loanTaken ? gameState.saveData.loanAmount : 0
  };

  gameState.npcs = NPC_CONFIGS.map(cfg => {
    const npc = createNPC(cfg.name, cfg.personality, cfg.chips);
    npc.lastProfit = 0;
    npc.hands = [];
    npc.hasSplit = false;
    return npc;
  });

  gameState.dealer = {
    hand: [],
    revealed: false
  };

  updateDecksRemaining();
}

function updateDecksRemaining() {
  gameState.decksRemaining = Math.max(1, Math.floor(gameState.deck.length / 52));
}

function drawWithCount() {
  const card = drawCard(gameState.deck);
  if (card) {
    gameState.runningCount += getHiLoCount(card);
    updateDecksRemaining();
  }
  return card;
}

function prompt(question) {
  return new Promise(resolve => {
    rl.question(chalk.cyan(question), answer => resolve(answer.trim().toLowerCase()));
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function refreshScreen() {
  clearScreen();
  const dealerForRender = { ...gameState.dealer, revealed: gameState.dealerRevealed };
  print(renderTable(gameState.player, gameState.npcs, dealerForRender, gameState.saveData, gameState.activeHandIdx));
  print('');
  print(renderStatusBar(
    gameState.message,
    getPhaseLabel(),
    gameState.deck.length,
    gameState.runningCount
  ));
  print('');
}

function getPhaseLabel() {
  switch (gameState.phase) {
    case 'betting': return '下注阶段';
    case 'dealing': return '发牌阶段';
    case 'player_turn': return '玩家回合';
    case 'npc_turn': return 'NPC 回合';
    case 'dealer_turn': return '庄家回合';
    case 'settlement': return '结算阶段';
    case 'loan': return '借贷';
    default: return '准备中';
  }
}

async function phaseBetting() {
  gameState.phase = 'betting';
  gameState.message = '请下注，输入 0 进入借贷选项';

  const player = gameState.player;
  const canLoan = canAffordLoan(gameState.saveData);

  for (const npc of gameState.npcs) {
    const dealerCard = gameState.deck[0] || null;
    const npcBet = decideBet(npc, dealerCard, gameState.runningCount, gameState.decksRemaining);
    npc.bet = npcBet;
    if (npcBet > 0) {
      npc.chips -= npcBet;
    } else {
      npc.folded = true;
    }
  }

  refreshScreen();

  while (true) {
    const loanInfo = getLoanInfo();
    let extraHint = '';
    if (player.chips < MIN_BET && canLoan) {
      extraHint = chalk.red(` (筹码不足! 可借 $${loanInfo.amount})`);
    }
    const betStr = await prompt(
      `下注 [$${MIN_BET} ~ $${Math.min(MAX_BET, player.chips)}]${extraHint}: `
    );

    if (betStr === 'h' || betStr === 'help') {
      print(renderHelp());
      continue;
    }
    if (betStr === 'q' || betStr === 'quit') {
      await saveAndQuit();
      return false;
    }

    if (betStr === '0' && player.chips < MIN_BET) {
      const loanResult = await phaseLoan();
      if (loanResult === 'quit') {
        await saveAndQuit();
        return false;
      }
      if (loanResult === 'gameover') {
        return false;
      }
      refreshScreen();
      continue;
    }

    const bet = parseInt(betStr, 10);
    if (isNaN(bet) || bet < MIN_BET || bet > Math.min(MAX_BET, player.chips)) {
      gameState.message = chalk.red(`无效下注! 请输入 $${MIN_BET} ~ $${Math.min(MAX_BET, player.chips)}`);
      refreshScreen();
      continue;
    }

    player.bet = bet;
    player.chips -= bet;
    gameState.saveData.chips = player.chips;
    break;
  }

  return true;
}

async function phaseLoan() {
  gameState.phase = 'loan';

  if (!canAffordLoan(gameState.saveData)) {
    if (needsRepayment(gameState.saveData)) {
      gameState.message = chalk.bgRed.white(' 你还有未偿还的高利贷，无法再借！ ');
      refreshScreen();
      await sleep(1500);
      if (gameState.player.chips < gameState.saveData.loanAmount) {
        return triggerGameOver('无法偿还高利贷');
      }
    } else {
      gameState.message = chalk.red(' 你无法借贷。 ');
      refreshScreen();
      await sleep(1000);
    }
    return 'done';
  }

  const loanInfo = getLoanInfo();
  refreshScreen();
  print(chalk.bgYellow.black(
    `\n  ⚠ 高利贷警告 ⚠ 借 $${loanInfo.amount}，下局需还 $${loanInfo.repayAmount}（${loanInfo.multiplier}倍）\n`
  ));

  const answer = await prompt('接受高利贷? (y/n): ');
  if (answer === 'q' || answer === 'quit') return 'quit';
  if (answer === 'y' || answer === 'yes') {
    const got = takeLoan(gameState.saveData);
    if (got) {
      gameState.player.chips = gameState.saveData.chips;
      gameState.message = chalk.green(`✅ 已借到 $${got}，下局需还 $${gameState.saveData.loanAmount}`);
      return 'done';
    }
  }

  if (gameState.player.chips < MIN_BET) {
    return triggerGameOver('筹码不足且拒绝借贷');
  }
  return 'done';
}

async function phaseDealing() {
  gameState.phase = 'dealing';
  gameState.message = '发牌中...';
  refreshScreen();
  await sleep(400);

  const player = gameState.player;
  player.hands = [{
    hand: [],
    bet: player.bet,
    folded: false,
    doubledDown: false,
    isBust: false,
    hasBlackjack: false,
    fromSplit: false,
    isSplitHand: false,
    splitAces: false,
    done: false
  }];

  for (const npc of gameState.npcs) {
    if (!npc.folded) {
      npc.hands = [{
        hand: [],
        bet: npc.bet,
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
  }

  for (let round = 0; round < 2; round++) {
    if (!player.folded) {
      player.hands[0].hand.push(drawWithCount());
    }
    for (const npc of gameState.npcs) {
      if (!npc.folded && npc.hands.length > 0) {
        npc.hands[0].hand.push(drawWithCount());
      }
    }
    gameState.dealer.hand.push(drawWithCount());
    refreshScreen();
    await sleep(400);
  }

  gameState.dealer.hand[0].faceUp = false;

  for (const npc of gameState.npcs) {
    if (!npc.folded && npc.hands.length > 0) {
      npc.hands[0].hasBlackjack = isBlackjack(npc.hands[0].hand);
    }
  }
  player.hands[0].hasBlackjack = isBlackjack(player.hands[0].hand);

  if (player.hands[0].hasBlackjack) {
    gameState.message = chalk.yellow('🎉 玩家拿到 BLACKJACK!');
  }
  refreshScreen();
  await sleep(800);
  return true;
}

async function phasePlayerTurn() {
  gameState.phase = 'player_turn';
  const player = gameState.player;

  if (player.folded) return true;

  for (let hi = 0; hi < player.hands.length; hi++) {
    gameState.activeHandIdx = hi;
    const h = player.hands[hi];

    if (h.folded || h.hasBlackjack || h.isBust || h.done) continue;

    const isSplitAcesHand = h.splitAces && h.hand.length > 2;

    while (true) {
      const v = handValueAll(h.hand);
      if (v >= 21) break;
      if (h.doubledDown) break;
      if (isSplitAcesHand) break;

      const canDouble = h.hand.length === 2 && player.chips >= h.bet;
      const canSplitNow = canSplit(h.hand) && player.chips >= h.bet && !player.hasSplit;
      const handLabel = player.hands.length > 1 ? ` [手牌${hi + 1}]` : '';

      gameState.message = `${handLabel} 选择操作: ${chalk.green('h')}要牌 / ${chalk.green('s')}停牌` +
        (canDouble ? ` / ${chalk.magenta('d')}加倍` : '') +
        (canSplitNow ? ` / ${chalk.cyan('p')}分牌` : '') +
        ` / ${chalk.cyan('help')} / ${chalk.red('q')}uit`;
      refreshScreen();

      const action = await prompt('你的选择: ');

      if (action === 'help') {
        print(renderHelp());
        continue;
      }
      if (action === 'q' || action === 'quit') {
        await saveAndQuit();
        return false;
      }
      if (action === 's' || action === 'stand') {
        gameState.message = `玩家${handLabel}停牌`;
        break;
      }
      if (action === 'h' || action === 'hit') {
        const card = drawWithCount();
        h.hand.push(card);
        gameState.message = `玩家${handLabel}要了一张: ${card.rank}${card.suit}`;
        if (isBust(h.hand)) {
          h.isBust = true;
          gameState.message = chalk.red(`💥 玩家${handLabel} BUST!`);
        }
        refreshScreen();
        await sleep(500);
        continue;
      }
      if (action === 'd' || action === 'double') {
        if (!canDouble) {
          gameState.message = chalk.red('无法加倍下注 (筹码不足或手牌>2张)');
          continue;
        }
        player.chips -= h.bet;
        h.bet *= 2;
        h.doubledDown = true;
        gameState.saveData.chips = player.chips;
        const card = drawWithCount();
        h.hand.push(card);
        gameState.message = chalk.magenta(`⬆ 玩家${handLabel}加倍至 $${h.bet}，得: ${card.rank}${card.suit}`);
        if (isBust(h.hand)) {
          h.isBust = true;
          gameState.message = chalk.red(`💥 玩家${handLabel} BUST!`);
        }
        refreshScreen();
        await sleep(700);
        break;
      }
      if (action === 'p' || action === 'split') {
        if (!canSplitNow) {
          gameState.message = chalk.red('无法分牌 (筹码不足 / 非对子 / 已分过牌)');
          continue;
        }

        const splitRank = h.hand[0].rank;
        const isAces = splitRank === 'A';

        player.chips -= h.bet;
        gameState.saveData.chips = player.chips;
        player.hasSplit = true;

        const secondCard = h.hand.pop();

        const newHand = {
          hand: [secondCard],
          bet: h.bet,
          folded: false,
          doubledDown: false,
          isBust: false,
          hasBlackjack: false,
          fromSplit: true,
          isSplitHand: true,
          splitAces: isAces,
          done: false
        };
        h.fromSplit = true;
        h.isSplitHand = true;
        h.splitAces = isAces;

        const card1 = drawWithCount();
        h.hand.push(card1);

        const card2 = drawWithCount();
        newHand.hand.push(card2);

        player.hands.splice(hi + 1, 0, newHand);

        gameState.message = chalk.cyan(
          `� 玩家分牌! ${splitRank}对拆为两手` +
          (isAces ? ' (分A只补一张)' : '') +
          ` | 补牌: ${card1.rank}${card1.suit} / ${card2.rank}${card2.suit}`
        );

        if (isAces) {
          h.done = true;
          newHand.done = true;
        }

        refreshScreen();
        await sleep(800);
        break;
      }

      gameState.message = chalk.red('无效指令!');
    }
  }

  gameState.activeHandIdx = -1;
  return true;
}

async function phaseNPCTurn() {
  gameState.phase = 'npc_turn';

  for (const npc of gameState.npcs) {
    if (npc.folded) continue;

    for (let hi = 0; hi < npc.hands.length; hi++) {
      const h = npc.hands[hi];
      if (h.folded || h.hasBlackjack || h.isBust || h.done) continue;

      const dealerUp = gameState.dealer.hand[1] || gameState.dealer.hand[0];
      const personalityLabel = getPersonalityLabel(npc.personality);

      const splitAcesDone = h.splitAces && h.hand.length > 2;
      if (splitAcesDone) continue;

      let safety = 0;
      while (safety < 30) {
        safety++;
        const v = handValueAll(h.hand);
        if (v >= 21) break;
        if (h.doubledDown) break;

        const fakeNpc = {
          ...npc,
          hand: h.hand,
          bet: h.bet,
          folded: h.folded,
          doubledDown: h.doubledDown,
          isBust: h.isBust,
          hasBlackjack: h.hasBlackjack,
          hasSplit: npc.hasSplit
        };
        const action = decideAction(fakeNpc, dealerUp, gameState.runningCount, gameState.decksRemaining);
        const handLabel = npc.hands.length > 1 ? ` [手牌${hi + 1}]` : '';

        if (action === 'split') {
          const splitRank = h.hand[0].rank;
          const isAces = splitRank === 'A';

          if (canSplit(h.hand) && npc.chips >= h.bet && !npc.hasSplit) {
            npc.chips -= h.bet;
            npc.hasSplit = true;

            const secondCard = h.hand.pop();
            const newHand = {
              hand: [secondCard],
              bet: h.bet,
              folded: false,
              doubledDown: false,
              isBust: false,
              hasBlackjack: false,
              fromSplit: true,
              isSplitHand: true,
              splitAces: isAces,
              done: false
            };
            h.fromSplit = true;
            h.isSplitHand = true;
            h.splitAces = isAces;

            const card1 = drawWithCount();
            h.hand.push(card1);
            const card2 = drawWithCount();
            newHand.hand.push(card2);

            npc.hands.splice(hi + 1, 0, newHand);

            gameState.message = chalk.cyan(
              `🔀 ${npc.name} [${personalityLabel}]${handLabel} 分牌! ${splitRank}对拆开` +
              (isAces ? ' (分A只补一张)' : '')
            );

            if (isAces) {
              h.done = true;
              newHand.done = true;
            }

            refreshScreen();
            await sleep(600);
            break;
          } else {
            continue;
          }
        }

        if (action === 'stand') {
          gameState.message = `${npc.name} [${personalityLabel}]${handLabel} 停牌`;
          refreshScreen();
          await sleep(500);
          break;
        }
        if (action === 'hit') {
          const card = drawWithCount();
          h.hand.push(card);
          gameState.message = `${npc.name} [${personalityLabel}]${handLabel} 要牌: ${card.rank}${card.suit}`;
          if (isBust(h.hand)) {
            h.isBust = true;
            gameState.message = chalk.red(`💥 ${npc.name}${handLabel} BUST!`);
          }
          refreshScreen();
          await sleep(500);
          continue;
        }
        if (action === 'double') {
          if (h.hand.length === 2 && npc.chips >= h.bet) {
            npc.chips -= h.bet;
            h.bet *= 2;
            h.doubledDown = true;
            const card = drawWithCount();
            h.hand.push(card);
            gameState.message = chalk.magenta(`⬆ ${npc.name} [${personalityLabel}]${handLabel} 加倍至 $${h.bet}，得: ${card.rank}${card.suit}`);
            if (isBust(h.hand)) {
              h.isBust = true;
              gameState.message = chalk.red(`💥 ${npc.name}${handLabel} BUST!`);
            }
            refreshScreen();
            await sleep(600);
            break;
          } else {
            gameState.message = `${npc.name} [${personalityLabel}]${handLabel} 停牌`;
            refreshScreen();
            await sleep(400);
            break;
          }
        }
      }
    }
  }
  return true;
}

async function phaseDealerTurn() {
  gameState.phase = 'dealer_turn';
  gameState.dealerRevealed = true;
  gameState.dealer.hand[0].faceUp = true;

  const playerActive = gameState.player.hands.some(h => !h.folded && !h.isBust && !h.hasBlackjack);
  const npcActive = gameState.npcs.some(n =>
    n.hands.some(h => !h.folded && !h.isBust && !h.hasBlackjack)
  );
  const anyActive = playerActive || npcActive;

  refreshScreen();
  await sleep(500);

  if (isBlackjack(gameState.dealer.hand)) {
    gameState.message = chalk.yellow('💀 庄家 BLACKJACK!');
    refreshScreen();
    await sleep(1000);
    return true;
  }

  if (!anyActive && !isBlackjack(gameState.dealer.hand)) {
    gameState.message = '所有玩家爆牌或BJ，庄家无需补牌';
    refreshScreen();
    await sleep(500);
    return true;
  }

  let safety = 0;
  while (safety < 30) {
    safety++;
    const v = handValueAll(gameState.dealer.hand);
    if (v >= 17) break;

    const card = drawWithCount();
    gameState.dealer.hand.push(card);
    gameState.message = `庄家要牌: ${card.rank}${card.suit}`;
    if (isBust(gameState.dealer.hand)) {
      gameState.message = chalk.green('💥 庄家 BUST!');
    }
    refreshScreen();
    await sleep(600);
  }
  return true;
}

function settleHand(h, dealerValue, dealerBlackjack, dealerBust) {
  if (h.folded) return 0;

  const seatValue = handValueAll(h.hand);
  const seatBlackjack = isBlackjack(h.hand) && !h.fromSplit;
  const seatBust = isBust(h.hand);

  let profit = 0;

  if (seatBust) {
    profit = -h.bet;
  } else if (seatBlackjack && !dealerBlackjack) {
    profit = Math.floor(h.bet * 1.5);
  } else if (dealerBust) {
    profit = h.bet;
  } else if (seatBlackjack && dealerBlackjack) {
    profit = 0;
  } else if (seatValue > dealerValue) {
    profit = h.bet;
  } else if (seatValue < dealerValue) {
    profit = -h.bet;
  } else {
    profit = 0;
  }

  h.profit = profit;
  return profit;
}

async function phaseSettlement() {
  gameState.phase = 'settlement';

  const dealerValue = handValueAll(gameState.dealer.hand);
  const dealerBlackjack = isBlackjack(gameState.dealer.hand);
  const dealerBust = isBust(gameState.dealer.hand);

  const player = gameState.player;
  let totalPlayerProfit = 0;

  for (const h of player.hands) {
    totalPlayerProfit += settleHand(h, dealerValue, dealerBlackjack, dealerBust);
    player.chips += h.bet + (h.profit || 0);
  }

  gameState.playerProfit = totalPlayerProfit;
  gameState.saveData.chips = player.chips;

  for (const npc of gameState.npcs) {
    let totalNpcProfit = 0;
    for (const h of npc.hands) {
      totalNpcProfit += settleHand(h, dealerValue, dealerBlackjack, dealerBust);
      npc.chips += h.bet + (h.profit || 0);
    }
    npc.lastProfit = totalNpcProfit;
    if (npc.chips < MIN_BET) {
      npc.chips = 2000;
    }
  }

  if (totalPlayerProfit > 0) {
    gameState.playerResult = 'win';
    gameState.saveData.totalWins++;
    gameState.message = chalk.green(`🎉 你赢了 $${totalPlayerProfit}！`);
  } else if (totalPlayerProfit < 0) {
    gameState.playerResult = 'lose';
    gameState.message = chalk.red(`😢 你输了 $${Math.abs(totalPlayerProfit)}`);
  } else {
    gameState.playerResult = 'push';
    gameState.message = chalk.gray('⚖ 平局，退还本金');
  }

  const totalBet = player.hands.reduce((s, h) => s + h.bet, 0);
  addHistory(gameState.saveData, {
    profit: totalPlayerProfit,
    playerValue: player.hands.map(h => handValueAll(h.hand)).join('/'),
    dealerValue: dealerValue,
    bet: totalBet,
    result: gameState.playerResult,
    split: player.hasSplit
  });
  gameState.saveData.totalGames++;

  if (needsRepayment(gameState.saveData)) {
    gameState.message += chalk.bgYellow.black(` | ⚠ 需偿还高利贷 $${gameState.saveData.loanAmount}`);
  }

  refreshScreen();
  print(renderHistory(gameState.saveData.history));
  await sleep(800);

  if (needsRepayment(gameState.saveData)) {
    const ok = repayLoan(gameState.saveData);
    if (!ok) {
      gameState.saveData.chips = player.chips;
      saveSave(gameState.saveData);
      return triggerGameOver(`无法偿还高利贷 $${gameState.saveData.loanAmount}`);
    }
    player.chips = gameState.saveData.chips;
    gameState.message = chalk.green(`✅ 已偿还高利贷，剩余筹码: $${gameState.saveData.chips}`);
    refreshScreen();
    await sleep(1000);
  }

  saveSave(gameState.saveData);
  return true;
}

async function triggerGameOver(reason) {
  gameState.gameOver = true;
  clearScreen();
  print(chalk.bgRed.white.bold('\n' + '═'.repeat(50)));
  print(chalk.bgRed.white.bold('           GAME OVER - 游戏结束           '));
  print(chalk.bgRed.white.bold('═'.repeat(50) + '\n'));
  print(chalk.red(`  原因: ${reason}\n`));
  print(chalk.white(`  总局数: ${gameState.saveData.totalGames}`));
  print(chalk.white(`  总胜场: ${gameState.saveData.totalWins}`));
  if (gameState.saveData.totalGames > 0) {
    const rate = (gameState.saveData.totalWins / gameState.saveData.totalGames * 100).toFixed(1);
    print(chalk.white(`  胜率: ${rate}%`));
  }
  print(chalk.white(`  最终筹码: $${gameState.saveData.chips}\n`));
  print(renderHistory(gameState.saveData.history));
  print(chalk.gray('存档已保存。再见!'));
  saveSave(gameState.saveData);
  rl.close();
  process.exit(0);
  return 'gameover';
}

async function saveAndQuit() {
  saveSave(gameState.saveData);
  clearScreen();
  print(chalk.green('\n✅ 游戏已保存，下次再见!'));
  print(chalk.gray(`  当前筹码: $${gameState.saveData.chips}`));
  print(chalk.gray(`  总局数: ${gameState.saveData.totalGames} | 胜: ${gameState.saveData.totalWins}`));
  if (needsRepayment(gameState.saveData)) {
    print(chalk.red(`  ⚠ 高利贷欠款: $${gameState.saveData.loanAmount}`));
  }
  rl.close();
  process.exit(0);
}

async function gameLoop() {
  clearScreen();
  initShoe();

  if (gameState.saveData.chips < MIN_BET) {
    if (!canAffordLoan(gameState.saveData)) {
      gameState.player = { chips: gameState.saveData.chips, hands: [], bet: 0, lastProfit: 0 };
      await triggerGameOver('筹码不足且无借贷资格');
      return;
    }
  }

  while (true) {
    newRound();
    gameState.message = '欢迎来到 21 点!';
    refreshScreen();
    print(renderHistory(gameState.saveData.history));

    const steps = [
      phaseBetting, phaseDealing, phasePlayerTurn,
      phaseNPCTurn, phaseDealerTurn, phaseSettlement
    ];

    let cont = true;
    for (const step of steps) {
      cont = await step();
      if (cont === false || cont === 'gameover') break;
    }

    if (cont === 'gameover' || gameState.gameOver) break;
    if (cont === false) break;

    if (gameState.saveData.chips < MIN_BET) {
      if (!canAffordLoan(gameState.saveData)) {
        await triggerGameOver('筹码耗尽且无借贷资格');
        break;
      }
    }

    print('');
    const next = await prompt('按 Enter 开始下一局 (q 退出): ');
    if (next === 'q' || next === 'quit') {
      await saveAndQuit();
      break;
    }
  }
}

rl.on('SIGINT', () => {
  saveSave(gameState.saveData);
  clearScreen();
  print(chalk.yellow('\n⚠ 捕获 Ctrl+C，存档已保存。'));
  rl.close();
  process.exit(0);
});

gameLoop().catch(err => {
  console.error('游戏异常:', err);
  saveSave(gameState.saveData);
  rl.close();
  process.exit(1);
});
