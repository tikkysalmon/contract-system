// "ตรวจสอบสินค้าในคลังว่าพร้อมส่งหรือไม่" (2026-09-07) — ดึงคำสั่งขายที่ต้องใช้สต๊อกจาก CRM ตรงๆ (คนละแหล่ง
// กับ api/stock-orders.js's fetchCreditOrders ที่ดึงเฉพาะ order ที่ผ่านขั้นตอนทำสัญญาในระบบนี้แล้ว — ตัวนี้
// ดึงจาก CRM ทั้งหมดโดยไม่สนว่าลูกค้ากรอกฟอร์ม/เซ็นสัญญาในระบบนี้หรือยัง) เทียบกับสต๊อกคงเหลือจริงใน Odoo
// แล้วจัดคิวจองสินค้าตามลำดับความสำคัญที่ user กำหนด:
//   1. ซื้อสด (FULL_PAYMENT) + ผ่อนครบรับของ  2. วางดาวน์ (DOWN_PAYMENT)  3. เครดิตผ่าน (PARTIAL_PAY_THEN_RECEIVE)
// ภายในลำดับเดียวกัน เรียงตามวันที่สั่งซื้อ (orderDate) ก่อน-หลัง (FIFO)
//
// ⚠️ สร้างจากการแคป Network tab ของ user (2026-09-07) ไม่ได้มีเอกสาร API อย่างเป็นทางการ — จุดที่ยังไม่ยืนยัน
// กับข้อมูลจริง (ตรวจสอบก่อนเชื่อผลลัพธ์ 100%):
//   - GET /crm/sale-order (list) รองรับ pagination หรือไม่/พารามิเตอร์ชื่ออะไร — โค้ดกันไว้แบบ defensive (ดู
//     fetchAllSaleOrders) ลองส่ง page/pageSize ตามแพทเทิร์นที่เห็นจาก endpoint อื่นในระบบเดียวกัน
//   - list ไม่มี field productName ให้ตรงๆ (เห็นแค่ตอนดึงรายละเอียดทีละ SO) จึงต้องดึงรายละเอียดเพิ่มทีละใบ
//     เฉพาะรายการที่ผ่านตัวกรองแล้วเท่านั้น (ไม่ใช่ทุกใบ) กันเรียกมากเกินไป
//   - "ผ่อนครบรับของ" (installment ที่จ่ายครบแล้วรอรับเครื่อง) ยังไม่เจอ enum แยกจาก FULL_PAYMENT ในข้อมูลจริง
//     — สมมติไว้ก่อนว่าจัดลำดับความสำคัญเดียวกับ FULL_PAYMENT (ทั้งคู่คือ "จ่ายเงินครบแล้ว รอแค่ส่งของ")
//   - enum status อื่นที่อาจมีนอกเหนือจาก 5 ตัวที่เจอจริง (MISSED_INSTALLMENTS, CANCELLED,
//     PENDING_CANCELLATION, INSTALLMENT_AFTER_CREDIT_APPROVAL, INSTALLMENT_BEFORE_CREDIT_APPROVAL) — ใช้วิธี
//     "ยกเว้นเฉพาะที่รู้ว่าไม่ต้องใช้สต๊อก" (EXCLUDED_STATUSES) แทนการ include เฉพาะที่รู้จัก กัน enum ใหม่ที่
//     ยังไม่เจอหลุดออกไปโดยไม่ตั้งใจ

const CRM_API_BASE = 'https://api.salmonphone.com';

const EXCLUDED_STATUSES = [
  'CANCELLED', 'PENDING_CANCELLATION', 'MISSED_INSTALLMENTS', 'INSTALLMENT_BEFORE_CREDIT_APPROVAL',
];

// ลำดับความสำคัญการจองสต๊อก (เลขน้อย = จองก่อน) — ค่า enum ยืนยันจาก api/crm-lookup.js's mapPlanType แล้ว
const RESERVATION_PRIORITY = { FULL_PAYMENT: 1, DOWN_PAYMENT: 2, PARTIAL_PAY_THEN_RECEIVE: 3 };

const INSTALLMENT_TYPE_LABELS = {
  FULL_PAYMENT: 'ซื้อสด', DOWN_PAYMENT: 'วางดาวน์', PARTIAL_PAY_THEN_RECEIVE: 'เครดิตผ่าน (ผ่อนไปใช้ไป)',
};

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

// ดึงคำสั่งขายทั้งหมดจาก CRM — ลอง page/pageSize ตามแพทเทิร์นของ endpoint อื่นในระบบเดียวกันก่อน ถ้า response
// ไม่มี field pagination ให้เลย ถือว่าได้ครบในครั้งเดียวไม่ต้องวน (กันสมมติ param ผิดแล้ววนไม่จบ)
async function fetchAllSaleOrders(token) {
  const all = [];
  let page = 1;
  for (;;) {
    const data = await crmGetForStock('/crm/sale-order?page=' + page + '&pageSize=100', token);
    const orders = data.saleOrders || [];
    all.push.apply(all, orders);
    const hasNext = data.pagination && data.pagination.hasNextPage;
    if (!hasNext) break;
    page++;
    if (page > 200) break; // กันวนไม่จบถ้า API ตอบ hasNextPage ผิดพลาด
  }
  return all;
}

function filterRelevantOrders(rawOrders) {
  return rawOrders.filter(function (o) {
    if (EXCLUDED_STATUSES.indexOf(o.status) !== -1) return false;
    if (!RESERVATION_PRIORITY[o.installmentType]) return false; // ตัด installmentType ที่ไม่รู้จัก/ไม่เกี่ยวกับสต๊อกออก
    return true;
  });
}

// เติม productName ให้แต่ละ order ที่ผ่านตัวกรองแล้ว (list ไม่มี field นี้ให้ตรงๆ — ดูหมายเหตุบนไฟล์) จำกัด
// จำนวนพร้อมกัน กันยิง CRM ถี่เกินไปถ้ามีหลายร้อยรายการ
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

async function fetchStockByProduct(odooClient) {
  const groups = await odooClient.readGroup(
    'stock.quant',
    [['location_id.usage', '=', 'internal'], ['quantity', '>', 0]],
    ['product_id', 'quantity:sum'],
    ['product_id']
  );
  const stockByProduct = {};
  groups.forEach(function (g) {
    if (!g.product_id) return;
    const key = normalizeProductName(g.product_id[1]);
    stockByProduct[key] = (stockByProduct[key] || 0) + Number(g.quantity || 0);
  });
  return stockByProduct;
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

async function getStockReadiness(odooClient) {
  const token = await crmLoginForStock();
  const rawOrders = await fetchAllSaleOrders(token);
  const relevant = filterRelevantOrders(rawOrders);
  const enriched = await enrichWithProductName(relevant, token);
  const withKey = enriched.map(function (o) {
    return Object.assign({}, o, {
      _normalizedProduct: normalizeProductName(o.productName),
      installmentTypeLabel: INSTALLMENT_TYPE_LABELS[o.installmentType] || o.installmentType,
    });
  });
  const stockByProduct = await fetchStockByProduct(odooClient);
  const allocated = allocateStock(withKey, stockByProduct);

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
    totalCrmOrders: rawOrders.length,
    relevantOrders: relevant.length,
  };
}

module.exports = { getStockReadiness, normalizeProductName };
