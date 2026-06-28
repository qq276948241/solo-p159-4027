const SUITS = ['♠', '♥', '♦', '♣'];
const SUIT_COLORS = {
  '♠': 'black',
  '♥': 'red',
  '♦': 'red',
  '♣': 'black'
};
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function createDeck(decks = 6) {
  const deck = [];
  for (let d = 0; d < decks; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({ suit, rank, faceUp: true });
      }
    }
  }
  return deck;
}

function shuffle(deck) {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function drawCard(deck) {
  if (deck.length < 1) {
    return null;
  }
  return deck.shift();
}

function cardValue(card) {
  const rank = card.rank;
  if (rank === 'A') return 11;
  if (['J', 'Q', 'K'].includes(rank)) return 10;
  return parseInt(rank, 10);
}

function handValue(hand) {
  let value = 0;
  let aces = 0;
  for (const card of hand) {
    if (!card.faceUp) continue;
    value += cardValue(card);
    if (card.rank === 'A') aces++;
  }
  while (value > 21 && aces > 0) {
    value -= 10;
    aces--;
  }
  return value;
}

function handValueAll(hand) {
  let value = 0;
  let aces = 0;
  for (const card of hand) {
    value += cardValue(card);
    if (card.rank === 'A') aces++;
  }
  while (value > 21 && aces > 0) {
    value -= 10;
    aces--;
  }
  return value;
}

function isBlackjack(hand) {
  if (hand.length !== 2) return false;
  return handValueAll(hand) === 21;
}

function isBust(hand) {
  return handValueAll(hand) > 21;
}

function getHiLoCount(card) {
  if (!card.faceUp) return 0;
  const rank = card.rank;
  if (['2', '3', '4', '5', '6'].includes(rank)) return 1;
  if (['7', '8', '9'].includes(rank)) return 0;
  return -1;
}

module.exports = {
  SUITS,
  SUIT_COLORS,
  RANKS,
  createDeck,
  shuffle,
  drawCard,
  cardValue,
  handValue,
  handValueAll,
  isBlackjack,
  isBust,
  getHiLoCount
};
