const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'darkwin_secret_2026';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'darkwin_admin_2026';

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) { console.log('mkdir err:', e.message); }
}

const loadData = (f) => {
  const p = path.join(DATA_DIR, f + '.json');
  if (!fs.existsSync(p)) return [];
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return []; }
};
const saveData = (f, d) => {
  try { fs.writeFileSync(path.join(DATA_DIR, f + '.json'), JSON.stringify(d, null, 2)); }
  catch (e) { console.log('save err:', e.message); }
};
const hashPwd = (p) => crypto.createHash('sha256').update(p + JWT_SECRET).digest('hex');
const genId = (p = '') => p + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
const genUID = () => 'DW' + Date.now().toString().slice(-8);
const genInvite = () => crypto.randomBytes(4).toString('hex').toUpperCase();

function initData() {
  if (!fs.existsSync(path.join(DATA_DIR, 'banners.json'))) {
    saveData('banners', [
      { id: genId('bn_'), title: 'Welcome', imageUrl: 'https://i.ibb.co/hxyMYWyt/file-00000000192c8211bf1bcf496522a496.png', type: 'popup', position: 0, isActive: true, createdAt: new Date().toISOString() },
      { id: genId('bn_'), title: 'Home', imageUrl: 'https://i.ibb.co/8DXd4d5D/file-00000000e284820bb3bcdcdc7654f7e9.png', type: 'home', position: 0, isActive: true, createdAt: new Date().toISOString() }
    ]);
  }
  ['users','transactions','bets','giftcodes','gameresults'].forEach(f => {
    if (!fs.existsSync(path.join(DATA_DIR, f + '.json'))) saveData(f, []);
  });
  if (loadData('giftcodes').length === 0) {
    saveData('giftcodes', [
      { id: genId('gc_'), code: 'DARKWIN600', amount: 600, maxUses: 100, usedCount: 0, usedBy: [], isActive: true, createdAt: new Date().toISOString() },
      { id: genId('gc_'), code: 'WELCOME100', amount: 100, maxUses: 100, usedCount: 0, usedBy: [], isActive: true, createdAt: new Date().toISOString() }
    ]);
  }
  console.log('✅ Data ready');
}
initData();

function auth(req, res, next) {
  const t = req.headers.authorization?.split(' ')[1];
  if (!t) return res.status(401).json({ success: false, message: 'No token' });
  try { req.user = jwt.verify(t, JWT_SECRET); next(); }
  catch { res.status(401).json({ success: false, message: 'Invalid token' }); }
}
function adminAuth(req, res, next) {
  if (req.headers['x-admin-key'] !== ADMIN_SECRET) return res.status(403).json({ success: false, message: 'Admin denied' });
  next();
}

app.get('/', (req, res) => res.json({ success: true, message: '🚀 DARKWIN API running', version: '2.0.0' }));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// AUTH
app.post('/api/auth/register', (req, res) => {
  const { phone, password, inviteCode } = req.body;
  if (!phone || !password) return res.status(400).json({ success: false, message: 'Phone & password required' });
  if (phone.length < 10) return res.status(400).json({ success: false, message: 'Invalid phone' });
  const users = loadData('users');
  if (users.find(u => u.phone === phone)) return res.status(400).json({ success: false, message: 'Phone already registered' });
  const user = {
    uid: genUID(), phone, password: hashPwd(password),
    inviteCode: genInvite(), invitedBy: inviteCode || null,
    balance: 0, totalDeposit: 0, totalWithdraw: 0, totalBet: 0, totalWin: 0,
    vipLevel: 0, isBanned: false, bankDetails: null, upiDetails: null,
    lastLogin: new Date().toISOString(), createdAt: new Date().toISOString()
  };
  users.push(user);
  saveData('users', users);
  const token = jwt.sign({ uid: user.uid, phone }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ success: true, message: 'Registered', token, user: { uid: user.uid, phone, balance: 0, inviteCode: user.inviteCode, vipLevel: 0 } });
});

app.post('/api/auth/login', (req, res) => {
  const { phone, password } = req.body;
  const users = loadData('users');
  const user = users.find(u => u.phone === phone);
  if (!user) return res.status(400).json({ success: false, message: 'User not found' });
  if (user.isBanned) return res.status(403).json({ success: false, message: 'Account banned' });
  if (user.password !== hashPwd(password)) return res.status(400).json({ success: false, message: 'Wrong password' });
  user.lastLogin = new Date().toISOString();
  saveData('users', users);
  const token = jwt.sign({ uid: user.uid, phone }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ success: true, message: 'Login successful', token, user: { uid: user.uid, phone, balance: user.balance, inviteCode: user.inviteCode, vipLevel: user.vipLevel, totalDeposit: user.totalDeposit, totalBet: user.totalBet } });
});

app.get('/api/auth/me', auth, (req, res) => {
  const u = loadData('users').find(x => x.uid === req.user.uid);
  if (!u) return res.status(404).json({ success: false, message: 'User not found' });
  const { password, ...safe } = u;
  res.json({ success: true, user: safe });
});

// USER
app.get('/api/user/balance', auth, (req, res) => {
  const u = loadData('users').find(x => x.uid === req.user.uid);
  if (!u) return res.status(404).json({ success: false, message: 'User not found' });
  res.json({ success: true, balance: u.balance, totalDeposit: u.totalDeposit, totalWithdraw: u.totalWithdraw, totalBet: u.totalBet, totalWin: u.totalWin, vipLevel: u.vipLevel });
});

app.post('/api/user/bank', auth, (req, res) => {
  const users = loadData('users');
  const i = users.findIndex(u => u.uid === req.user.uid);
  if (i === -1) return res.status(404).json({ success: false, message: 'User not found' });
  users[i].bankDetails = req.body;
  saveData('users', users);
  res.json({ success: true, message: 'Bank saved' });
});

app.post('/api/user/upi', auth, (req, res) => {
  const users = loadData('users');
  const i = users.findIndex(u => u.uid === req.user.uid);
  if (i === -1) return res.status(404).json({ success: false, message: 'User not found' });
  users[i].upiDetails = req.body;
  saveData('users', users);
  res.json({ success: true, message: 'UPI saved' });
});

// DEPOSIT
app.post('/api/deposit/create', auth, (req, res) => {
  const { amount, utr, method } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ success: false, message: 'Invalid amount' });
  if (!utr || utr.length < 12) return res.status(400).json({ success: false, message: 'Valid UTR required' });
  const txns = loadData('transactions');
  const txn = { id: genId('txn_'), uid: req.user.uid, type: 'deposit', amount: Number(amount), utr, method: method || 'UPI-QR', status: 'pending', details: {}, createdAt: new Date().toISOString() };
  txns.push(txn);
  saveData('transactions', txns);
  res.json({ success: true, message: 'Deposit submitted', transaction: txn });
});

app.get('/api/deposit/history', auth, (req, res) => {
  const txns = loadData('transactions').filter(t => t.uid === req.user.uid && t.type === 'deposit').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 50);
  res.json({ success: true, transactions: txns });
});

// WITHDRAW
app.post('/api/withdraw/create', auth, (req, res) => {
  const { amount, method, password } = req.body;
  const users = loadData('users');
  const i = users.findIndex(u => u.uid === req.user.uid);
  if (i === -1) return res.status(404).json({ success: false, message: 'User not found' });
  const user = users[i];
  if (user.password !== hashPwd(password)) return res.status(400).json({ success: false, message: 'Wrong password' });
  if (amount < 100) return res.status(400).json({ success: false, message: 'Min ₹100' });
  if (user.balance < amount) return res.status(400).json({ success: false, message: 'Insufficient balance' });
  if (method === 'bank' && !user.bankDetails) return res.status(400).json({ success: false, message: 'Save bank first' });
  if (method === 'upi' && !user.upiDetails) return res.status(400).json({ success: false, message: 'Save UPI first' });
  users[i].balance -= Number(amount);
  users[i].totalWithdraw = (users[i].totalWithdraw || 0) + Number(amount);
  saveData('users', users);
  const txns = loadData('transactions');
  const txn = { id: genId('txn_'), uid: user.uid, type: 'withdraw', amount: Number(amount), method, status: 'processing', details: method === 'bank' ? user.bankDetails : user.upiDetails, createdAt: new Date().toISOString() };
  txns.push(txn);
  saveData('transactions', txns);
  res.json({ success: true, message: 'Withdraw submitted', newBalance: users[i].balance, transaction: txn });
});

app.get('/api/withdraw/history', auth, (req, res) => {
  const txns = loadData('transactions').filter(t => t.uid === req.user.uid && t.type === 'withdraw').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 50);
  res.json({ success: true, transactions: txns });
});

// GIFT
app.post('/api/gift/redeem', auth, (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ success: false, message: 'Enter code' });
  const gifts = loadData('giftcodes');
  const i = gifts.findIndex(g => g.code === code.toUpperCase() && g.isActive);
  if (i === -1) return res.status(400).json({ success: false, message: 'Code Expired!' });
  if (gifts[i].usedCount >= gifts[i].maxUses) return res.status(400).json({ success: false, message: 'Code Expired!' });
  if (gifts[i].usedBy.includes(req.user.uid)) return res.status(400).json({ success: false, message: 'Already used' });
  const users = loadData('users');
  const ui = users.findIndex(u => u.uid === req.user.uid);
  if (ui === -1) return res.status(404).json({ success: false, message: 'User not found' });
  users[ui].balance += gifts[i].amount;
  saveData('users', users);
  gifts[i].usedCount += 1;
  gifts[i].usedBy.push(req.user.uid);
  saveData('giftcodes', gifts);
  const txns = loadData('transactions');
  txns.push({ id: genId('txn_'), uid: req.user.uid, type: 'gift', amount: gifts[i].amount, status: 'success', createdAt: new Date().toISOString() });
  saveData('transactions', txns);
  res.json({ success: true, message: `Received ₹${gifts[i].amount}!`, amount: gifts[i].amount, newBalance: users[ui].balance });
});

// WINGO
app.post('/api/wingo/bet', auth, (req, res) => {
  const { period, gameMode, betType, betValue, amount } = req.body;
  if (!period || !gameMode || !betType || !amount) return res.status(400).json({ success: false, message: 'Missing fields' });
  const users = loadData('users');
  const i = users.findIndex(u => u.uid === req.user.uid);
  if (i === -1) return res.status(404).json({ success: false, message: 'User not found' });
  if (users[i].balance < amount) return res.status(400).json({ success: false, message: 'Insufficient balance' });
  users[i].balance -= Number(amount);
  users[i].totalBet = (users[i].totalBet || 0) + Number(amount);
  saveData('users', users);
  const bets = loadData('bets');
  const bet = { id: genId('bet_'), uid: users[i].uid, period, gameMode, betType, betValue: betValue !== null && betValue !== undefined ? betValue : null, amount: Number(amount), payout: 0, result: 'pending', createdAt: new Date().toISOString() };
  bets.push(bet);
  saveData('bets', bets);
  res.json({ success: true, message: `Bet ₹${amount} placed`, newBalance: users[i].balance });
});

app.get('/api/wingo/history', auth, (req, res) => {
  const bets = loadData('bets').filter(b => b.uid === req.user.uid).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 50);
  res.json({ success: true, bets });
});

app.get('/api/wingo/periods', (req, res) => {
  const r = loadData('gameresults').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 20);
  if (r.length === 0) {
    const demo = [];
    for (let i = 0; i < 10; i++) {
      const n = Math.floor(Math.random() * 10);
      const color = n === 0 ? ['violet','red'] : n === 5 ? ['violet','green'] : [1,3,7,9].includes(n) ? ['green'] : ['red'];
      demo.push({ number: n, color });
    }
    return res.json({ success: true, periods: demo });
  }
  res.json({ success: true, periods: r });
});

// BANNERS
app.get('/api/banners/:type', (req, res) => {
  const banners = loadData('banners').filter(b => b.type === req.params.type && b.isActive).sort((a, b) => a.position - b.position);
  res.json({ success: true, banners });
});

// HOME
app.get('/api/home/winners', (req, res) => {
  const bets = loadData('bets');
  const today = new Date().toDateString();
  const byUser = {};
  bets.forEach(b => { if (b.result === 'win' && b.payout > 0 && new Date(b.createdAt).toDateString() === today) byUser[b.uid] = (byUser[b.uid] || 0) + b.payout; });
  let winners = Object.entries(byUser).map(([uid, amount]) => ({ uid, name: 'User ' + uid.slice(-5), amount, game: 'WinGo' })).sort((a, b) => b.amount - a.amount).slice(0, 10);
  if (winners.length === 0) winners = [
    { name: 'User 72***91', amount: 18500, game: 'WinGo 3m' },
    { name: 'User 88***12', amount: 12400, game: 'WinGo 1m' },
    { name: 'User 65***44', amount: 9800, game: 'K3 1m' },
    { name: 'User 91***08', amount: 7600, game: 'WinGo 30s' },
    { name: 'User 34***77', amount: 5200, game: '5D 1m' }
  ];
  res.json({ success: true, winners });
});

// AGENT
app.get('/api/agent/team', auth, (req, res) => {
  const users = loadData('users');
  const me = users.find(u => u.uid === req.user.uid);
  if (!me) return res.status(404).json({ success: false, message: 'User not found' });
  const team = users.filter(u => u.invitedBy === me.inviteCode).map(u => ({ uid: u.uid, name: 'User ' + u.uid.slice(-5), joinedAt: u.createdAt, earned: Math.floor((u.totalDeposit || 0) * 0.1) }));
  res.json({ success: true, team, totalInvited: team.length, activeCount: team.filter(t => t.earned > 0).length, totalEarned: team.reduce((s, t) => s + t.earned, 0) });
});

// ADMIN
app.get('/api/admin/stats', adminAuth, (req, res) => {
  const users = loadData('users');
  const txns = loadData('transactions');
  const bets = loadData('bets');
  const deposits = txns.filter(t => t.type === 'deposit' && t.status === 'success');
  const withdraws = txns.filter(t => t.type === 'withdraw' && t.status === 'success');
  const pendDep = txns.filter(t => t.type === 'deposit' && t.status === 'pending');
  const pendWd = txns.filter(t => t.type === 'withdraw' && t.status === 'processing');
  res.json({ success: true, stats: {
    totalUsers: users.length, bannedUsers: users.filter(u => u.isBanned).length,
    activeToday: users.filter(u => u.lastLogin && new Date(u.lastLogin).toDateString() === new Date().toDateString()).length,
    totalBalance: users.reduce((s, u) => s + (u.balance || 0), 0),
    totalDeposit: deposits.reduce((s, t) => s + t.amount, 0),
    totalWithdraw: withdraws.reduce((s, t) => s + t.amount, 0),
    totalBet: bets.reduce((s, b) => s + b.amount, 0),
    totalPayout: bets.reduce((s, b) => s + (b.payout || 0), 0),
    pendingDeposits: pendDep.length, pendingWithdraws: pendWd.length
  }});
});

app.get('/api/admin/users', adminAuth, (req, res) => {
  const { search = '', limit = 100 } = req.query;
  let users = loadData('users');
  if (search) { const q = search.toLowerCase(); users = users.filter(u => u.uid.toLowerCase().includes(q) || u.phone.includes(q)); }
  users.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const slice = users.slice(0, parseInt(limit)).map(({ password, ...u }) => u);
  res.json({ success: true, users: slice });
});

app.post('/api/admin/user/ban', adminAuth, (req, res) => {
  const users = loadData('users');
  const i = users.findIndex(u => u.uid === req.body.uid);
  if (i === -1) return res.status(404).json({ success: false, message: 'Not found' });
  users[i].isBanned = !!req.body.banned;
  saveData('users', users);
  res.json({ success: true, message: 'Updated' });
});

app.post('/api/admin/user/balance', adminAuth, (req, res) => {
  const { uid, amount, note } = req.body;
  const amt = Number(amount);
  if (!uid || !amt) return res.status(400).json({ success: false, message: 'Invalid' });
  const users = loadData('users');
  const i = users.findIndex(u => u.uid === uid);
  if (i === -1) return res.status(404).json({ success: false, message: 'Not found' });
  users[i].balance = Math.max(0, (users[i].balance || 0) + amt);
  saveData('users', users);
  const txns = loadData('transactions');
  txns.push({ id: genId('txn_'), uid, type: amt > 0 ? 'admin_credit' : 'admin_debit', amount: Math.abs(amt), status: 'success', details: { note }, createdAt: new Date().toISOString() });
  saveData('transactions', txns);
  res.json({ success: true, message: 'Updated', newBalance: users[i].balance });
});

app.get('/api/admin/deposits', adminAuth, (req, res) => {
  const { status } = req.query;
  let list = loadData('transactions').filter(t => t.type === 'deposit');
  if (status) list = list.filter(t => t.status === status);
  list = list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 200);
  res.json({ success: true, deposits: list });
});

app.post('/api/admin/deposit/action', adminAuth, (req, res) => {
  const { id, action } = req.body;
  if (!['approve', 'reject'].includes(action)) return res.status(400).json({ success: false, message: 'Invalid' });
  const txns = loadData('transactions');
  const ti = txns.findIndex(t => t.id === id && t.type === 'deposit');
  if (ti === -1) return res.status(404).json({ success: false, message: 'Not found' });
  if (txns[ti].status !== 'pending') return res.status(400).json({ success: false, message: 'Already processed' });
  if (action === 'approve') {
    const users = loadData('users');
    const ui = users.findIndex(u => u.uid === txns[ti].uid);
    if (ui === -1) return res.status(404).json({ success: false, message: 'User not found' });
    users[ui].balance = (users[ui].balance || 0) + txns[ti].amount;
    users[ui].totalDeposit = (users[ui].totalDeposit || 0) + txns[ti].amount;
    if (users[ui].totalDeposit === txns[ti].amount) {
      const bonus = Math.floor(txns[ti].amount * 0.05);
      if (bonus > 0) { users[ui].balance += bonus; txns.push({ id: genId('txn_'), uid: users[ui].uid, type: 'bonus', amount: bonus, status: 'success', createdAt: new Date().toISOString() }); }
    }
    saveData('users', users);
    txns[ti].status = 'success';
  } else {
    txns[ti].status = 'failed';
  }
  saveData('transactions', txns);
  res.json({ success: true, message: `Deposit ${action}d` });
});

app.get('/api/admin/withdraws', adminAuth, (req, res) => {
  const { status } = req.query;
  let list = loadData('transactions').filter(t => t.type === 'withdraw');
  if (status) list = list.filter(t => t.status === status);
  list = list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 200);
  res.json({ success: true, withdraws: list });
});

app.post('/api/admin/withdraw/action', adminAuth, (req, res) => {
  const { id, action } = req.body;
  if (!['approve', 'reject'].includes(action)) return res.status(400).json({ success: false, message: 'Invalid' });
  const txns = loadData('transactions');
  const ti = txns.findIndex(t => t.id === id && t.type === 'withdraw');
  if (ti === -1) return res.status(404).json({ success: false, message: 'Not found' });
  if (txns[ti].status !== 'processing') return res.status(400).json({ success: false, message: 'Already processed' });
  
  if (action === 'approve') {
    txns[ti].status = 'success';
  } else {
    txns[ti].status = 'failed';
    const users = loadData('users');
    const ui = users.findIndex(u => u.uid === txns[ti].uid);
    if (ui !== -1) {
      us
