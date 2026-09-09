// "ตรวจสอบสินค้าในคลังว่าพร้อมส่งหรือไม่" (2026-09-07, ออกแบบใหม่รอบ 2026-09-08) — เทียบคำสั่งขายจาก CRM กับ
// สต๊อกคงเหลือจาก Odoo แล้วจัดคิวจองสินค้าตามลำดับความสำคัญที่ user กำหนด:
//   1. ซื้อสด (FULL_PAYMENT) + ผ่อนครบรับของ  2. วางดาวน์ (DOWN_PAYMENT)  3. เครดิตผ่าน (PARTIAL_PAY_THEN_RECEIVE)
// ภายในลำดับเดียวกัน เรียงตามวันที่สั่งซื้อ (orderDate) ก่อน-หลัง (FIFO)
//
// **สต๊อก Odoo อ่านจากตาราง Supabase `odoo_stock_cache`** (sync จากพีซี user ทุก 15 นาที — ดู
// scripts/sync-odoo-stock.js) เพราะ Vercel เข้าถึงเซิร์ฟเวอร์ Odoo ตรงไม่ได้ (ติด firewall จริง ทดสอบแล้ว)
//
// **คำสั่งขาย CRM อ่านจากตาราง Supabase `crm_orders_cache`** (sync จากพีซี user เครื่องเดียวกันทุก 15 นาที)
// ไม่ใช่ยิง CRM สดทุกครั้งอีกต่อไป (2026-09-08 พบว่า CRM มีคำสั่งขายสะสม 89,031 รายการ และ endpoint list ไม่
// รองรับ filter ฝั่ง server เลย (ลอง date/status/pageSize param ต่างๆ แล้วถูกเพิกเฉยหมด) การดึงทั้งหมดสดใช้เวลา
// ~40 วิ เกิน limit ของ Vercel (10 วิ) มาก — ทดสอบจริงแล้วพัง FUNCTION_INVOCATION_TIMEOUT) จึงต้อง sync
// รายการ (เฉพาะฟิลด์จาก list, ไม่รวม productName) เข้า cache ก่อน แล้วให้ **พนักงานเลือกตัวกรอง (ช่วงวันที่
// พร้อมส่ง และ/หรือ สถานะ) ก่อนเสมอ** ค่อย query cache (เร็ว) + ดึง productName เพิ่มเฉพาะรายการที่ผ่านตัวกรอง
// แล้วเท่านั้น (จำกัดจำนวนสูงสุด MAX_FILTERED_ORDERS กันเกิน timeout ซ้ำ — วัดจริงแล้ว 40 order ที่ concurrency 8
// ใช้แค่ ~540ms จึงตั้ง cap ที่ 300 ยังมี margin เหลือเยอะ)
//
// **แก้ไขรอบ 2026-09-09 (ยืนยัน process จริงกับ user แล้ว):** "พร้อมส่ง" ไม่ได้ขึ้นกับ status blacklist
// เดียวกันทุก installmentType — แต่ละแบบมีจุดที่ลูกค้า "ได้รับของ" ต่างกัน:
//   - FULL_PAYMENT (ซื้อสด) และ FULL_PAY_THEN_RECEIVE (ผ่อนครบรับของ/ปิดยอด) → รับของตอน status=COMPLETED
//     (**FULL_PAY_THEN_RECEIVE เป็น installmentType ตัวที่ 4 ที่เพิ่งเจอจริงจากข้อมูล CRM** 11,634 รายการ —
//     ไม่เคยอยู่ใน RESERVATION_PRIORITY เลยมาก่อน ทำให้ 1,215 รายการที่ COMPLETED แล้วตกหล่นจากระบบทั้งหมด
//     ไม่ว่าพนักงานจะติ๊กสถานะไหนก็ตาม เพราะโดนกรองทิ้งตั้งแต่ขั้น installmentType ก่อนถึงขั้นเช็ค status)
//   - DOWN_PAYMENT (วางดาวน์) และ PARTIAL_PAY_THEN_RECEIVE (เครดิตผ่าน) → รับของตอน status=
//     INSTALLMENT_AFTER_CREDIT_APPROVAL (กดอนุมัติเครดิตบน CRM แล้ว) ไม่ใช่ตอน COMPLETED (ตอน COMPLETED
//     คือผ่อนครบพอดี ซึ่งของถูกส่งไปนานแล้วตั้งแต่ตอนอนุมัติเครดิต ไม่ต้องเช็คสต๊อกซ้ำ)
// ดู READY_STATUS_BY_TYPE ด้านล่าง — ยืนยันด้วยการล็อกอิน CRM จริงแล้วเทียบ paymentStatus/status ของตัวอย่างจริง
// หลายเคส (paymentStatus="SUCCESSFUL" ตรงกับ status=COMPLETED เสมอ จึงใช้แค่ status พอไม่ต้องเพิ่มฟิลด์ใหม่)
//
// **ตัวกรองวันที่ "วันที่กลายเป็นพร้อมส่ง" (วันอนุมัติเครดิต/วันปิดยอด) ที่ user ขอ ยังทำไม่ได้จริงในรอบนี้** —
// ลองแล้วพบว่า `updatedAt` (วันที่เปลี่ยนสถานะ) มีเฉพาะใน endpoint รายละเอียดทีละใบ (`/crm/sale-order/{id}`)
// เท่านั้น **endpoint list ที่ใช้ sync ทั้ง 89,197 รายการทุก 15 นาทีไม่มีฟิลด์นี้เลย** (ยืนยันจริงจาก response
// list: มีแค่ orderDate/createdAt) ทำให้ crm_updated_at ในแคชเป็น null ทั้งหมด — ถ้าจะได้ค่าจริงต้องดึงรายละเอียด
// ทีละใบเพิ่ม (89,197 หรืออย่างน้อย ~16,264 ใบที่ status ตรงเงื่อนไขพร้อมส่งอยู่แล้วตอนนี้) ซึ่งจะทำให้ sync
// ช้าขึ้นมากจากที่เป็นอยู่ (~40 วิ) — ยังไม่ได้ถาม user ว่าจะยอมแลกเวลา sync ที่นานขึ้นเพื่อได้ฟิลด์นี้ไหม จึง
// **กลับไปใช้ "วันที่คำสั่งซื้อ" (order_date) เป็นตัวกรองบังคับเหมือนเดิมไปก่อน** (ยัง select crm_updated_at
// ไว้เผื่ออนาคต แต่ตอนนี้จะเป็น null เสมอ ไม่เอาไปโชว์ใน UI จนกว่าจะมีข้อมูลจริง)

const CRM_API_BASE = 'https://api.salmonphone.com';

// รายการสถานะทั้งหมดที่ยืนยันเจอจริง (สำหรับ dropdown ตัวกรองฝั่ง UI)
const ALL_KNOWN_STATUSES = [
  'CANCELLED', 'PENDING_CANCELLATION', 'MISSED_INSTALLMENTS', 'INSTALLMENT_BEFORE_CREDIT_APPROVAL',
  'COMPLETED', 'INSTALLMENT_AFTER_CREDIT_APPROVAL', 'INSTALLMENT_PAUSED_BEFORE_APPROVED',
];

// ลำดับความสำคัญการจองสต๊อก (เลขน้อย = จองก่อน) — ซื้อสด/ผ่อนครบรับของ พร้อมส่งพร้อมกันตั้งแต่รับออเดอร์เสร็จ
// จึงอยู่ลำดับเดียวกัน (เรียง FIFO ด้วยวันที่สั่งซื้อภายในกลุ่มเดียวกันต่อ)
const RESERVATION_PRIORITY = { FULL_PAYMENT: 1, FULL_PAY_THEN_RECEIVE: 1, DOWN_PAYMENT: 2, PARTIAL_PAY_THEN_RECEIVE: 3 };

const INSTALLMENT_TYPE_LABELS = {
  FULL_PAYMENT: 'ซื้อสด', FULL_PAY_THEN_RECEIVE: 'ผ่อนครบรับของ (ปิดยอด)',
  DOWN_PAYMENT: 'วางดาวน์', PARTIAL_PAY_THEN_RECEIVE: 'เครดิตผ่าน (ผ่อนไปใช้ไป)',
};

// สถานะที่แปลว่า "ลูกค้าพร้อมรับของแล้ว" ของแต่ละ installmentType — ยืนยันจาก process จริงกับ user (2026-09-09)
const READY_STATUS_BY_TYPE = {
  FULL_PAYMENT: 'COMPLETED',
  FULL_PAY_THEN_RECEIVE: 'COMPLETED',
  DOWN_PAYMENT: 'INSTALLMENT_AFTER_CREDIT_APPROVAL',
  PARTIAL_PAY_THEN_RECEIVE: 'INSTALLMENT_AFTER_CREDIT_APPROVAL',
};

// กันดึงข้อมูลเยอะเกินไปจนเกิน Vercel timeout ซ้ำ — วัดจริงแล้ว 40 order enrichment (concurrency 8) ใช้แค่
// ~540ms จึงตั้ง cap ที่ 300 ยังมี margin เหลือเยอะสำหรับ CRM login + query cache + network variance จริง
const MAX_FILTERED_ORDERS = 300;

// productName จาก CRM เป็น "...(color Pink)" แต่ product_id[1] จาก Odoo เป็น "...(Pink)" (ไม่มีคำว่า color) —
// ยืนยันความต่างนี้จากข้อมูลจริงทั้ง 2 ฝั่งแล้ว (2026-09-07) ต้อง normalize ก่อนเทียบกันเสมอ
function normalizeProductName(name) {
  return String(name || '')
    .replace(/\(color\s+/i, '(')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

async function crmLoginForStock() {
  const username = process.env.CRM_USERNAME;
  const password = process.env.CRM_PASSWORD;
  if (!username || !password) throw new Error('ยังไม่ได้ตั้งค่า CRM_USERNAME/CRM_PASSWORD บน server');
  const res = await fetch(CRM_API_BASE + '/crm/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json().catch(function () { return null; });
  if (!res.ok || !data || !data.token) throw new Error('ล็อกอิน CRM ไม่สำเร็จ (HTTP ' + res.status + ')');
  return data.token;
}

async function crmGetForStock(path, token) {
  const res = await fetch(CRM_API_BASE + path, { headers: { Authorization: 'Bearer ' + token } });
  const data = await res.json().catch(function () { return null; });
  if (!res.ok) { const err = new Error('CRM API error: ' + res.status); err.status = res.status; throw err; }
  return data;
}

// ดึงคำสั่งขาย "ทั้งหมด" จาก CRM — ใช้เฉพาะจาก scripts/sync-odoo-stock.js (รันจากพีซี user เอง ไม่ได้รันจาก
// Vercel) เพราะ CRM ไม่รองรับ filter ฝั่ง server เลย ต้องดึงทั้งหมดมาก่อนเสมอ (89,031 รายการ ใช้เวลา ~40 วิ
// ตอนทดสอบจริง — เกิน budget ของ Vercel ไปมาก ห้ามเรียกจาก API request handler เด็ดขาด)
async function fetchAllSaleOrdersForSync(token) {
  const res = await fetch(CRM_API_BASE + '/crm/sale-order?page=1&pageSize=200000', {
    headers: { Authorization: 'Bearer ' + token },
  });
  const data = await res.json().catch(function () { return null; });
  if (!res.ok) throw new Error('ดึงรายการคำสั่งขายจาก CRM ไม่สำเร็จ (HTTP ' + res.status + ')');
  return data.saleOrders || [];
}

// เติม productName ให้แต่ละ order ที่ผ่านตัวกรองแล้ว (list ไม่มี field นี้ให้ตรงๆ) จำกัดจำนวนพร้อมกัน กันยิง
// CRM ถี่เกินไป
async function enrichWithProductName(orders, token) {
  const CONCURRENCY = 8;
  const out = orders.slice();
  let idx = 0;
  async function worker() {
    while (idx < out.length) {
      const i = idx++;
      try {
        const detail = await crmGetForStock('/crm/sale-order/' + encodeURIComponent(out[i].saleOrderId), token);
        out[i] = Object.assign({}, out[i], { productName: detail.productName || null });
      } catch (e) {
        out[i] = Object.assign({}, out[i], { productName: null, _detailFetchError: e.message });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, out.length) }, worker));
  return out;
}

// อ่านจากตาราง Supabase odoo_stock_cache (เขียนโดย scripts/sync-odoo-stock.js ที่รันจากพีซี user เอง) แทนการ
// ยิง Odoo ตรง — คืน { stockByProduct, lastSyncedAt } ให้ getStockReadinessFiltered ใช้เตือน UI ถ้าข้อมูลเก่าเกินไป
async function fetchStockByProduct(supabaseUrl, authHeaders) {
  const res = await fetch(supabaseUrl + '/rest/v1/odoo_stock_cache?select=product_name,quantity,updated_at', { headers: authHeaders });
  if (!res.ok) {
    throw new Error('อ่านแคชสต๊อก Odoo จาก Supabase ไม่สำเร็จ (HTTP ' + res.status + ') — ตรวจว่ารัน supabase-odoo-stock-cache.sql แล้วหรือยัง และ scripts/sync-odoo-stock.js เคยรันสำเร็จอย่างน้อย 1 ครั้งหรือยัง');
  }
  const rows = await res.json();
  const stockByProduct = {};
  let lastSyncedAt = null;
  rows.forEach(function (r) {
    const key = normalizeProductName(r.product_name);
    stockByProduct[key] = (stockByProduct[key] || 0) + Number(r.quantity || 0);
    if (!lastSyncedAt || new Date(r.updated_at) > new Date(lastSyncedAt)) lastSyncedAt = r.updated_at;
  });
  return { stockByProduct: stockByProduct, lastSyncedAt: lastSyncedAt };
}

// อ่านจากตาราง Supabase crm_orders_cache ตามตัวกรองที่พนักงานเลือก (orderDateFrom/orderDateTo บังคับเสมอ,
// status ไม่บังคับ) — ขอมาเกิน cap 1 แถวเพื่อรู้ว่าเกิน MAX_FILTERED_ORDERS หรือไม่โดยไม่ต้องนับทั้งหมดก่อน
//
// **บั๊กที่แก้ในรอบนี้ (2026-09-09)**: order_date เป็น timestamptz ที่มีเวลาจริงติดอยู่ (เช่น
// "2025-08-16T12:57:48+00:00") แต่ค่าจาก <input type=date> เป็นวันที่ล้วนๆ (เช่น "2025-08-16") — PostgREST
// ตีความเป็น "2025-08-16T00:00:00" ทำให้ `lte` ตัดรายการที่มีเวลาหลังเที่ยงคืนออกหมด (เท่ากับค้นหาวันเดียวกัน
// from=to ได้ 0 รายการเสมอ ทั้งที่มีข้อมูลจริง) — เติมเวลาสิ้นวัน (23:59:59.999) ให้ orderDateTo ก่อน query เสมอ
function endOfDayIfDateOnly(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value + 'T23:59:59.999' : value;
}
async function fetchCrmOrdersFromCache(supabaseUrl, authHeaders, filters) {
  const params = [
    'select=sale_order_id,status,installment_type,order_date,crm_updated_at,customer_first_name,customer_last_name,synced_at',
    'order_date=gte.' + encodeURIComponent(filters.orderDateFrom),
    'order_date=lte.' + encodeURIComponent(endOfDayIfDateOnly(filters.orderDateTo)),
    'limit=' + (MAX_FILTERED_ORDERS + 1),
  ];
  // filters.status เป็น array ได้แล้ว (2026-09-08 user ขอเลือกได้หลายสถานะพร้อมกัน) — 1 ค่าใช้ eq. เหมือนเดิม
  // มากกว่า 1 ค่าใช้ in.(...) ของ PostgREST
  if (filters.status && filters.status.length) {
    params.push(filters.status.length === 1
      ? 'status=eq.' + encodeURIComponent(filters.status[0])
      : 'status=in.(' + filters.status.map(function (s) { return encodeURIComponent(s); }).join(',') + ')');
  }
  const res = await fetch(supabaseUrl + '/rest/v1/crm_orders_cache?' + params.join('&'), { headers: authHeaders });
  if (!res.ok) {
    throw new Error('อ่านแคชคำสั่งขาย CRM จาก Supabase ไม่สำเร็จ (HTTP ' + res.status + ') — ตรวจว่ารัน supabase-crm-orders-cache.sql แล้วหรือยัง และ scripts/sync-odoo-stock.js เคยรันสำเร็จอย่างน้อย 1 ครั้งหรือยัง');
  }
  return res.json();
}

async function fetchCrmCacheSyncedAt(supabaseUrl, authHeaders) {
  const res = await fetch(supabaseUrl + '/rest/v1/crm_orders_cache?select=synced_at&order=synced_at.desc&limit=1', { headers: authHeaders });
  if (!res.ok) return null;
  const rows = await res.json();
  return (rows[0] && rows[0].synced_at) || null;
}

// จัดคิวจองสต๊อกแบบ greedy ต่อสินค้า 1 ชิ้น — คืน array ใหม่พร้อม field stockReady/queuePosition/odooAvailableQty
function allocateStock(orders, stockByProduct) {
  const byProduct = {};
  orders.forEach(function (o) {
    const key = o._normalizedProduct;
    (byProduct[key] = byProduct[key] || []).push(o);
  });
  const result = [];
  Object.keys(byProduct).forEach(function (key) {
    const group = byProduct[key].slice().sort(function (a, b) {
      const pa = RESERVATION_PRIORITY[a.installmentType] || 99;
      const pb = RESERVATION_PRIORITY[b.installmentType] || 99;
      if (pa !== pb) return pa - pb;
      return new Date(a.orderDate || 0) - new Date(b.orderDate || 0);
    });
    let qty = stockByProduct[key] || 0;
    const startQty = qty;
    group.forEach(function (o, i) {
      const ready = qty > 0;
      if (ready) qty--;
      result.push(Object.assign({}, o, { stockReady: ready, queuePosition: i + 1, odooAvailableQty: startQty }));
    });
  });
  return result;
}

// จุดเข้าหลักที่ api/stock-orders.js เรียกใช้ — filters.orderDateFrom/orderDateTo บังคับเสมอ (กัน query
// กว้างเกินไปจน MAX_FILTERED_ORDERS เกิน), filters.status ไม่บังคับ
async function getStockReadinessFiltered(supabaseUrl, authHeaders, filters) {
  if (!filters || !filters.orderDateFrom || !filters.orderDateTo) {
    throw new Error('ต้องระบุช่วงวันที่คำสั่งซื้อก่อนเสมอ (orderDateFrom/orderDateTo) กันดึงข้อมูลกว้างเกินไป');
  }

  const cached = await fetchCrmOrdersFromCache(supabaseUrl, authHeaders, filters);
  const truncated = cached.length > MAX_FILTERED_ORDERS;
  const candidates = truncated ? cached.slice(0, MAX_FILTERED_ORDERS) : cached;

  if (truncated) {
    return {
      orders: [], shortages: [], matchedCount: cached.length, truncated: true,
      maxFilteredOrders: MAX_FILTERED_ORDERS, stockLastSyncedAt: null, crmLastSyncedAt: null,
    };
  }

  // ถ้าพนักงานไม่ได้เจาะจงสถานะมาเอง (filters.status ว่าง = "ทั้งหมด") ให้ใช้เงื่อนไข "พร้อมส่ง" อัตโนมัติ
  // ตาม installmentType ของแต่ละแถวเอง (ดู READY_STATUS_BY_TYPE ด้านบน) — ถ้าเจาะจงสถานะมาเองถือว่ารู้ตัวว่า
  // เลือกอะไรอยู่แล้ว ไม่ต้องบังคับใช้เงื่อนไขอัตโนมัติซ้อนอีกชั้น
  const relevant = candidates.filter(function (o) {
    if (!RESERVATION_PRIORITY[o.installment_type]) return false;
    if (!filters.status) return o.status === READY_STATUS_BY_TYPE[o.installment_type];
    return true;
  });

  let enriched = [];
  if (relevant.length) {
    const token = await crmLoginForStock();
    const withCamelCase = relevant.map(function (o) {
      return {
        saleOrderId: o.sale_order_id, status: o.status, installmentType: o.installment_type,
        orderDate: o.order_date, crmUpdatedAt: o.crm_updated_at,
        customerFirstName: o.customer_first_name, customerLastName: o.customer_last_name,
      };
    });
    enriched = await enrichWithProductName(withCamelCase, token);
  }

  const withKey = enriched.map(function (o) {
    return Object.assign({}, o, {
      _normalizedProduct: normalizeProductName(o.productName),
      installmentTypeLabel: INSTALLMENT_TYPE_LABELS[o.installmentType] || o.installmentType,
    });
  });

  const [stock, crmLastSyncedAt] = await Promise.all([
    fetchStockByProduct(supabaseUrl, authHeaders),
    fetchCrmCacheSyncedAt(supabaseUrl, authHeaders),
  ]);
  const allocated = allocateStock(withKey, stock.stockByProduct);

  const shortageByProduct = {};
  allocated.forEach(function (o) {
    if (o.stockReady) return;
    const key = o._normalizedProduct;
    if (!shortageByProduct[key]) shortageByProduct[key] = { productName: o.productName, shortCount: 0 };
    shortageByProduct[key].shortCount++;
  });

  return {
    orders: allocated.map(function (o) { const c = Object.assign({}, o); delete c._normalizedProduct; return c; }),
    shortages: Object.keys(shortageByProduct).map(function (k) { return shortageByProduct[k]; }),
    matchedCount: candidates.length,
    relevantCount: relevant.length,
    truncated: false,
    stockLastSyncedAt: stock.lastSyncedAt,
    crmLastSyncedAt: crmLastSyncedAt,
  };
}

module.exports = {
  getStockReadinessFiltered, normalizeProductName, ALL_KNOWN_STATUSES,
  MAX_FILTERED_ORDERS, crmLoginForStock, fetchAllSaleOrdersForSync,
};
