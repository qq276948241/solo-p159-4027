const fs = require('fs');
const path = require('path');

const SAVE_FILE = path.join(__dirname, 'save_data.json');
const MAX_HISTORY = 10;
const LOAN_AMOUNT = 500;
const LOAN_REPAY_MULTIPLIER = 2;

const DEFAULT_SAVE = {
  chips: 1000,
  loanTaken: false,
  loanAmount: 0,
  history: [],
  totalGames: 0,
  totalWins: 0
};

function loadSave() {
  try {
    if (!fs.existsSync(SAVE_FILE)) {
      return { ...DEFAULT_SAVE };
    }
    const raw = fs.readFileSync(SAVE_FILE, 'utf-8');
    const data = JSON.parse(raw);
    return {
      chips: typeof data.chips === 'number' ? data.chips : DEFAULT_SAVE.chips,
      loanTaken: !!data.loanTaken,
      loanAmount: typeof data.loanAmount === 'number' ? data.loanAmount : 0,
      history: Array.isArray(data.history) ? data.history.slice(0, MAX_HISTORY) : [],
      totalGames: typeof data.totalGames === 'number' ? data.totalGames : 0,
      totalWins: typeof data.totalWins === 'number' ? data.totalWins : 0
    };
  } catch (e) {
    return { ...DEFAULT_SAVE };
  }
}

function saveSave(data) {
  try {
    const toSave = {
      chips: data.chips,
      loanTaken: data.loanTaken,
      loanAmount: data.loanAmount,
      history: data.history.slice(-MAX_HISTORY),
      totalGames: data.totalGames,
      totalWins: data.totalWins
    };
    fs.writeFileSync(SAVE_FILE, JSON.stringify(toSave, null, 2), 'utf-8');
    return true;
  } catch (e) {
    return false;
  }
}

function addHistory(data, record) {
  const newRecord = {
    timestamp: new Date().toISOString(),
    ...record
  };
  data.history = [...data.history, newRecord].slice(-MAX_HISTORY);
  return data;
}

function takeLoan(data) {
  if (data.loanTaken) return null;
  data.loanTaken = true;
  data.loanAmount = Math.floor(LOAN_AMOUNT * LOAN_REPAY_MULTIPLIER);
  data.chips += LOAN_AMOUNT;
  return LOAN_AMOUNT;
}

function repayLoan(data) {
  if (!data.loanTaken) return false;
  if (data.chips < data.loanAmount) return false;
  data.chips -= data.loanAmount;
  data.loanTaken = false;
  data.loanAmount = 0;
  return true;
}

function canAffordLoan(data) {
  return !data.loanTaken;
}

function needsRepayment(data) {
  return data.loanTaken && data.loanAmount > 0;
}

function getLoanInfo() {
  return {
    amount: LOAN_AMOUNT,
    repayAmount: Math.floor(LOAN_AMOUNT * LOAN_REPAY_MULTIPLIER),
    multiplier: LOAN_REPAY_MULTIPLIER
  };
}

module.exports = {
  SAVE_FILE,
  MAX_HISTORY,
  DEFAULT_SAVE,
  loadSave,
  saveSave,
  addHistory,
  takeLoan,
  repayLoan,
  canAffordLoan,
  needsRepayment,
  getLoanInfo
};
