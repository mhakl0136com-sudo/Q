// Node 18+ ، من غير أي مكتبات: node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');

const CFG = {
  PORT: process.env.PORT || 3000,
  SECRET: process.env.SMS_SECRET || 'change-me',       // كلمة سر لرابط الـSMS
  WALLET: process.env.WALLET || '01001207608',         // رقم محفظتك (بيظهر للعميل)
  OWNER_PHONE: process.env.OWNER_PHONE || '201001207608', // رقمك للواتساب بكود الدولة
  CALLMEBOT_KEY: process.env.CALLMEBOT_KEY || '',      // مفتاح CallMeBot
};

const SERVICES = {
  qrueo: { name: 'كريو', price: 30 },
  finance: { name: 'الثقافة المالية', price: 50 },
};

const DB = path.join(__dirname, 'bookings.json');
const load = () => { try { return JSON.parse(fs.readFileSync(DB, 'utf8')); } catch { return []; } };
const save = (d) => fs.writeFileSync(DB, JSON.stringify(d, null, 1));
const digits = (s) => String(s).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
const norm = (p) => digits(p).replace(/\D/g, '').replace(/^20/, '0').slice(-11);

async function notify(text) {
  console.log('NOTIFY:', text);
  if (!CFG.CALLMEBOT_KEY) return;
  try {
    await fetch(`https://api.callmebot.com/whatsapp.php?phone=${CFG.OWNER_PHONE}&apikey=${CFG.CALLMEBOT_KEY}&text=${encodeURIComponent(text)}`);
  } catch (e) { console.error('whatsapp error:', e.message); }
}

const readBody = (req) => new Promise((resolve) => {
  let b = '';
  req.on('data', (c) => { b += c; if (b.length > 1e5) req.destroy(); });
  req.on('end', () => resolve(b));
});

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const json = (o, c = 200) => {
    res.writeHead(c, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(o));
  };
  try {
    // صفحة الحجز
    if (req.method === 'GET' && u.pathname === '/') {
      const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
        .replaceAll('__WALLET__', CFG.WALLET);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    // حجز جديد
    if (req.method === 'POST' && u.pathname === '/api/book') {
      const b = JSON.parse(await readBody(req));
      const name = String(b.name || '').trim().slice(0, 60);
      const from = norm(b.from || '');
      const svc = SERVICES[b.service];
      const platformId = String(b.platformId || '').trim().slice(0, 80);
      const platformPass = String(b.platformPass || '').trim().slice(0, 80);
      if (!name || from.length !== 11 || !svc || !platformId || !platformPass) return json({ error: 'بيانات ناقصة' }, 400);
      const d = load();
      const bk = {
        id: Date.now().toString(36), name, from, service: svc.name,
        note: String(b.note || '').slice(0, 200),
        platformId, platformPass,
        amount: svc.price, status: 'pending', at: new Date().toISOString(),
      };
      d.push(bk); save(d);
      return json({ id: bk.id, amount: bk.amount });
    }

    // حالة الحجز (الصفحة بتسأل كل كام ثانية)
    if (req.method === 'GET' && u.pathname.startsWith('/api/status/')) {
      const bk = load().find((x) => x.id === u.pathname.split('/').pop());
      return json({ status: bk ? bk.status : 'unknown' });
    }

    // استقبال الـSMS من تطبيق الموبايل
    if (req.method === 'POST' && u.pathname === '/api/sms') {
      if (u.searchParams.get('key') !== CFG.SECRET) return json({ error: 'no' }, 401);
      const raw = await readBody(req);
      let p;
      try { p = JSON.parse(raw); } catch { p = Object.fromEntries(new URLSearchParams(raw)); }
      const text = digits(p.text || p.message || p.body || raw);
      const m = text.match(/(\d+(?:[.,]\d+)?)\s*(?:جنيه|ج\.?م|EGP|LE)/i);
      const amount = m ? parseFloat(m[1].replace(',', '.')) : NaN;
      const flat = text.replace(/[\s-]/g, '');

      const d = load();
      const bk = d.find((x) => x.status === 'pending' && flat.includes(x.from.slice(1)) && amount >= x.amount);
      if (bk) {
        bk.status = 'paid'; bk.paidAt = new Date().toISOString(); save(d);
        await notify(`✅ حجز جديد مدفوع\nالخدمة: ${bk.service}\nالاسم: ${bk.name}\nالرقم: ${bk.from}\nالمبلغ: ${amount} جنيه\nID المنصة: ${bk.platformId}\nباسورد المنصة: ${bk.platformPass}${bk.note ? '\nملاحظة: ' + bk.note : ''}`);
      } else {
        await notify(`⚠️ وصلت رسالة مش مطابقة لأي حجز:\n${text.slice(0, 300)}`);
      }
      return json({ ok: true });
    }

    json({ error: 'not found' }, 404);
  } catch (e) {
    console.error(e); json({ error: 'server error' }, 500);
  }
}).listen(CFG.PORT, () => console.log('Running on port', CFG.PORT));
