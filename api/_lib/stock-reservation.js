// CRM + Odoo primitives ที่ใช้ร่วมกันสำหรับ "จองคิวสต๊อก" (2026-09-07, ออกแบบใหม่ 2026-09-08, ยุบรวมเข้ากับ
// แท็บ "รายการออเดอร์" เดียว 2026-09-09) — จับคู่คำสั่งขาย CRM กับสต๊อกคงเหลือจาก Odoo แล้วจัดคิวจองสินค้าตาม
// ลำดับความสำคัญที่ user กำหนด:
//   1. ซื้อสด (FULL_PAYMENT) + ผ่อนครบรับของ (FULL_PAY_THEN_RECEIVE)  2. วางดาวน์ (DOWN_PAYMENT)
//   3. เครดิตผ่าน (PARTIAL_PAY_THEN_RECEIVE)
// ภายในลำดับเดียวกัน เรียงตามวันที่สั่งซื้อ (orderDate) ก่อน-หลัง (FIFO) — ดู allocateStock() ด้านล่าง
//
// **เดิมมี 2 แท็บแยกกัน ("รายการออเดอร์" อ่านจาก contract_submissions ของระบบเอง + "ตรวจสอบสินค้าพร้อมส่ง"
// อ่านจาก crm_orders_cache/odoo_stock_cache) ยุบเหลือแท็บเดียวแล้วตามที่ user ยืนยัน 2026-09-09** — ตรรกะ
// จับคู่สินค้า/จัดคิวที่อยู่ในไฟล์นี้ (normalizeProductName/allocateStock/fetchStockByProduct) ใช้ร่วมกันได้เลย
// ไม่ต้องเขียนใหม่ ส่วนที่ประกอบ "รายการออเดอร์" ทั้งฝั่งเครดิต/วางดาวน์ + ซื้อสด/ปิดยอด อยู่ที่ api/stock-orders.js
//
// **สต๊อก Odoo อ่านจากตาราง Supabase `odoo_stock_cache`** (sync จากพีซี user ทุก 15 นาที — ดู
// scripts/sync-stock-readiness.js) เพราะ Vercel เข้าถึงเซิร์ฟเวอร์ Odoo ตรงไม่ได้ (ติด firewall จริง ทดสอบแล้ว)
//
// **คำสั่งขาย CRM (ฝั่งซื้อสด/ปิดยอด) อ่านจากตาราง Supabase `crm_orders_cache`** (sync จากพีซีเครื่องเดียวกัน
// ทุก 15 นาที) ไม่ใช่ยิง CRM สดทุกครั้ง (2026-09-08 พบว่า CRM มีคำสั่งขายสะสม 89,031 รายการ และ endpoint list
// ไม่รองรับ filter ฝั่ง server เลย การดึงทั้งหมดสดใช้เวลา ~40 วิ เกิน limit ของ Vercel (10 วิ) มาก) แล้วดึง
// productName เพิ่มเฉพาะรายการที่ผ่านตัวกรองแล้วเท่านั้น (จำกัดจำนวนสูงสุด MAX_FILTERED_ORDERS กันเกิน timeout
// ซ้ำ — วัดจริงแล้ว 40 order ที่ concurrency 8 ใช้แค่ ~540ms จึงตั้ง cap ที่ 300 ยังมี margin เหลือเยอะ)
//
// **แก้ไขรอบ 2026-09-09 (ยืนยัน process จริงกับ user แล้ว):** "พร้อมส่ง" ไม่ได้ขึ้นกับ status blacklist
// เดียวกันทุก installmentType — แต่ละแบบมีจุดที่ลูกค้า "ได้รับของ" ต่างกัน:
//   - FULL_PAYMENT (ซื้อสด) และ FULL_PAY_THEN_RECEIVE (ผ่อนครบรับของ/ปิดยอด) → รับของตอน status=COMPLETED
//     (**FULL_PAY_THEN_RECEIVE เป็น installmentType ตัวที่ 4 ที่เพิ่งเจอจริงจากข้อมูล CRM** 11,634 รายการ —
//     ไม่เคยอยู่ใน RESERVATION_PRIORITY เลยมาก่อน ทำให้รายการที่ COMPLETED แล้วตกหล่นจากระบบทั้งหมด)
//   - DOWN_PAYMENT (วางดาวน์) และ PARTIAL_PAY_THEN_RECEIVE (เครดิตผ่าน) → รับของตอน status=
//     INSTALLMENT_AFTER_CREDIT_APPROVAL (กดอนุมัติเครดิตบน CRM แล้ว) ไม่ใช่ตอน COMPLETED (ตอน COMPLETED
//     คือผ่อนครบพอดี ซึ่งของถูกส่งไปนานแล้วตั้งแต่ตอนอนุมัติเครดิต ไม่ต้องเช็คสต๊อกซ้ำ)
// ดู READY_STATUS_BY_TYPE ด้านล่าง — ยืนยันด้วยการล็อกอิน CRM จริงแล้วเทียบ paymentStatus/status ของตัวอย่างจริง
// หลายเคส (paymentStatus="SUCCESSFUL" ตรงกับ status=COMPLETED เสมอ จึงใช้แค่ status พอไม่ต้องเพิ่มฟิลด์ใหม่)
//
// **ตัวกรองวันที่ "วันที่กลายเป็นพร้อมส่ง" (วันอนุมัติเครดิต/วันปิดยอด) ที่ user เคยขอ ยังทำไม่ได้จริง** —
// ลองแล้วพบว่า `updatedAt` (วันที่เปลี่ยนสถานะ) มีเฉพาะใน endpoint รายละเอียดทีละใบ (`/crm/sale-order/{id}`)
// เท่านั้น endpoint list ที่ใช้ sync ทั้ง 89,197 รายการทุก 15 นาทีไม่มีฟิลด์นี้เลย (มีแค่ orderDate/createdAt)
// ถ้าจะได้ค่าจริงต้องดึงรายละเอียดทีละใบเพิ่มอีกหลายพันใบ ทำให้ sync ช้าขึ้นมาก — ยังคงใช้ order_date แทนไปก่อน

const CRM_API_BASE = 'https://api.salmonphone.com';

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

// แยก productName ดิบจาก CRM ("...(color X)") ออกเป็น product/color — เหมือนกับที่ api/crm-lookup.js ใช้
// (ก็อปมาเพราะ crm-lookup.js ไม่ได้ export ฟังก์ชันนี้ไว้ ไม่อยากแก้ไฟล์นั้นเพิ่มเพื่อเรื่องนี้อย่างเดียว)
function splitProductName(productName) {
  const m = /^(.*?)\s*\(color\s+(.+)\)\s*$/i.exec(String(productName || ''));
  if (m) return { product: m[1].trim(), color: m[2].trim() };
  return { product: String(productName || ''), color: '' };
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

// ดึงคำสั่งขาย "ทั้งหมด" จาก CRM — ใช้เฉพาะจาก scripts/sync-stock-readiness.js (รันจากพีซี user เอง ไม่ได้รันจาก
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

// อ่านจากตาราง Supabase odoo_stock_cache (เขียนโดย scripts/sync-stock-readiness.js ที่รันจากพีซี user เอง)
// แทนการยิง Odoo ตรง — คืน { stockByProduct, lastSyncedAt } ให้หน้าเว็บใช้เตือนถ้าข้อมูลเก่าเกินไป
async function fetchStockByProduct(supabaseUrl, authHeaders) {
  const res = await fetch(supabaseUrl + '/rest/v1/odoo_stock_cache?select=product_name,quantity,updated_at', { headers: authHeaders });
  if (!res.ok) {
    throw new Error('อ่านแคชสต๊อก Odoo จาก Supabase ไม่สำเร็จ (HTTP ' + res.status + ') — ตรวจว่ารัน supabase-odoo-stock-cache.sql แล้วหรือยัง และ scripts/sync-stock-readiness.js เคยรันสำเร็จอย่างน้อย 1 ครั้งหรือยัง');
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

async function fetchCrmCacheSyncedAt(supabaseUrl, authHeaders) {
  const res = await fetch(supabaseUrl + '/rest/v1/crm_orders_cache?select=synced_at&order=synced_at.desc&limit=1', { headers: authHeaders });
  if (!res.ok) return null;
  const rows = await res.json();
  return (rows[0] && rows[0].synced_at) || null;
}

// จัดคิวจองสต๊อกแบบ greedy ต่อสินค้า 1 ชิ้น — รับ order ที่มี _normalizedProduct/installmentType/orderDate
// ครบทุกตัวแล้ว (ไม่ว่าจะมาจากฝั่งเครดิต/วางดาวน์ หรือฝั่งซื้อสด/ปิดยอด) คืน array ใหม่พร้อม field
// stockReady/queuePosition/odooAvailableQty
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

module.exports = {
  normalizeProductName, splitProductName, allocateStock, fetchStockByProduct, fetchCrmCacheSyncedAt,
  enrichWithProductName, crmLoginForStock, fetchAllSaleOrdersForSync,
  RESERVATION_PRIORITY, INSTALLMENT_TYPE_LABELS, READY_STATUS_BY_TYPE, MAX_FILTERED_ORDERS,
};
