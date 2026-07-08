require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;
const SMM_API_KEY = process.env.SMM_API_KEY || '';
const SMM_API_URL = process.env.SMM_API_URL || '';

/* ============================================================
   UMUMIY VAZIFALAR TAXTASI (hammaga ko'rinadigan, haqiqiy shared data)
   Oddiy JSON fayl orqali saqlanadi — kichik/o'rta yuklama uchun yetarli.
   ============================================================ */
const DATA_DIR = path.join(__dirname, 'data');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(TASKS_FILE)) fs.writeFileSync(TASKS_FILE, JSON.stringify({ tasks: [], completions: [] }, null, 2));

function loadTasksDb() {
  try { return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8')); }
  catch (e) { return { tasks: [], completions: [] }; }
}
let saveQueue = Promise.resolve();
function saveTasksDb(db) {
  saveQueue = saveQueue.then(() => new Promise((resolve) => {
    fs.writeFile(TASKS_FILE, JSON.stringify(db, null, 2), () => resolve());
  }));
  return saveQueue;
}

// Foydalanuvchini Telegram WebApp'dan yuborilgan ID orqali aniqlaymiz.
// Eslatma: bu yerda to'liq kriptografik tekshiruv qilinmagan (soddalashtirish uchun) —
// ya'ni texnik bilimi bo'lgan odam o'zini boshqa ID sifatida ko'rsatishi mumkin.
// Katta pul aylanadigan tizim uchun buni Telegram initData imzosi bilan tekshirish tavsiya etiladi.
function getUserId(req) {
  const id = req.headers['x-user-id'] || (req.body && req.body.userId);
  return id ? String(id) : null;
}

app.get('/api/tasks', (req, res) => {
  const db = loadTasksDb();
  const userId = getUserId(req);
  const myCompletions = new Set(db.completions.filter(c => c.userId === userId).map(c => c.taskId));
  const tasks = db.tasks
    .filter(t => t.remaining >= t.reward)
    .map(t => ({ ...t, claimed: myCompletions.has(t.id) }));
  res.json(tasks);
});

app.post('/api/tasks', (req, res) => {
  const { title, link, reward, remaining } = req.body;
  if (!title || !link) return res.status(400).json({ error: 'title_and_link_required' });
  const db = loadTasksDb();
  const task = {
    id: 'task' + Date.now() + crypto.randomBytes(3).toString('hex'),
    title, link,
    reward: Number(reward) || 1,
    remaining: Number(remaining) || Number(reward) || 1,
    createdAt: Date.now(),
  };
  db.tasks.unshift(task);
  saveTasksDb(db);
  res.json({ task });
});

app.post('/api/tasks/:id/claim', (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(400).json({ error: 'user_id_required' });
  const db = loadTasksDb();
  const task = db.tasks.find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'not_found' });
  const already = db.completions.some(c => c.taskId === task.id && c.userId === userId);
  if (already) return res.status(400).json({ error: 'already_claimed' });
  if (task.remaining < task.reward) return res.status(400).json({ error: 'pool_empty' });
  task.remaining -= task.reward;
  db.completions.push({ taskId: task.id, userId, claimedAt: Date.now() });
  saveTasksDb(db);
  res.json({ reward: task.reward });
});

/* ============================================================
   UMUMIY AUKSION (hammaga ko'rinadigan, haqiqiy shared data)
   ============================================================ */
const ADMIN_USERNAMES = ['uzalma1', 'uzalmaz1'];
const AUCTIONS_FILE = path.join(DATA_DIR, 'auctions.json');
if (!fs.existsSync(AUCTIONS_FILE)) fs.writeFileSync(AUCTIONS_FILE, JSON.stringify({ auctions: [] }, null, 2));

function loadAuctionsDb() {
  try { return JSON.parse(fs.readFileSync(AUCTIONS_FILE, 'utf8')); }
  catch (e) { return { auctions: [] }; }
}
let auctionSaveQueue = Promise.resolve();
function saveAuctionsDb(db) {
  auctionSaveQueue = auctionSaveQueue.then(() => new Promise((resolve) => {
    fs.writeFile(AUCTIONS_FILE, JSON.stringify(db, null, 2), () => resolve());
  }));
  return auctionSaveQueue;
}
function isAdmin(req) {
  const username = String(req.headers['x-username'] || '').replace('@', '').toLowerCase();
  return ADMIN_USERNAMES.includes(username);
}
// Har necha soniyada muddati tugagan auksionlarni tekshiradi — bu SERVERNING O'ZIDA
// ishlaydi, hech kim ilovani ochib turmasa ham to'g'ri ishlaydi.
setInterval(() => {
  const db = loadAuctionsDb();
  const now = Date.now();
  let changed = false;
  db.auctions.forEach(a => {
    if (a.status === 'faol' && a.endsAt <= now) {
      changed = true;
      if (a.auto) {
        a.price = a.startPrice;
        a.bids = 0;
        a.endsAt = now + a.durationMin * 60000;
      } else {
        a.status = 'tugagan';
      }
    }
  });
  if (changed) saveAuctionsDb(db);
}, 5000);

app.get('/api/auctions', (req, res) => {
  const db = loadAuctionsDb();
  res.json(db.auctions);
});

app.post('/api/auctions', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'forbidden' });
  const { title, sub, emoji, price, durationMin, auto } = req.body;
  if (!title || !price || price <= 0) return res.status(400).json({ error: 'bad_input' });
  const db = loadAuctionsDb();
  const auction = {
    id: 'auc' + Date.now() + crypto.randomBytes(3).toString('hex'),
    title, sub: sub || '', emoji: emoji || '🎁',
    price: Number(price), startPrice: Number(price),
    bids: 0, auto: !!auto,
    durationMin: Number(durationMin) || 60,
    endsAt: Date.now() + (Number(durationMin) || 60) * 60000,
    status: 'faol',
    createdAt: Date.now(),
  };
  db.auctions.unshift(auction);
  saveAuctionsDb(db);
  res.json({ auction });
});

app.post('/api/auctions/:id/remove', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'forbidden' });
  const db = loadAuctionsDb();
  db.auctions = db.auctions.filter(a => a.id !== req.params.id);
  saveAuctionsDb(db);
  res.json({ ok: true });
});

app.post('/api/auctions/:id/bid', (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(400).json({ error: 'user_id_required' });
  const amount = Number(req.body.amount) || 0;
  const db = loadAuctionsDb();
  const auction = db.auctions.find(a => a.id === req.params.id && a.status === 'faol');
  if (!auction) return res.status(404).json({ error: 'not_found' });
  const min = auction.price + 100;
  if (amount < min) return res.status(400).json({ error: 'bid_too_low', min });
  auction.price = amount;
  auction.bids += 1;
  auction.highestBidderId = userId;
  saveAuctionsDb(db);
  res.json({ price: auction.price, bids: auction.bids });
});

/* ============================================================
   XIZMATLAR RO'YXATI — SMMSEEN saytidagi "Services" bo'limidan
   olingan haqiqiy Service ID'larni shu yerga qo'ying.
   Hozircha "TODO" turibdi — ID'larni bilguningizcha ishlamaydi.
   ============================================================ */
const SERVICE_MAP = {
  'ig-view':  { id: '14328', name: 'Instagram Prasmotr' },
  'ig-share': { id: '6538',  name: "Instagram Jo'natishlar" },
  'ig-sub':   { id: '14399', name: 'Instagram Obunachi' },
  'ig-like':  { id: '14327', name: 'Instagram Like' },
  'tg-view':  { id: '1869',  name: 'Telegram Prasmotr' },
  'tg-react': { id: '1972',  name: 'Telegram Reaksiya' },
  'tg-sub':   { id: '1834',  name: 'Telegram Obunachilar' },
};

async function callSmmApi(params) {
  const body = new URLSearchParams({ key: SMM_API_KEY, ...params });
  const res = await fetch(SMM_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  return res.json();
}

// Xizmatlar ro'yxatini SMM panelning o'zidan tekshirish uchun (debug maqsadida)
app.get('/api/smm/services', async (req, res) => {
  try {
    const data = await callSmmApi({ action: 'services' });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'smm_request_failed', detail: e.message });
  }
});

// Balansni tekshirish
app.get('/api/smm/balance', async (req, res) => {
  try {
    const data = await callSmmApi({ action: 'balance' });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'smm_request_failed', detail: e.message });
  }
});

// Asosiy: buyurtma qo'yish — frontend shu yerga so'rov yuboradi
app.post('/api/boost-order', async (req, res) => {
  const { serviceId, link, quantity } = req.body;
  const mapped = SERVICE_MAP[serviceId];
  if (!mapped) return res.status(400).json({ error: 'unknown_service' });
  if (mapped.id === 'TODO') {
    return res.status(400).json({ error: 'service_id_not_configured', message: `"${mapped.name}" uchun Service ID hali kiritilmagan (server.js faylidagi SERVICE_MAP)` });
  }
  if (!link) return res.status(400).json({ error: 'link_required' });
  if (!quantity || quantity <= 0) return res.status(400).json({ error: 'bad_quantity' });

  try {
    const data = await callSmmApi({
      action: 'add',
      service: mapped.id,
      link,
      quantity,
    });
    if (data.error) return res.status(400).json({ error: 'smm_error', message: data.error });
    res.json({ ok: true, orderId: data.order });
  } catch (e) {
    res.status(500).json({ error: 'smm_request_failed', detail: e.message });
  }
});

// Buyurtma holatini tekshirish
app.get('/api/boost-order/:orderId/status', async (req, res) => {
  try {
    const data = await callSmmApi({ action: 'status', order: req.params.orderId });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'smm_request_failed', detail: e.message });
  }
});

app.get('/', (req, res) => res.send('SMM proxy ishlayapti ✅'));

/* ============================================================
   OLMOS YUBORISH (oddiy "pochta qutisi" tizimi)
   Yuboruvchi o'z tarafida olmosni ayiradi va shu yerga
   "xat" qoldiradi; qabul qiluvchi o'z referral kodi bilan
   navbatdagi xatlarini tekshirib, olmosni o'ziga qo'shadi.
   ============================================================ */
const TRANSFERS_FILE = path.join(DATA_DIR, 'transfers.json');
if (!fs.existsSync(TRANSFERS_FILE)) fs.writeFileSync(TRANSFERS_FILE, JSON.stringify({ transfers: [] }, null, 2));
function loadTransfersDb() {
  try { return JSON.parse(fs.readFileSync(TRANSFERS_FILE, 'utf8')); }
  catch (e) { return { transfers: [] }; }
}
let transfersSaveQueue = Promise.resolve();
function saveTransfersDb(db) {
  transfersSaveQueue = transfersSaveQueue.then(() => new Promise((resolve) => {
    fs.writeFile(TRANSFERS_FILE, JSON.stringify(db, null, 2), () => resolve());
  }));
  return transfersSaveQueue;
}

app.post('/api/send-diamond', (req, res) => {
  const fromUserId = getUserId(req);
  if (!fromUserId) return res.status(400).json({ error: 'user_id_required' });
  const { toReferralCode, amount, fromReferralCode } = req.body;
  const amt = Number(amount) || 0;
  if (!toReferralCode) return res.status(400).json({ error: 'code_required' });
  if (amt <= 0) return res.status(400).json({ error: 'bad_amount' });
  if (String(toReferralCode).toUpperCase() === String(fromReferralCode).toUpperCase()) {
    return res.status(400).json({ error: 'cannot_send_self' });
  }
  const db = loadTransfersDb();
  const transfer = {
    id: 'tr' + Date.now() + crypto.randomBytes(3).toString('hex'),
    fromUserId, fromReferralCode: fromReferralCode || '',
    toReferralCode: String(toReferralCode).toUpperCase(),
    amount: amt, claimed: false, createdAt: Date.now(),
  };
  db.transfers.push(transfer);
  saveTransfersDb(db);
  res.json({ ok: true });
});

app.get('/api/transfers/incoming', (req, res) => {
  const myCode = String(req.query.code || '').toUpperCase();
  if (!myCode) return res.status(400).json({ error: 'code_required' });
  const db = loadTransfersDb();
  const incoming = db.transfers.filter(t => t.toReferralCode === myCode && !t.claimed);
  res.json(incoming);
});

app.post('/api/transfers/:id/claim', (req, res) => {
  const db = loadTransfersDb();
  const t = db.transfers.find(x => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'not_found' });
  if (t.claimed) return res.status(400).json({ error: 'already_claimed' });
  t.claimed = true;
  saveTransfersDb(db);
  res.json({ amount: t.amount });
});

app.listen(PORT, () => {
  console.log(`SMM proxy server http://localhost:${PORT} portida ishga tushdi`);
});
