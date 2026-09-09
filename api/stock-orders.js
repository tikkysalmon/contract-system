// Vercel serverless function — เมนู "สำหรับสต๊อค" (2026-09-06, ยุบรวมกับแท็บ "ตรวจสอบสินค้าพร้อมส่ง" เดิม
// เข้าเป็นแท็บเดียว 2026-09-09 ตามที่ user ยืนยัน) แทนที่ Lark Base เดิม (ดู ระบบจัดการออเดอร์.tsx ที่ user
// ส่งมาอ้างอิง UI/PDF เดิม) รวม stock-orders-list.js + stock-order-update.js เดิมไว้ในไฟล์เดียว (ลดจำนวน
// serverless function ทั้งโปรเจกต์ — Vercel Hobby plan จำกัดไว้แค่ 12 ฟังก์ชัน/deployment เกินแล้ว deploy
// ล้มเงียบๆ เจอบั๊กจริง 2026-09-06 ตอนเพิ่มเมนูนี้ deploy พังเพราะเกินโควต้าพอดี)
//
// GET  ?customerType=all|credit|cash&q=&round=&printStatus=all|printed|unprinted&showCancelled=true|false
//   รวม 2 แหล่งข้อมูล แล้วจับคู่กับสต๊อก Odoo จัดคิวให้ทุกแถวด้วย (ดู _lib/stock-reservation.js):
//   1. "เครดิตผ่าน/วางดาวน์" — ดึงสดจาก contract_submissions ของระบบนี้เอง เฉพาะที่สถานะการทำสัญญา (คำนวณด้วย
//      computeContractStatus() ตัวเดียวกับเมนู "ข้อมูลลูกค้าทำสัญญา" — ดู _lib/contract-status.js) =
//      "สัญญาลูกค้าเรียบร้อย" (customer_ok) เท่านั้น ถึงจะเบิกสินค้าได้ ไม่ copy ข้อมูลซ้ำ อ่านสดทุกครั้ง — เติม orderDate/
//      installmentType ที่ contract_submissions ไม่มีเก็บเองด้วยการ join กับ crm_orders_cache ด้วย SO number
//      (แคชที่ sync ไว้แล้วทุก 15 นาที ไม่ต้องยิง CRM สดเพิ่ม)
//   2. "ซื้อสด/ปิดยอด" — ต่อกับ crm_orders_cache จริงแล้ว (2026-09-09 — เดิมเป็น TODO คืน [] ตลอด) กรอง
//      installmentType FULL_PAYMENT/FULL_PAY_THEN_RECEIVE ที่ status=COMPLETED (พร้อมส่งแล้ว) **แต่ไม่มีทาง
//      รู้ว่า "แพ็คไปแล้วหรือยัง" เหมือนฝั่งเครดิต (ไม่มี imei/serial tracking ให้ฝั่งซื้อสดเลย เพราะไม่ผ่านระบบ
//      ทำสัญญา)** จึงต้องพึ่งช่วงวันที่สั่งซื้อย้อนหลังแทน (ดู CASH_ORDERS_LOOKBACK_DAYS) — ออเดอร์ที่ปิดยอดแล้ว
//      แต่เก่ากว่าช่วงนี้จะไม่โผล่ในลิสต์
//   ทั้ง 2 แหล่ง join กับ stock_order_meta (เมทาดาต้าการเบิกที่ระบบนี้เป็นเจ้าของเอง) ด้วย so_number
//
// POST { action: 'setRound'|'markPrinted'|'cancel', ... } อัปเดต stock_order_meta (ดู handler ด้านล่าง)
//
// ต้องรัน supabase-stock-orders.sql ก่อนใช้งาน (ตาราง stock_order_meta)
// ต้องตั้งค่าใน Vercel project settings: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRM_USERNAME, CRM_PASSWORD

const {
  splitProductName, normalizeProductName, allocateStock, fetchStockByProduct, fetchCrmCacheSyncedAt,
  enrichWithProductName, crmLoginForStock, MAX_FILTERED_ORDERS,
} = require('./_lib/stock-reservation');
const { computeContractStatus } = require('./_lib/contract-status');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ดึงเฉพาะ order_date/installment_type ของ SO ที่ระบุจากแคช crm_orders_cache (query เดียว ไม่ยิง CRM สด) —
// ใช้เติมให้ฝั่งเครดิต/วางดาวน์ ที่ item ใน crm_snapshot.items[] ไม่มี 2 ฟิลด์นี้เก็บไว้เอง (ดู create-session.js)
async function fetchCrmCacheFieldsForSoNumbers(authHeaders, soNumbers) {
  if (!soNumbers.length) return {};
  const inList = soNumbers.map(function (s) { return encodeURIComponent(s); }).join(',');
  const res = await fetch(
    SUPABASE_URL + '/rest/v1/crm_orders_cache?select=sale_order_id,order_date,installment_type&sale_order_id=in.(' + inList + ')',
    { headers: authHeaders }
  );
  if (!res.ok) throw new Error('อ่านแคชคำสั่งขาย CRM (เติมวันที่สั่งซื้อ) ไม่สำเร็จ (HTTP ' + res.status + ')');
  const rows = await res.json();
  const bySo = {};
  rows.forEach(function (r) { bySo[r.sale_order_id] = r; });
  return bySo;
}

async function fetchCreditOrders(authHeaders) {
  // reviewed_at ไม่ null + rejected_at เป็น null เป็นแค่ prefilter ฝั่ง server กันดึงข้อมูลเยอะเกินจำเป็น
  // (ตัด "สัญญาไม่เรียบร้อย"/"รอตรวจสอบ" ออกก่อน) — ตัวตัดสิน "พร้อมเบิกจริง" (customer_ok) ใช้
  // computeContractStatus() ตัวเดียวกับเมนู "ข้อมูลลูกค้าทำสัญญา" (_lib/contract-status.js) เสมอ ไม่เขียน
  // เงื่อนไขซ้ำเอง กัน 2 ที่หลุดไม่ตรงกัน (2026-09-09 user ยืนยันให้ใช้แหล่งเดียวกัน)
  const r = await fetch(
    SUPABASE_URL + '/rest/v1/contract_submissions' +
      '?select=id,customer_data,imei,serial_number,reviewed_at,rejected_at,staff_signed_at,contract_sessions(token,so_number,crm_snapshot)' +
      '&reviewed_at=not.is.null&rejected_at=is.null',
    { headers: authHeaders }
  );
  if (!r.ok) throw new Error('เรียก Supabase (contract_submissions) ไม่สำเร็จ (HTTP ' + r.status + ')');
  const rows = await r.json();

  const orders = [];
  rows.forEach(function (row) {
    const contractStatus = computeContractStatus({
      submitted: true, rejectedAt: row.rejected_at, reviewedAt: row.reviewed_at,
      staffSignedAt: row.staff_signed_at, imei: row.imei, serialNumber: row.serial_number,
    });
    if (contractStatus.key !== 'customer_ok') return; // ยังไม่ถึงขั้น "สัญญาลูกค้าเรียบร้อย" เบิกสินค้าไม่ได้
    const session = row.contract_sessions || {};
    const snapshot = session.crm_snapshot || {};
    const items = snapshot.items || [];
    const customer = row.customer_data || snapshot.customer || {};
    // ที่อยู่จัดส่ง (2026-09-07 เพิ่มเพื่อ export ไฟล์ Excel นำเข้า MyOrder — ดู myorder-export.js) — ใช้
    // shippingAddress ถ้าลูกค้าระบุไว้ไม่เหมือนที่อยู่ปัจจุบัน ไม่งั้น fallback ไปที่อยู่ปัจจุบัน (address)
    var addr = (customer.shippingAddress && !customer.shippingAddress.sameAsCurrent)
      ? customer.shippingAddress
      : (customer.address || {});
    items.forEach(function (item) {
      orders.push({
        soNumber: item.soNumber,
        contractNo: item.contractNo || null,
        source: 'credit',
        sourceLabel: 'เครดิตผ่าน/วางดาวน์',
        contractStatus: contractStatus,
        customerId: item.customerId || null,
        customerName: customer.firstLastName || (snapshot.customer && snapshot.customer.firstLastName) || '-',
        product: item.product,
        color: item.color || null,
        recipientName: null, // ยังไม่มีฟิลด์ผู้รับสินค้าแยกต่างหากในฟอร์มลูกค้าปัจจุบัน
        recipientPhone: customer.phone || null,
        shippingAddress: {
          detail: addr.detail || null,
          subdistrictName: addr.subdistrictName || null,
          districtName: addr.districtName || null,
          provinceName: addr.provinceName || null,
          zip: addr.zip || null,
        },
      });
    });
  });

  // เติม orderDate/installmentType จาก crm_orders_cache (join ด้วย SO number) — ใช้จัดคิวสต๊อกร่วมกับฝั่ง
  // ซื้อสด/ปิดยอดได้ ถ้า SO ไหนยังไม่เจอในแคช (เพิ่งสร้างใหม่ ยังไม่ครบรอบ sync 15 นาที) fallback เป็น
  // DOWN_PAYMENT/PARTIAL_PAY_THEN_RECEIVE ตาม planType ที่มีอยู่แล้วในตัว item ไม่ให้ตกคิวไปเฉยๆ
  const soNumbers = orders.map(function (o) { return o.soNumber; }).filter(Boolean);
  const crmFieldsBySo = await fetchCrmCacheFieldsForSoNumbers(authHeaders, soNumbers);
  return orders.map(function (o) {
    const cached = crmFieldsBySo[o.soNumber];
    return Object.assign({}, o, {
      orderDate: cached ? cached.order_date : null,
      installmentType: cached ? cached.installment_type : null,
    });
  });
}

// ย้อนหลังกี่วันสำหรับดึงฝั่ง "ซื้อสด/ปิดยอด" จาก CRM cache — ไม่มีทางรู้ว่าออเดอร์ไหน "แพ็คไปแล้ว" เหมือนฝั่ง
// เครดิต (ไม่มี imei/serial tracking ให้ฝั่งซื้อสดเลย เพราะไม่ผ่านระบบทำสัญญา) จึงต้องพึ่งช่วงวันที่แทน — ทดสอบ
// จริงกับข้อมูล CRM แล้ว (2026-09-09): ย้อนหลัง 30 วัน = ~246 รายการที่ COMPLETED (ยังอยู่ใน MAX_FILTERED_ORDERS
// =300) ย้อนหลัง 45 วันขึ้นไปเกิน cap แล้ว — ออเดอร์ที่ปิดยอดแล้วแต่เก่ากว่า 30 วันจะไม่โผล่ในลิสต์นี้
const CASH_ORDERS_LOOKBACK_DAYS = 30;

async function fetchCashOrders(authHeaders) {
  const cutoff = new Date(Date.now() - CASH_ORDERS_LOOKBACK_DAYS * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const params = [
    'select=sale_order_id,order_date,installment_type,customer_first_name,customer_last_name',
    'installment_type=in.(FULL_PAYMENT,FULL_PAY_THEN_RECEIVE)',
    'status=eq.COMPLETED',
    'order_date=gte.' + cutoff,
    'limit=' + (MAX_FILTERED_ORDERS + 1),
  ];
  const authHeadersLocal = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY };
  const res = await fetch(SUPABASE_URL + '/rest/v1/crm_orders_cache?' + params.join('&'), { headers: authHeadersLocal });
  if (!res.ok) throw new Error('อ่านแคชคำสั่งขาย CRM (ฝั่งซื้อสด/ปิดยอด) ไม่สำเร็จ (HTTP ' + res.status + ')');
  const rows = await res.json();
  const truncated = rows.length > MAX_FILTERED_ORDERS;
  const candidates = truncated ? rows.slice(0, MAX_FILTERED_ORDERS) : rows;
  if (!candidates.length) return { orders: [], truncated: truncated, matchedCount: rows.length };

  const token = await crmLoginForStock();
  const withCamelCase = candidates.map(function (o) {
    return {
      saleOrderId: o.sale_order_id, orderDate: o.order_date, installmentType: o.installment_type,
      customerFirstName: o.customer_first_name, customerLastName: o.customer_last_name,
    };
  });
  const enriched = await enrichWithProductName(withCamelCase, token);

  const orders = enriched.map(function (o) {
    const parts = splitProductName(o.productName);
    return {
      soNumber: o.saleOrderId,
      contractNo: null,
      source: 'cash',
      sourceLabel: 'ซื้อสด/ปิดยอด',
      contractStatus: null, // ไม่ผ่านระบบทำสัญญา ไม่มีสถานะนี้ให้แสดง (ดู stock-tab.js's contractStatusBadge)
      customerId: null,
      customerName: ((o.customerFirstName || '') + ' ' + (o.customerLastName || '')).trim() || '-',
      product: parts.product,
      color: parts.color || null,
      recipientName: null,
      recipientPhone: null,
      shippingAddress: null,
      orderDate: o.orderDate,
      installmentType: o.installmentType,
    };
  });
  return { orders: orders, truncated: truncated, matchedCount: rows.length };
}

async function handleList(req, res, authHeaders) {
  const customerType = String((req.query && req.query.customerType) || 'all');

  let orders = [];
  let cashTruncated = false;
  let cashMatchedCount = 0;
  if (customerType === 'all' || customerType === 'credit') {
    orders = orders.concat(await fetchCreditOrders(authHeaders));
  }
  if (customerType === 'all' || customerType === 'cash') {
    const cashResult = await fetchCashOrders(authHeaders);
    orders = orders.concat(cashResult.orders);
    cashTruncated = cashResult.truncated;
    cashMatchedCount = cashResult.matchedCount;
  }

  // จับคู่กับสต๊อก Odoo + จัดคิวตามลำดับความสำคัญ (ดู _lib/stock-reservation.js) — ทำก่อน join
  // stock_order_meta/กรองอื่นๆ เพราะคิวต้องคำนวณจาก "ทุกออเดอร์ที่ต้องใช้สต๊อกจริง" ไม่ใช่แค่ที่กรองแล้ว
  const withKey = orders.map(function (o) {
    return Object.assign({}, o, { _normalizedProduct: normalizeProductName(o.product + (o.color ? ' (' + o.color + ')' : '')) });
  });
  const [stock, crmLastSyncedAt] = await Promise.all([
    fetchStockByProduct(SUPABASE_URL, authHeaders),
    fetchCrmCacheSyncedAt(SUPABASE_URL, authHeaders),
  ]);
  const allocated = allocateStock(withKey, stock.stockByProduct).map(function (o) {
    const c = Object.assign({}, o);
    delete c._normalizedProduct;
    return c;
  });
  orders = allocated;

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
    cashSourceReady: true,
    cashOrdersLookbackDays: CASH_ORDERS_LOOKBACK_DAYS,
    cashTruncated: cashTruncated,
    cashMatchedCount: cashMatchedCount,
    stockLastSyncedAt: stock.lastSyncedAt,
    crmLastSyncedAt: crmLastSyncedAt,
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
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      res.status(500).json({ error: 'ยังไม่ได้ตั้งค่า SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY บน server' });
      return;
    }
    const authHeaders = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY };
    if (req.method === 'GET') { await handleList(req, res, authHeaders); return; }
    if (req.method === 'POST') { await handleUpdate(req, res, authHeaders); return; }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
