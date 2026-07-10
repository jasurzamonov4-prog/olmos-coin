require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;
const SMM_API_KEY = process.env.SMM_API_KEY || '';
const SMM_API_URL = process.env.SMM_API_URL || '';
const MONGODB_URI = process.env.MONGODB_URI || '';

/* ============================================================
   MA'LUMOTLAR BAZASI — endi MongoDB Atlas'da saqlanadi (bepul,
   HECH QACHON o'chib ketmaydi — Render server "uxlab" qolib,
   qayta ishga tushsa ham ma'lumotlar joyida turadi).
   Har bir "jadval" (tasks/auctions/transfers) — bitta document
   sifatida saqlanadi, oddiy JSON obyekt kabi ishlatiladi.
   ============================================================ */
let mongoDb = null;
let mongoReady = (async () => {
  if (!MONGODB_URI) {
    console.warn('OGOHLANTIRISH: MONGODB_URI sozlanmagan — ma\'lumotlar saqlanmaydi!');
    return;
  }
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  mongoDb = client.db('yumicoin');
  console.log('MongoDB\'ga muvaffaqiyatli ulandi ✅');
})().catch(e => console.error('MongoDB ulanish xatosi:', e.message));

async function loadBlob(name, defaultValue) {
  if (!mongoDb) return JSON.parse(JSON.stringify(defaultValue));
  const doc = await mongoDb.collection('blobs').findOne({ _id: name });
  return doc ? doc.data : JSON.parse(JSON.stringify(defaultValue));
}
async function saveBlob(name, data) {
  if (!mongoDb) return;
  await mongoDb.collection('blobs').updateOne({ _id: name }, { $set: { data } }, { upsert: true });
}

async function loadTasksDb() { return loadBlob('tasks', { tasks: [], completions: [] }); }
async function saveTasksDb(db) { return saveBlob('tasks', db); }
async function loadAuctionsDb() { return loadBlob('auctions', { auctions: [] }); }
async function saveAuctionsDb(db) { return saveBlob('auctions', db); }
async function loadTransfersDb() { return loadBlob('transfers', { transfers: [] }); }
async function saveTransfersDb(db) { return saveBlob('transfers', db); }
async function loadSettingsDb() { return loadBlob('settings', { dailyBonusCode: 'UZB', dailyBonusReward: 25 }); }
async function saveSettingsDb(db) { return saveBlob('settings', db); }
async function loadDailyClaimsDb() { return loadBlob('dailyClaims', { claims: [] }); }
async function saveDailyClaimsDb(db) { return saveBlob('dailyClaims', db); }

function getUserId(req) {
  const id = req.headers['x-user-id'] || (req.body && req.body.userId);
  return id ? String(id) : null;
}

app.get('/api/tasks', async (req, res) => {
  const db = await loadTasksDb();
  const userId = getUserId(req);
  const myCompletions = new Set(db.completions.filter(c => c.userId === userId).map(c => c.taskId));
  const tasks = db.tasks
    .filter(t => t.remaining >= t.reward)
    .map(t => ({ ...t, claimed: myCompletions.has(t.id) }));
  res.json(tasks);
});

app.post('/api/tasks', async (req, res) => {
  const { title, link, reward, remaining } = req.body;
  if (!title || !link) return res.status(400).json({ error: 'title_and_link_required' });
  const db = await loadTasksDb();
  const task = {
    id: 'task' + Date.now() + crypto.randomBytes(3).toString('hex'),
    title, link,
    reward: Number(reward) || 1,
    remaining: Number(remaining) || Number(reward) || 1,
    createdAt: Date.now(),
  };
  db.tasks.unshift(task);
  await saveTasksDb(db);
  res.json({ task });
});

app.post('/api/tasks/:id/claim', async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(400).json({ error: 'user_id_required' });
  const db = await loadTasksDb();
  const task = db.tasks.find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'not_found' });
  const already = db.completions.some(c => c.taskId === task.id && c.userId === userId);
  if (already) return res.status(400).json({ error: 'already_claimed' });
  if (task.remaining < task.reward) return res.status(400).json({ error: 'pool_empty' });
  task.remaining -= task.reward;
  db.completions.push({ taskId: task.id, userId, claimedAt: Date.now() });
  await saveTasksDb(db);
  res.json({ reward: task.reward });
});

const ADMIN_USERNAMES = ['uzalma1', 'uzalmaz1'];
function isAdmin(req) {
  const username = String(req.headers['x-username'] || '').replace('@', '').toLowerCase();
  return ADMIN_USERNAMES.includes(username);
}
setInterval(async () => {
  if (!mongoDb) return;
  const db = await loadAuctionsDb();
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
  if (changed) await saveAuctionsDb(db);
}, 5000);

app.get('/api/auctions', async (req, res) => {
  const db = await loadAuctionsDb();
  res.json(db.auctions);
});

app.post('/api/auctions', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'forbidden' });
  const { title, sub, emoji, price, durationMin, auto } = req.body;
  if (!title || !price || price <= 0) return res.status(400).json({ error: 'bad_input' });
  const db = await loadAuctionsDb();
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
  await saveAuctionsDb(db);
  res.json({ auction });
});

app.post('/api/auctions/:id/remove', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'forbidden' });
  const db = await loadAuctionsDb();
  db.auctions = db.auctions.filter(a => a.id !== req.params.id);
  await saveAuctionsDb(db);
  res.json({ ok: true });
});

app.post('/api/auctions/:id/bid', async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(400).json({ error: 'user_id_required' });
  const amount = Number(req.body.amount) || 0;
  const bidderName = String(req.body.bidderName || '').replace('@', '');
  const db = await loadAuctionsDb();
  const auction = db.auctions.find(a => a.id === req.params.id && a.status === 'faol');
  if (!auction) return res.status(404).json({ error: 'not_found' });
  const min = auction.price + 100;
  if (amount < min) return res.status(400).json({ error: 'bid_too_low', min });
  auction.price = amount;
  auction.bids += 1;
  auction.highestBidderId = userId;
  auction.highestBidderName = bidderName || 'Foydalanuvchi';
  await saveAuctionsDb(db);
  res.json({ price: auction.price, bids: auction.bids, highestBidderName: auction.highestBidderName });
});

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

app.get('/api/smm/services', async (req, res) => {
  try {
    const data = await callSmmApi({ action: 'services' });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'smm_request_failed', detail: e.message });
  }
});

app.get('/api/smm/balance', async (req, res) => {
  try {
    const data = await callSmmApi({ action: 'balance' });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'smm_request_failed', detail: e.message });
  }
});

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

app.get('/api/boost-order/:orderId/status', async (req, res) => {
  try {
    const data = await callSmmApi({ action: 'status', order: req.params.orderId });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'smm_request_failed', detail: e.message });
  }
});

app.get('/', (req, res) => res.send('SMM proxy ishlayapti ✅' + (mongoDb ? ' (baza ulangan)' : ' (OGOHLANTIRISH: baza ulanmagan)')));

app.post('/api/send-diamond', async (req, res) => {
  const fromUserId = getUserId(req);
  if (!fromUserId) return res.status(400).json({ error: 'user_id_required' });
  const { toReferralCode, amount, fromReferralCode } = req.body;
  const amt = Number(amount) || 0;
  if (!toReferralCode) return res.status(400).json({ error: 'code_required' });
  if (amt <= 0) return res.status(400).json({ error: 'bad_amount' });
  if (String(toReferralCode).toUpperCase() === String(fromReferralCode).toUpperCase()) {
    return res.status(400).json({ error: 'cannot_send_self' });
  }
  const db = await loadTransfersDb();
  const transfer = {
    id: 'tr' + Date.now() + crypto.randomBytes(3).toString('hex'),
    fromUserId, fromReferralCode: fromReferralCode || '',
    toReferralCode: String(toReferralCode).toUpperCase(),
    amount: amt, claimed: false, createdAt: Date.now(),
  };
  db.transfers.push(transfer);
  await saveTransfersDb(db);
  res.json({ ok: true });
});

app.get('/api/transfers/incoming', async (req, res) => {
  const myCode = String(req.query.code || '').toUpperCase();
  if (!myCode) return res.status(400).json({ error: 'code_required' });
  const db = await loadTransfersDb();
  const incoming = db.transfers.filter(t => t.toReferralCode === myCode && !t.claimed);
  res.json(incoming);
});

app.post('/api/transfers/:id/claim', async (req, res) => {
  const db = await loadTransfersDb();
  const t = db.transfers.find(x => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'not_found' });
  if (t.claimed) return res.status(400).json({ error: 'already_claimed' });
  t.claimed = true;
  await saveTransfersDb(db);
  res.json({ amount: t.amount });
});

/* ============================================================
   KUNLIK BONUS — kod va mukofot ENDI SERVERDA saqlanadi.
   Admin o'zgartirsa, HAMMA uchun bir xil kod ishlaydi, va har
   bir foydalanuvchi kuniga faqat 1 marta ololadi (serverda
   tekshiriladi — brauzer tozalansa ham qayta ololmaydi).
   ============================================================ */
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
app.get('/api/daily-bonus/settings', async (req, res) => {
  const settings = await loadSettingsDb();
  res.json({ dailyBonusReward: settings.dailyBonusReward }); // kodning o'zi berilmaydi, faqat mukofot ko'rsatiladi
});
app.post('/api/admin/daily-bonus', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'forbidden' });
  const { code, reward } = req.body;
  if (!code) return res.status(400).json({ error: 'code_required' });
  const settings = await loadSettingsDb();
  settings.dailyBonusCode = String(code).toUpperCase();
  settings.dailyBonusReward = Number(reward) || settings.dailyBonusReward;
  await saveSettingsDb(settings);
  res.json({ ok: true, dailyBonusCode: settings.dailyBonusCode, dailyBonusReward: settings.dailyBonusReward });
});
app.get('/api/admin/daily-bonus', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'forbidden' });
  const settings = await loadSettingsDb();
  res.json(settings);
});
app.post('/api/daily-bonus/claim', async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(400).json({ error: 'user_id_required' });
  const code = String(req.body.code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'code_required' });
  const settings = await loadSettingsDb();
  if (code !== settings.dailyBonusCode.toUpperCase()) return res.status(400).json({ error: 'wrong_code' });
  const claimsDb = await loadDailyClaimsDb();
  const today = todayStr();
  const already = claimsDb.claims.some(c => c.userId === userId && c.date === today);
  if (already) return res.status(400).json({ error: 'already_claimed_today' });
  claimsDb.claims.push({ userId, date: today });
  await saveDailyClaimsDb(claimsDb);
  res.json({ reward: settings.dailyBonusReward });
});

app.listen(PORT, () => {
  console.log(`SMM proxy server http://localhost:${PORT} portida ishga tushdi`);
});

/* ============================================================
   SERVERNI "UXLAB QOLISHDAN" SAQLASH (o'z-o'zini "uyg'otish")
   Render'ning bepul tarifi hech kim foydalanmasa serverni
   "uxlatib" qo'yadi. Buni oldini olish uchun server o'zining
   ochiq (public) manzilini har 10 daqiqada bir marta so'raydi —
   bu Render uchun "faollik" hisoblanadi.
   SELF_URL ni Render Environment'ga qo'shing (masalan
   https://smm-proxyk.onrender.com).
   ESLATMA: bu faqat server hali UYG'OQ bo'lganda ishlaydi —
   agar u allaqachon chuqur uxlab qolgan bo'lsa (masalan hech kim
   soatlab kirmasa), tashqi bepul xizmat (masalan UptimeRobot,
   https://uptimerobot.com) orqali qo'shimcha "uyg'otish" ham
   sozlash tavsiya etiladi — bu 100% kafolatlangan yechim.
   ============================================================ */
const SELF_URL = process.env.SELF_URL || '';
if (SELF_URL) {
  setInterval(() => {
    fetch(SELF_URL).catch(() => {});
  }, 10 * 60 * 1000);
}
