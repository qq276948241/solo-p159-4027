const { handValueAll, isBlackjack, isBust } = require('./cards');

const MIN_BET = 10;
const MAX_BET = 500;

const NPC_PERSONALITIES = {
  AGGRESSIVE: 'aggressive',
  CONSERVATIVE: 'conservative',
  CARD_COUNTER: 'card_counter'
};

function createNPC(name, personality, chips) {
  return {
    name,
    personality,
    chips,
    hand: [],
    bet: 0,
    folded: false,
    doubledDown: false,
    isBust: false,
    hasBlackjack: false,
    wonLastRound: null,
    lastProfit: 0
  };
}

function decideBet(npc, dealerUpCard, runningCount, decksRemaining) {
  const personality = npc.personality;
  const minBet = MIN_BET;
  const maxBet = Math.min(MAX_BET, npc.chips);

  if (maxBet < minBet) return 0;

  switch (personality) {
    case NPC_PERSONALITIES.AGGRESSIVE: {
      const base = Math.min(maxBet, minBet * 3);
      const extra = Math.floor(Math.random() * Math.min(maxBet, minBet * 2));
      const bet = Math.min(maxBet, base + extra);
      return Math.max(minBet, bet);
    }

    case NPC_PERSONALITIES.CONSERVATIVE: {
      let bet = minBet;
      if (Math.random() < 0.3 && npc.chips >= minBet * 2) {
        bet = Math.min(maxBet, minBet * 2);
      }
      if (Math.random() < 0.15 && npc.chips < minBet * 5) {
        return 0;
      }
      return Math.max(minBet, Math.min(maxBet, bet));
    }

    case NPC_PERSONALITIES.CARD_COUNTER: {
      const trueCount = decksRemaining > 0 ? runningCount / decksRemaining : 0;
      let bet = minBet;
      if (trueCount >= 2) {
        bet = Math.min(maxBet, minBet * Math.floor(trueCount + 1));
      } else if (trueCount >= 1) {
        bet = Math.min(maxBet, minBet * 2);
      } else if (trueCount <= -2) {
        if (Math.random() < 0.4) return 0;
        bet = minBet;
      }
      return Math.max(minBet, Math.min(maxBet, bet));
    }

    default:
      return minBet;
  }
}

function decideAction(npc, dealerUpCard, runningCount, decksRemaining) {
  if (npc.folded || npc.isBust || npc.hasBlackjack || npc.doubledDown) {
    return 'stand';
  }

  const myValue = handValueAll(npc.hand);
  const dealerValue = dealerUpCard ? (dealerUpCard.rank === 'A' ? 11 :
    ['J', 'Q', 'K'].includes(dealerUpCard.rank) ? 10 : parseInt(dealerUpCard.rank, 10)) : 0;

  switch (npc.personality) {
    case NPC_PERSONALITIES.AGGRESSIVE: {
      if (myValue <= 11) return 'hit';
      if (myValue === 12 && dealerValue >= 2 && dealerValue <= 3) return 'hit';
      if (myValue >= 13 && myValue <= 16 && dealerValue >= 7) return 'hit';
      if (myValue <= 16 && Math.random() < 0.35) return 'hit';
      if (npc.hand.length === 2 && myValue >= 9 && myValue <= 11 && npc.chips >= npc.bet) {
        return 'double';
      }
      if (myValue >= 21) return 'stand';
      return 'stand';
    }

    case NPC_PERSONALITIES.CONSERVATIVE: {
      if (myValue <= 8) return 'hit';
      if (myValue === 9 && dealerValue >= 3 && dealerValue <= 6) return 'hit';
      if (myValue >= 10 && myValue <= 11 && dealerValue <= 9) return 'hit';
      if (myValue === 12 && dealerValue >= 4 && dealerValue <= 6) return 'stand';
      if (myValue === 12) return 'hit';
      if (myValue >= 13 && myValue <= 16 && dealerValue >= 2 && dealerValue <= 6) return 'stand';
      if (myValue >= 17) return 'stand';
      if (Math.random() < 0.2) return 'stand';
      return 'hit';
    }

    case NPC_PERSONALITIES.CARD_COUNTER: {
      const trueCount = decksRemaining > 0 ? runningCount / decksRemaining : 0;
      const hasAce = npc.hand.some(c => c.rank === 'A');
      const totalCards = npc.hand.length;
      const isSoft = hasAce && npc.hand.reduce((s, c) => {
        if (c.rank === 'A') return s + 11;
        if (['J','Q','K'].includes(c.rank)) return s + 10;
        return s + parseInt(c.rank, 10);
      }, 0) === myValue;

      if (totalCards === 2) {
        if (isSoft) {
          if (myValue === 18) {
            if (dealerValue >= 3 && dealerValue <= 6 && npc.chips >= npc.bet) return 'double';
            if (dealerValue === 2 || dealerValue === 7 || dealerValue === 8) return 'stand';
            return 'hit';
          }
          if (myValue === 17 && dealerValue >= 3 && dealerValue <= 6 && npc.chips >= npc.bet) return 'double';
          if (myValue >= 15 && myValue <= 16 && dealerValue >= 4 && dealerValue <= 6 && npc.chips >= npc.bet) return 'double';
          if (myValue === 19 && dealerValue === 6 && trueCount >= 1 && npc.chips >= npc.bet) return 'double';
          if (myValue <= 17) return 'hit';
          if (myValue >= 19) return 'stand';
        }
        if (myValue === 11 && npc.chips >= npc.bet) return 'double';
        if (myValue === 10 && dealerValue <= 9 && npc.chips >= npc.bet) return 'double';
        if (myValue === 9 && dealerValue >= 3 && dealerValue <= 6 && npc.chips >= npc.bet) return 'double';
      }

      if (isSoft) {
        if (myValue >= 19) return 'stand';
        if (myValue === 18 && dealerValue >= 2 && dealerValue <= 8) return 'stand';
        return 'hit';
      }

      if (myValue === 16 && dealerValue >= 9 && trueCount >= 1) return 'stand';
      if (myValue === 15 && dealerValue === 10 && trueCount >= 2) return 'stand';
      if (myValue === 12 && dealerValue >= 2 && dealerValue <= 3 && trueCount >= 2) return 'stand';
      if (myValue === 12 && dealerValue === 4 && trueCount >= 0) return 'stand';
      if (myValue === 12 && dealerValue >= 5 && dealerValue <= 6) return 'stand';
      if (myValue >= 13 && myValue <= 16 && dealerValue >= 2 && dealerValue <= 6) return 'stand';
      if (myValue <= 11) return 'hit';
      if (myValue >= 17) return 'stand';
      if (dealerValue >= 7) return 'hit';
      return 'stand';
    }

    default:
      return myValue < 17 ? 'hit' : 'stand';
  }
}

function getPersonalityLabel(personality) {
  switch (personality) {
    case NPC_PERSONALITIES.AGGRESSIVE: return '激进';
    case NPC_PERSONALITIES.CONSERVATIVE: return '保守';
    case NPC_PERSONALITIES.CARD_COUNTER: return '记牌';
    default: return '普通';
  }
}

function getPersonalityEmoji(personality) {
  switch (personality) {
    case NPC_PERSONALITIES.AGGRESSIVE: return '🔥';
    case NPC_PERSONALITIES.CONSERVATIVE: return '🛡️';
    case NPC_PERSONALITIES.CARD_COUNTER: return '🧠';
    default: return '🎭';
  }
}

module.exports = {
  NPC_PERSONALITIES,
  MIN_BET,
  MAX_BET,
  createNPC,
  decideBet,
  decideAction,
  getPersonalityLabel,
  getPersonalityEmoji
};
