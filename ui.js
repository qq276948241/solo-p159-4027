const chalk = require('chalk');
const { handValue, handValueAll, isBlackjack, isBust, SUIT_COLORS } = require('./cards');
const { getPersonalityLabel, getPersonalityEmoji } = require('./npcs');
const { getLoanInfo } = require('./storage');

const CARD_WIDTH = 7;
const CARD_HEIGHT = 5;

function colorCard(str, suit) {
  const color = SUIT_COLORS[suit];
  if (color === 'red') return chalk.red(str);
  return chalk.white(str);
}

function renderCardLine(card, lineIdx) {
  if (!card) return ' '.repeat(CARD_WIDTH);
  if (!card.faceUp) {
    switch (lineIdx) {
      case 0: return chalk.bgBlue.white('┌─────┐');
      case 1: return chalk.bgBlue.white('│░░░░░│');
      case 2: return chalk.bgBlue.white('│░♠♥░│');
      case 3: return chalk.bgBlue.white('│░░░░░│');
      case 4: return chalk.bgBlue.white('└─────┘');
      default: return ' '.repeat(CARD_WIDTH);
    }
  }

  const rank = card.rank.length === 2 ? card.rank : card.rank + ' ';
  const suit = card.suit;
  const rankEnd = card.rank.length === 2 ? card.rank : ' ' + card.rank;

  const bg = chalk.bgWhite;
  switch (lineIdx) {
    case 0:
      return bg(colorCard(`┌─────┐`, suit));
    case 1:
      return bg(colorCard(`│${rank}   │`, suit).replace(suit, colorCard(suit, suit)));
    case 2:
      return bg(colorCard(`│  ${suit}  │`, suit).replace(suit, colorCard(suit, suit)));
    case 3:
      return bg(colorCard(`│   ${rankEnd}│`, suit).replace(suit, colorCard(suit, suit)));
    case 4:
      return bg(colorCard(`└─────┘`, suit));
    default:
      return ' '.repeat(CARD_WIDTH);
  }
}

function renderHand(hand, hiddenFirst = false) {
  const lines = [];
  for (let l = 0; l < CARD_HEIGHT; l++) {
    let line = '';
    for (let i = 0; i < hand.length; i++) {
      const card = hand[i];
      if (hiddenFirst && i === 0) {
        line += renderCardLine({ ...card, faceUp: false }, l);
      } else {
        line += renderCardLine(card, l);
      }
      if (i < hand.length - 1) line += ' ';
    }
    lines.push(line);
  }
  return lines;
}

function renderHeader() {
  const title = '♠♥ BLACKJACK 21 ♣♦';
  const border = '═'.repeat(title.length + 8);
  return [
    chalk.yellow(bold(border)),
    chalk.yellow(bold(`  ${title}  `)),
    chalk.yellow(bold(border))
  ].join('\n');
}

function bold(str) {
  return '\x1b[1m' + str + '\x1b[22m';
}

function renderDealer(dealer) {
  const handLines = renderHand(dealer.hand, true);
  const visibleValue = handValue(dealer.hand.slice(1));
  const fullValue = handValueAll(dealer.hand);

  let header = chalk.cyan(bold('庄家 (Dealer)'));
  if (dealer.hand.length > 2) {
    header += '  ' + chalk.gray(`[点数: ${visibleValue}+?]`);
  } else {
    header += '  ' + chalk.gray(`[点数: ${visibleValue}+?]`);
  }
  if (dealer.revealed) {
    if (isBlackjack(dealer.hand)) header += '  ' + chalk.bgYellow.black(' BLACKJACK ');
    else if (isBust(dealer.hand)) header += '  ' + chalk.bgRed.white(' BUST ');
    else header += '  ' + chalk.gray(`[实际: ${fullValue}]`);
  }

  return [header, ...handLines].join('\n');
}

function renderPlayerSeat(seat, isPlayer = false) {
  const handLines = renderHand(seat.hand);
  const value = handValueAll(seat.hand);

  let statusTags = [];
  if (seat.folded) statusTags.push(chalk.gray('[弃牌]'));
  if (isBlackjack(seat.hand)) statusTags.push(chalk.bgYellow.black(' BLACKJACK '));
  else if (isBust(seat.hand)) statusTags.push(chalk.bgRed.white(' BUST '));
  if (seat.doubledDown) statusTags.push(chalk.magenta('[双倍]'));

  let header = '';
  if (isPlayer) {
    header = chalk.green(bold(`你 (Player)`)) + ' ' + chalk.green(`💰${seat.chips}`);
  } else {
    const emoji = getPersonalityEmoji(seat.personality);
    const label = getPersonalityLabel(seat.personality);
    header = chalk.blue(bold(`${emoji} ${seat.name}`)) +
      chalk.gray(` [${label}]`) + ' ' + chalk.green(`💰${seat.chips}`);
  }

  header += '  ' + chalk.yellow(bold(`下注: $${seat.bet}`));

  if (!seat.folded) {
    header += '  ' + chalk.white(`[点数: ${value}]`);
  }

  if (statusTags.length > 0) {
    header += '  ' + statusTags.join(' ');
  }

  if (seat.lastProfit !== undefined && seat.lastProfit !== null) {
    const profit = seat.lastProfit;
    if (profit > 0) header += '  ' + chalk.green(`▲+$${profit}`);
    else if (profit < 0) header += '  ' + chalk.red(`▼$${profit}`);
  }

  return [header, ...handLines].join('\n');
}

function renderTable(player, npcs, dealer, saveData) {
  const output = [];

  output.push(renderHeader());
  output.push('');

  const loanInfo = getLoanInfo();
  if (saveData.loanTaken) {
    output.push(
      chalk.bgRed.white(bold(` ⚠ 高利贷欠款: $${saveData.loanAmount} | 本局结束必须偿还，否则 GAME OVER `))
    );
    output.push('');
  }

  output.push(renderDealer(dealer));
  output.push('');
  output.push(chalk.gray('─'.repeat(60)));
  output.push('');

  for (let i = 0; i < npcs.length; i++) {
    output.push(renderPlayerSeat(npcs[i], false));
    output.push('');
  }

  output.push(chalk.green('─'.repeat(60)));
  output.push(renderPlayerSeat(player, true));

  return output.join('\n');
}

function renderStatusBar(message, phase, deckCount, runningCount) {
  const bar = [];
  if (phase) bar.push(chalk.cyan(`[${phase}]`));
  if (deckCount !== undefined) bar.push(chalk.gray(`剩余牌: ${deckCount}`));
  if (message) bar.push(message);
  return bar.join('  ');
}

function renderHelp() {
  const lines = [];
  lines.push(chalk.yellow(bold('\n═══ 游戏帮助 ═══')));
  lines.push(chalk.white('  h / help    - 显示此帮助菜单'));
  lines.push(chalk.white('  q / quit    - 保存并退出游戏'));
  lines.push('');
  lines.push(chalk.cyan(bold('  —— 操作指令 ——')));
  lines.push(chalk.white('  h / hit     - 要牌 (Hit)'));
  lines.push(chalk.white('  s / stand   - 停牌 (Stand)'));
  lines.push(chalk.white('  d / double  - 加倍下注 (Double)'));
  lines.push(chalk.white('  p / split   - 分牌 (Split, 暂不支持)'));
  lines.push(chalk.white('  i / insure  - 保险 (Insurance, 暂不支持)'));
  lines.push('');
  lines.push(chalk.cyan(bold('  —— NPC 性格 ——')));
  lines.push(chalk.white('  🔥 激进 - 爱加注，风险偏好高'));
  lines.push(chalk.white('  🛡️ 保守 - 弃牌多，稳扎稳打'));
  lines.push(chalk.white('  🧠 记牌 - 使用 Hi-Lo 算牌系统'));
  lines.push('');
  lines.push(chalk.cyan(bold('  —— 筹码规则 ——')));
  lines.push(chalk.white(`  最低下注: $10 | 最高下注: $500`));
  lines.push(chalk.white(`  高利贷: 借 $${getLoanInfo().amount} 还 $${getLoanInfo().repayAmount} (仅限一次)`));
  lines.push(chalk.white('  输光且无法还债 = GAME OVER'));
  lines.push('');
  lines.push(chalk.cyan(bold('  —— 胜负规则 ——')));
  lines.push(chalk.white('  21点 (Blackjack): 1.5倍赔率'));
  lines.push(chalk.white('  普通赢: 1倍赔率'));
  lines.push(chalk.white('  平局: 退还本金'));
  lines.push(chalk.yellow(bold('═══════════════\n')));
  return lines.join('\n');
}

function renderHistory(history) {
  if (history.length === 0) {
    return chalk.gray('  (暂无战绩记录)\n');
  }
  const lines = [];
  lines.push(chalk.yellow(bold('\n═══ 最近10局战绩 ═══')));
  history.slice().reverse().forEach((h, idx) => {
    const num = history.length - idx;
    const profit = h.profit;
    const mark = profit > 0 ? chalk.green('▲赢') : profit < 0 ? chalk.red('▼输') : chalk.gray('━平');
    const profitStr = profit > 0 ? chalk.green(`+$${profit}`) : profit < 0 ? chalk.red(`$${profit}`) : chalk.gray('$0');
    const date = new Date(h.timestamp);
    const ts = `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    lines.push(chalk.white(`  #${num} [${ts}] ${mark} ${profitStr}  玩家:${h.playerValue}  庄家:${h.dealerValue}  下注:$${h.bet}`));
  });
  lines.push(chalk.yellow(bold('═══════════════════\n')));
  return lines.join('\n');
}

function clearScreen() {
  process.stdout.write('\x1Bc');
  process.stdout.write('\x1B[2J\x1B[0f');
}

function print(str) {
  process.stdout.write(str + '\n');
}

module.exports = {
  renderHeader,
  renderDealer,
  renderPlayerSeat,
  renderTable,
  renderStatusBar,
  renderHelp,
  renderHistory,
  clearScreen,
  print
};
