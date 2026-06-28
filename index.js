const readline = require('readline');
const chalk = require('chalk');
const {
  NPC_PERSONALITIES, MIN_BET, MAX_BET,
  createNPC, decideBet
} = require('./npcs');
const {
  loadSave, saveSave, addHistory, takeLoan,
  repayLoan, canAffordLoan, needsRepayment
} = require('./storage');
const {
  createGameContext, runRound
} = require('./game');
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

let gameState = {
  ctx: null,
  saveData: loadSave(),
  player: null,
  npcs: [],
  dealer: null,
  phase: 'idle',
  message: '',
  gameOver: false,
  activeHandIdx: -1
};

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
  const dealerForRender = gameState.dealer
    ? { ...gameState.dealer }
    : { hand: [], revealed: false };
  print(renderTable(
    gameState.player, gameState.npcs, dealerForRender,
    gameState.saveData, gameState.activeHandIdx
  ));
  print('');
  print(renderStatusBar(
    gameState.message,
    getPhaseLabel(),
    gameState.ctx ? gameState.ctx.deck.length : 0,
    gameState.ctx ? gameState.ctx.runningCount : 0
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

function makeCallbacks() {
  return {
    onPhase(phase) { gameState.phase = phase; },
    onMessage(msg) { gameState.message = msg; },
    onRequestRefresh() { refreshScreen(); },
    setActiveHand(idx) { gameState.activeHandIdx = idx; },
    revealDealer() { if (gameState.dealer) gameState.dealer.revealed = true; },
    bindDealer(d) { gameState.dealer = d; },
    updatePlayerChips(chips) {
      gameState.saveData.chips = chips;
    },
    askPlayer: prompt,
    showHelp() { print(renderHelp()); },
    sleep
  };
}

async function phaseBetting() {
  gameState.phase = 'betting';
  gameState.message = '请下注，输入 0 进入借贷选项';

  const player = gameState.player;
  const canLoan = canAffordLoan(gameState.saveData);

  for (const npc of gameState.npcs) {
    const dealerCard = gameState.ctx.deck[0] || null;
    const npcBet = decideBet(npc, dealerCard, gameState.ctx.runningCount, gameState.ctx.decksRemaining);
    npc.bet = npcBet;
    if (npcBet > 0) {
      npc.chips -= npcBet;
    } else {
      npc.folded = true;
    }
  }

  refreshScreen();

  while (true) {
    let extraHint = '';
    if (player.chips < MIN_BET && canLoan) {
      extraHint = chalk.red(` (筹码不足! 可借高利贷)`);
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
      if (loanResult === 'gameover') return false;
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

  refreshScreen();
  const { amount, repayAmount, multiplier } = require('./storage').getLoanInfo();
  print(chalk.bgYellow.black(
    `\n  ⚠ 高利贷警告 ⚠ 借 $${amount}，下局需还 $${repayAmount}（${multiplier}倍）\n`
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

function newRound() {
  if (gameState.ctx.needsReshuffle()) {
    gameState.ctx.initShoe();
    gameState.message = '🔄 牌堆已重新洗牌';
  }

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

  gameState.dealer = { hand: [], revealed: false };
  gameState.activeHandIdx = -1;
}

async function phaseSettlement(result) {
  gameState.phase = 'settlement';
  gameState.saveData.chips = gameState.player.chips;

  let resultLabel;
  if (result.totalPlayerProfit > 0) {
    resultLabel = 'win';
    gameState.saveData.totalWins++;
    gameState.message = chalk.green(`🎉 你赢了 $${result.totalPlayerProfit}！`);
  } else if (result.totalPlayerProfit < 0) {
    resultLabel = 'lose';
    gameState.message = chalk.red(`😢 你输了 $${Math.abs(result.totalPlayerProfit)}`);
  } else {
    resultLabel = 'push';
    gameState.message = chalk.gray('⚖ 平局，退还本金');
  }

  addHistory(gameState.saveData, {
    profit: result.totalPlayerProfit,
    playerValue: result.playerValue,
    dealerValue: result.dealerValue,
    bet: result.totalBet,
    result: resultLabel,
    split: result.didSplit
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
      saveSave(gameState.saveData);
      return triggerGameOver(`无法偿还高利贷 $${gameState.saveData.loanAmount}`);
    }
    gameState.player.chips = gameState.saveData.chips;
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
  gameState.ctx = createGameContext();

  if (gameState.saveData.chips < MIN_BET && !canAffordLoan(gameState.saveData)) {
    gameState.player = { chips: gameState.saveData.chips, hands: [], bet: 0, lastProfit: 0 };
    await triggerGameOver('筹码不足且无借贷资格');
    return;
  }

  while (true) {
    newRound();
    gameState.message = '欢迎来到 21 点!';
    refreshScreen();
    print(renderHistory(gameState.saveData.history));

    const betOk = await phaseBetting();
    if (betOk === false) break;
    if (betOk === 'gameover') break;

    const cb = makeCallbacks();
    const roundResult = await runRound(gameState.ctx, {
      player: gameState.player,
      npcs: gameState.npcs,
      callbacks: cb
    });

    if (roundResult.quit) {
      await saveAndQuit();
      break;
    }

    const settleResult = await phaseSettlement(roundResult);
    if (settleResult === 'gameover') break;

    if (gameState.saveData.chips < MIN_BET && !canAffordLoan(gameState.saveData)) {
      await triggerGameOver('筹码耗尽且无借贷资格');
      break;
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
