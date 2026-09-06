// Vercel serverless function — เมนู "สำหรับสต๊อค" (2026-09-06) แทนที่ Lark Base เดิม (ดู ระบบจัดการออเดอร์.tsx
// ที่ user ส่งมาอ้างอิง UI/PDF เดิม) รวม stock-orders-list.js + stock-order-update.js เดิมไว้ในไฟล์เดียว
// (ลดจำนวน serverless function ทั้งโปรเจกต์ — Vercel Hobby plan จำกัดไว้แค่ 12 ฟังก์ชัน/deployment เกินแล้ว
// deploy ล้มเงียบๆ เจอบั๊กจริง 2026-09-06 ตอนเพิ่มเมนูนี้ deploy พังเพราะเกินโควต้าพอดี)
//
// GET  ?customerType=all|credit|cash&q=&round=&printStatus=all|printed|unprinted&showCancelled=true|false
//   รวม 2 แหล่งข้อมูล:
//   1. "เครดิตผ่าน/วางดาวน์" — ดึงสดจาก contract_submissions ของระบบนี้เอง เฉพาะที่สถานะการทำสัญญา =
//      "สัญญาลูกค้าเรียบร้อย" (reviewed_at ไม่ null, rejected_at เป็น null, ยังไม่มี imei+serial ครบ — ตรงตาม
//      เงื่อนไข customer_ok ใน _lib/contract-status.js) ไม่ copy ข้อมูลซ้ำ อ่านสดทุกครั้ง
//   2. "ซื้อสด/ปิดยอด" — ยังไม่ได้ต่อจริง (2026-09-06 รอ endpoint CRM แบบ list/กรองออเดอร์ทั้งหมด ที่ยังไม่มี
//      ยืนยันในระบบนี้ — ตอนนี้คืน array ว่างไปก่อน มี TODO กำกับไว้ชัดเจน)
//   ทั้ง 2 แหล่ง join กับ stock_order_meta (เมทาดาต้าการเบิกที่ระบบนี้เป็นเจ้าของเอง) ด้วย so_number
//
// POST { action: 'setRound'|'markPrinted'|'cancel', ... } อัปเดต stock_order_meta (ดู handler ด้านล่าง)
//
// ต้องรัน supabase-stock-orders.sql ก่อนใช้งาน (ตาราง stock_order_meta)
// ต้องตั้งค่าใน Vercel project settings: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function fetchCreditOrders(authHeaders) {
  // reviewed_at ไม่ null + rejected_at เป็น null ผ่าน PostgREST filter ได้ตรงๆ ส่วน "ยังไม่มี imei+serial ครบ"
  // (เงื่อนไข customer_ok ข้อสุดท้าย) ต้องกรองต่อฝั่ง JS เพราะ PostgREST filter ข้าม 2 คอลัมน์พร้อมกันแบบ
  // "ทั้งคู่ไม่ null" ตรงๆ ไม่ได้สะดวกเท่า
  const r = await fetch(
    SUPABASE_URL + '/rest/v1/contract_submissions' +
      '?select=id,customer_data,imei,serial_number,contract_sessions(token,so_number,crm_snapshot)' +
      '&reviewed_at=not.is.null&rejected_at=is.null',
    { headers: authHeaders }
  );
  if (!r.ok) throw new Error('เรียก Supabase (contract_submissions) ไม่สำเร็จ (HTTP ' + r.status + ')');
  const rows = await r.json();

  const orders = [];
  rows.forEach(function (row) {
    if (row.imei && row.serial_number) return; // ผ่าน customer_ok ไปแล้ว (แพ็คกิ้งลง IMEI/Serial แล้ว) ไม่ใช่งานของสต๊อคอีกต่อไป
    const session = row.contract_sessions || {};
    const snapshot = session.crm_snapshot || {};
    const items = snapshot.items || [];
    const customer = row.customer_data || snapshot.customer || {};
    items.forEach(function (item) {
      orders.push({
        soNumber: item.soNumber,
        source: 'credit',
        sourceLabel: 'เครดิตผ่าน/วางดาวน์',
        customerId: item.customerId || null,
        customerName: customer.firstLastName || (snapshot.customer && snapshot.customer.firstLastName) || '-',
        product: item.product,
        color: item.color || null,
        recipientName: null, // ยังไม่มีฟิลด์ผู้รับสินค้าแยกต่างหากในฟอร์มลูกค้าปัจจุบัน
        recipientPhone: customer.phone || null,
      });
    });
  });
  return orders;
}

// TODO (2026-09-06): ต่อ CRM จริงเมื่อได้ endpoint list/กรองออเดอร์ทั้งหมดแล้ว (รอ user ส่ง URL/response จาก
// Network tab หน้ารายการสั่งซื้อใน CRM) — กรองด้วยวิธีการผ่อน=ซื้อสด/ผ่อนครบรับของ + สถานะการสั่งซื้อ=สำเร็จ
async function fetchCashOrders() {
  return [];
}

async function handleList(req, res, authHeaders) {
  const customerType = String((req.query && req.query.customerType) || 'all');

  let orders = [];
  if (customerType === 'all' || customerType === 'credit') {
    orders = orders.concat(await fetchCreditOrders(authHeaders));
  }
  if (customerType === 'all' || customerType === 'cash') {
    orders = orders.concat(await fetchCashOrders());
  }

  // ดึงเมทาดาต้าการเบิกของทุก SO ที่เกี่ยวข้องมา join ทีเดียว (กัน N+1 query)
  const soNumbers = orders.map(function (o) { return o.soNumber; }).filter(Boolean);
  let metaBySo = {};
  if (soNumbers.length) {
    const inList = soNumbers.map(function (s) { return encodeURIComponent(s); }).join(',');
    const metaRes = await fetch(
      SUPABASE_URL + '/rest/v1/stock_order_meta?so_number=in.(' + inList + ')',
      { headers: authHeaders }
    );
    if (metaRes.ok) {
      const metaRows = await metaRes.json();
      metaRows.forEach(function (m) { metaBySo[m.so_number] = m; });
    }
  }

  orders = orders.map(function (o) {
    const meta = metaBySo[o.soNumber] || {};
    return Object.assign({}, o, {
      withdrawalRound: meta.withdrawal_round || null,
      printedAt: meta.printed_at || null,
      printedBy: meta.printed_by || null,
      cancelledAt: meta.cancelled_at || null,
      cancelledBy: meta.cancelled_by || null,
      cancelReason: meta.cancel_reason || null,
    });
  });

  // ค้นหาด้วยชื่อ/เลข SO/รหัสลูกค้า (2026-09-06 user ขอ เหมือนระบบ CRM)
  const q = String((req.query && req.query.q) || '').trim().toLowerCase();
  if (q) {
    orders = orders.filter(function (o) {
      return (o.customerName || '').toLowerCase().indexOf(q) !== -1 ||
        (o.soNumber || '').toLowerCase().indexOf(q) !== -1 ||
        (o.customerId || '').toLowerCase().indexOf(q) !== -1;
    });
  }
  const round = String((req.query && req.query.round) || 'all');
  if (round !== 'all') orders = orders.filter(function (o) { return o.withdrawalRound === round; });
  const printStatus = String((req.query && req.query.printStatus) || 'all');
  if (printStatus === 'printed') orders = orders.filter(function (o) { return !!o.printedAt; });
  if (printStatus === 'unprinted') orders = orders.filter(function (o) { return !o.printedAt; });
  const showCancelled = String((req.query && req.query.showCancelled) || 'false') === 'true';
  if (!showCancelled) orders = orders.filter(function (o) { return !o.cancelledAt; });

  res.status(200).json({
    orders: orders,
    cashSourceReady: false, // 2026-09-06 flag ให้ client โชว์ข้อความ "รอเชื่อม CRM" แทนตารางว่างเปล่าเงียบๆ
  });
}

async function upsertMeta(authHeaders, rows) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/stock_order_meta?on_conflict=so_number', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, authHeaders),
    body: JSON.stringify(rows),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error('บันทึกไม่สำเร็จ (HTTP ' + r.status + '): ' + text.slice(0, 300));
  }
}

async function handleUpdate(req, res, authHeaders) {
  const body = req.body || {};
  const action = String(body.action || '');
  const staffName = String(body.staffName || '').trim();
  if (!staffName) { res.status(400).json({ error: 'ไม่มี staffName' }); return; }

  if (action === 'setRound') {
    const soNumbers = Array.isArray(body.soNumbers) ? body.soNumbers : [];
    const round = String(body.round || '').trim();
    if (!soNumbers.length || !round) { res.status(400).json({ error: 'ข้อมูลไม่ครบ (soNumbers/round)' }); return; }
    await upsertMeta(authHeaders, soNumbers.map(function (so) {
      return { so_number: so, withdrawal_round: round, updated_at: new Date().toISOString() };
    }));
    res.status(200).json({ ok: true });
    return;
  }

  if (action === 'markPrinted') {
    const soNumbers = Array.isArray(body.soNumbers) ? body.soNumbers : [];
    if (!soNumbers.length) { res.status(400).json({ error: 'ไม่มี soNumbers' }); return; }
    await upsertMeta(authHeaders, soNumbers.map(function (so) {
      return { so_number: so, printed_at: new Date().toISOString(), printed_by: staffName, updated_at: new Date().toISOString() };
    }));
    res.status(200).json({ ok: true });
    return;
  }

  if (action === 'cancel') {
    const soNumber = String(body.soNumber || '').trim();
    const reason = String(body.reason || '').trim();
    if (!soNumber) { res.status(400).json({ error: 'ไม่มี soNumber' }); return; }
    await upsertMeta(authHeaders, [{
      so_number: soNumber, cancelled_at: new Date().toISOString(), cancelled_by: staffName,
      cancel_reason: reason || null, updated_at: new Date().toISOString(),
    }]);
    res.status(200).json({ ok: true });
    return;
  }

  res.status(400).json({ error: 'ไม่รู้จัก action นี้' });
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({ error: 'ยังไม่ได้ตั้งค่า SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY บน server' });
    return;
  }
  const authHeaders = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY };
  try {
    if (req.method === 'GET') { await handleList(req, res, authHeaders); return; }
    if (req.method === 'POST') { await handleUpdate(req, res, authHeaders); return; }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
