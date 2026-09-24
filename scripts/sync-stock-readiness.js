#!/usr/bin/env node
// สคริปต์ sync ข้อมูลที่ต้องใช้กับฟีเจอร์ "ตรวจสอบสินค้าพร้อมส่ง" เข้า Supabase — รันจากพีซี user เอง (ผ่าน
// Windows Task Scheduler ทุก 15 นาทีตามที่ user ขอ 2026-09-07) เพราะเว็บ (Vercel) เข้าถึงทั้ง 2 ระบบนี้สดๆ
// ไม่ได้เลย:
//   1. Odoo (สต๊อกคงเหลือ) — ติด firewall เซิร์ฟเวอร์ Odoo ยิงจาก Vercel ทดสอบจริงแล้วค้าง 90 วิไม่ตอบ
//   2. CRM (คำสั่งขาย) — ไม่ใช่ปัญหา firewall แต่มีคำสั่งขายสะสม 89,031 รายการ (2026-09-08) และ endpoint list
//      ไม่รองรับ filter ฝั่ง server เลย (ลอง date/status/pageSize param ต่างๆ แล้วถูกเพิกเฉยหมด) การดึงทั้งหมด
//      สดใช้เวลา ~40 วิ เกิน limit ของ Vercel (10 วิ) มาก ทดสอบจริงแล้วพัง FUNCTION_INVOCATION_TIMEOUT
// (ชื่อไฟล์เดิมคือ sync-odoo-stock.js — เปลี่ยนชื่อรอบนี้เพราะ sync มากกว่าแค่ Odoo แล้ว)
//
// ใช้: node scripts/sync-stock-readiness.js
// ต้องมีไฟล์ scripts/.env ก่อน (คัดลอกจาก scripts/.env.example แล้วกรอกค่าจริง — ไฟล์ .env ห้าม commit
// ขึ้น git เด็ดขาด อยู่ในเครื่อง user เท่านั้น) ต้องมี CRM_USERNAME/CRM_PASSWORD เพิ่มจากรอบก่อน (ค่าเดียวกับที่
// ตั้งไว้ใน Vercel project settings)
//
// ล้างตารางทั้ง 2 ทิ้งทุกครั้งก่อนเขียนชุดใหม่ทั้งหมด (กันแถวค้าง)

const fs = require('fs');
const path = require('path');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  content.split('\n').forEach(function (line) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.indexOf('#') === 0) return;
    const idx = trimmed.indexOf('=');
    if (idx === -1) return;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') ||
      (value.charAt(0) === "'" && value.charAt(value.length - 1) === "'")) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  });
}
loadEnvFile(path.join(__dirname, '.env'));

const { getOdooClientFromEnv } = require('../api/_lib/odoo-xmlrpc');
const { crmLoginForStock, fetchAllSaleOrdersForSync } = require('../api/_lib/stock-reservation');

function log(msg) { console.log('[' + new Date().toISOString() + '] ' + msg); }

// แบ่งเขียนเป็นก้อนเล็กๆ กันคำขอ HTTP ใหญ่เกินไป/timeout ฝั่ง Supabase (89,031 แถวในคำขอเดียวเสี่ยงเกินไป)
async function chunkedInsert(supabaseUrl, authHeaders, table, rows, chunkSize) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const res = await fetch(supabaseUrl + '/rest/v1/' + table, {
      method: 'POST',
      headers: Object.assign({ Prefer: 'return=minimal' }, authHeaders),
      body: JSON.stringify(chunk),
    });
    if (!res.ok) throw new Error('บันทึกข้อมูลชุดที่ ' + (i / chunkSize + 1) + ' ลง ' + table + ' ไม่สำเร็จ (HTTP ' + res.status + '): ' + (await res.text()).slice(0, 300));
  }
}

// 2026-09-08 user ขอให้นับเฉพาะคลัง "คลังสินค้า" คลังเดียว (เดิมนับทุก location ที่เป็น internal type รวม
// คลังย่อยอื่นๆ ด้วย เช่น คลังซ่อม/คลังของแถม/คลังสินค้าตัวอย่าง ซึ่งไม่ใช่สต๊อกที่ขายลูกค้าได้จริง)
//
// รอบแรกลอง filter ด้วย location_id.name = 'คลังสินค้า' ตรงๆ แล้วรันจริงได้ 0 รายการ — debug พบว่า
// "คลังสินค้า" เป็นชื่อ **คลัง (stock.warehouse)** ไม่ใช่ชื่อ location โดยตรง location เก็บสต๊อกจริงของคลังนี้
// ชื่อ "WH/Stock" (WH = รหัสคลัง, "Stock" มาจาก default ของ Odoo ไม่ได้เปลี่ยนเป็นภาษาไทย) — แก้เป็นค้นหา
// stock.warehouse ด้วยชื่อก่อน แล้วดึง lot_stock_id (location เก็บสต๊อกของคลังนั้น) มาใช้กรอง stock.quant ด้วย
// child_of แทน (ครอบคลุม location ย่อยใต้ WH/Stock ด้วยถ้ามีการแบ่ง shelf/bin เพิ่มในอนาคต) — ทดสอบจริงแล้ว
// เจอคลัง "คลังสินค้า" รหัส WH, lot_stock_id = WH/Stock (id 8) ตรงกับ location ที่มี stock.quant จริง
const WAREHOUSE_NAME = 'คลังสินค้า';

// 2026-09-08 user แจ้งว่า "Salmon Mobile Care" ไม่ใช่สินค้าจับต้องได้ แต่เป็นบริการ (ประกันมือถือ) ไม่มี
// stock.quant ให้ sync เลยอยู่แล้ว (type='service' ใน Odoo ไม่ผูกกับคลังสินค้า) ทำให้หน้า "ตรวจสอบสินค้าพร้อม
// ส่ง" เข้าใจผิดว่าสต๊อก=0 แล้วขึ้น "รอสต๊อก" ทั้งที่ไม่ต้องรอสต๊อกเลย — sync รายการ type='service' เข้า
// odoo_stock_cache ด้วย ใส่ยอดปลอมสูงมากๆ (SERVICE_SENTINEL_QTY) แทนยอดจริง เพื่อให้ allocateStock()
// (stock-reservation.js) ที่หักลบจากยอดนี้ไม่มีวันหมด/ไม่ต้องเข้าคิวรอเลย — ไม่ได้เพิ่มตารางใหม่ ใช้ตารางเดิม
// ตรงๆ ง่ายกว่า (บริการไม่มีทางไปปนกับสินค้าจริงอยู่แล้วเพราะคนละกลไกกัน ไม่มี stock.quant ของบริการ)
const SERVICE_SENTINEL_QTY = 999999;

async function getWarehouseStockLocationId(odoo, warehouseName) {
  const warehouses = await odoo.searchRead('stock.warehouse', [['name', '=', warehouseName]], ['id', 'name', 'lot_stock_id']);
  if (!warehouses.length) throw new Error('ไม่พบคลังชื่อ "' + warehouseName + '" ใน Odoo (stock.warehouse) — เช็คชื่อคลังให้ตรงกับที่ตั้งไว้จริง');
  return warehouses[0].lot_stock_id[0];
}

async function fetchServiceProductRows(odoo, now) {
  const services = await odoo.searchRead('product.product', [['type', '=', 'service']], ['name']);
  return services.map(function (p) { return { product_name: p.name, quantity: SERVICE_SENTINEL_QTY, updated_at: now }; });
}

async function syncOdooStock(supabaseUrl, authHeaders) {
  log('เชื่อมต่อ Odoo แล้วดึงสต๊อกคงเหลือ (เฉพาะคลัง "' + WAREHOUSE_NAME + '")...');
  const odoo = getOdooClientFromEnv();
  const stockLocationId = await getWarehouseStockLocationId(odoo, WAREHOUSE_NAME);
  // 2026-09-08 แก้บั๊กจริงที่ user เจอ (ยอดเราแสดง 16 แต่ Odoo แสดง 15 สำหรับ Adapter 20W (หัวกลม)) — เดิม
  // filter ['quantity', '>', 0] ที่ระดับ quant ก่อน sum ทำให้ quant ที่มีค่าติดลบ (รายการปรับปรุงสต๊อก เช่น
  // quant_id 11013 quantity=-1 ของ Adapter 20W) ถูกตัดออกจากผลรวมไปเลย แทนที่จะถูกนับหักลบตามจริง (16 ก้อน
  // +1 กับ 1 ก้อน -1 = ยอดจริง 15 แต่ filter ตัด -1 ทิ้งก่อน sum เหลือแค่ 16) — ย้าย filter ไปเช็คหลัง sum แล้ว
  // แทน (เอาเฉพาะสินค้าที่ยอดสุทธิ > 0 ไปแสดง แต่ตัวยอดสุทธิเองต้องรวม quant ติดลบเข้าไปด้วยเสมอ)
  // 2026-09-24 user แจ้งว่ายอดที่ sync มาแสดง "มากกว่าที่ขายได้จริง" เพราะยอด quantity (on-hand) นับรวม
  // เครื่อง/ชิ้นที่ถูกจองให้ใบสั่งขายอื่นในระบบ Odoo เอง (reserved_quantity) ไปด้วย ทั้งที่ของนั้นพร้อมอยู่บน
  // ชั้นจริงแต่ถูก "กันไว้" ให้ลูกค้าคนอื่นแล้ว — user ขอให้ยึดยอดจริงจากหน้า "ล็อต/หมายเลขซีเรียล" แทน (นับ
  // เป็นจำนวนเครื่อง ไม่ต้อง list ซีเรียล) ลองสูตร sum(quantity)-sum(reserved_quantity) ต่อสินค้าไปรอบแรก
  // (readGroup) แล้ว **พบว่าให้ผลลัพธ์ผิดจริงในบางเคส**: ตรวจ Odoo จริงเจอ product "Apple iPhone 15 128GB
  // (Black)" มี quant ค้าง 5 แถวที่ quantity=0 แต่ reserved_quantity=1/2 (ซีเรียลที่ย้าย/ตัดจ่ายไปแล้วแต่ field
  // reserved ไม่ถูกเคลียร์) ทำให้ sum(reserved) ที่ระดับสินค้าสูงเกิน sum(quantity) ของสินค้านั้นทั้งก้อน — ถ้ามี
  // ซีเรียลอื่นของสินค้าเดียวกันที่ว่างจริง (reserved=0) การหักลบแบบรวมยอดจะทำให้ซีเรียลที่ว่างจริงนั้น "หายไป"
  // ในผลรวมด้วย (เคสทดสอบนี้บังเอิญไม่เกิดเพราะสินค้าตัวนี้ถูกจองครบทุกซีเรียลพอดี แต่ในสินค้าอื่นจะพลาดได้)
  //
  // **แก้ให้ถูกต้องจริง**: ดึง quant แบบ row-level (ไม่ group รวม) แล้วคำนวณแยกเป็น 2 กลุ่มตามการ track ของสินค้า:
  //  - สินค้า track ล็อต/ซีเรียล (`lot_id` ไม่ว่าง): นับอิสระต่อ 1 ซีเรียล free = max(0, quantity-reserved)
  //    แล้วค่อยรวมของทุกซีเรียลของสินค้านั้น — กันไม่ให้ quant ค้าง (quantity=0,reserved>0) ของซีเรียลหนึ่ง
  //    ไปหักลบยอดของซีเรียลอื่นที่ว่างจริงในสินค้าเดียวกัน (นี่คือข้อมูลชุดเดียวกับหน้า "ล็อต/หมายเลขซีเรียล")
  //  - สินค้าไม่ track ล็อต (accessory ทั่วไป): ยังคงรวมยอดสุทธิระดับสินค้าเหมือนเดิม (quantity-reserved รวมกัน
  //    ทั้งหมดก่อน) เพราะ correction quant ติดลบที่ไม่มี lot (เช่นบั๊ก Adapter 20W เดิมด้านบน) เป็นการปรับยอด
  //    รวมของสต๊อกกองเดียวกัน ไม่ใช่หน่วยที่แยกจากกันแบบซีเรียล ต้องหักลบกันจึงจะได้ยอดสุทธิถูกต้อง
  const quants = await odoo.searchRead(
    'stock.quant',
    [['location_id', 'child_of', stockLocationId]],
    ['product_id', 'lot_id', 'quantity', 'reserved_quantity']
  );
  const freeByProduct = {};
  quants.forEach(function (q) {
    if (!q.product_id) return;
    const pid = q.product_id[0];
    if (!freeByProduct[pid]) freeByProduct[pid] = { name: q.product_id[1], free: 0 };
    const qty = Number(q.quantity || 0);
    const reserved = Number(q.reserved_quantity || 0);
    if (q.lot_id) {
      freeByProduct[pid].free += Math.max(0, qty - reserved);
    } else {
      freeByProduct[pid].free += (qty - reserved);
    }
  });
  const now = new Date().toISOString();
  const rows = Object.values(freeByProduct)
    .filter(function (p) { return p.free > 0; })
    .map(function (p) { return { product_name: p.name, quantity: p.free, updated_at: now }; });
  log('ดึงจาก Odoo ได้ ' + rows.length + ' รายการสินค้าที่มีสต๊อก');

  log('ดึงรายการบริการ (type=service, ไม่ต้องรอสต๊อก) จาก Odoo...');
  const serviceRows = await fetchServiceProductRows(odoo, now);
  log('ดึงบริการได้ ' + serviceRows.length + ' รายการ');
  rows.push.apply(rows, serviceRows);

  log('ล้างตาราง odoo_stock_cache เดิมทิ้ง...');
  const delRes = await fetch(supabaseUrl + '/rest/v1/odoo_stock_cache?product_name=neq.__never_matches__', {
    method: 'DELETE', headers: authHeaders,
  });
  if (!delRes.ok) throw new Error('ล้างตาราง odoo_stock_cache เดิมไม่สำเร็จ (HTTP ' + delRes.status + '): ' + (await delRes.text()).slice(0, 300));

  if (rows.length) {
    log('บันทึกสต๊อกชุดใหม่ลง Supabase...');
    await chunkedInsert(supabaseUrl, authHeaders, 'odoo_stock_cache', rows, 1000);
  }
  log('sync สต๊อก Odoo สำเร็จ — บันทึก ' + rows.length + ' รายการสินค้าเข้า Supabase เรียบร้อยแล้ว');
}

async function syncCrmOrders(supabaseUrl, authHeaders) {
  log('เชื่อมต่อ CRM แล้วดึงรายการคำสั่งขายทั้งหมด (อาจใช้เวลาสักครู่ — ~40 วิ ตอนทดสอบจริงกับ ~89,000 รายการ)...');
  const token = await crmLoginForStock();
  const orders = await fetchAllSaleOrdersForSync(token);
  const now = new Date().toISOString();
  const rows = orders.map(function (o) {
    return {
      sale_order_id: o.saleOrderId,
      status: o.status,
      installment_type: o.installmentType,
      order_date: o.orderDate || null,
      crm_updated_at: o.updatedAt || null,
      customer_first_name: o.customerFirstName || null,
      customer_last_name: o.customerLastName || null,
      synced_at: now,
    };
  });
  log('ดึงจาก CRM ได้ ' + rows.length + ' รายการคำสั่งขาย');

  log('ล้างตาราง crm_orders_cache เดิมทิ้ง...');
  const delRes = await fetch(supabaseUrl + '/rest/v1/crm_orders_cache?sale_order_id=neq.__never_matches__', {
    method: 'DELETE', headers: authHeaders,
  });
  if (!delRes.ok) throw new Error('ล้างตาราง crm_orders_cache เดิมไม่สำเร็จ (HTTP ' + delRes.status + '): ' + (await delRes.text()).slice(0, 300));

  if (rows.length) {
    log('บันทึกคำสั่งขายชุดใหม่ลง Supabase (แบ่งเป็นชุดละ 1000 แถว)...');
    await chunkedInsert(supabaseUrl, authHeaders, 'crm_orders_cache', rows, 1000);
  }
  log('sync คำสั่งขาย CRM สำเร็จ — บันทึก ' + rows.length + ' รายการเข้า Supabase เรียบร้อยแล้ว');
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('ยังไม่ได้ตั้งค่า SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ใน scripts/.env (คัดลอกจาก scripts/.env.example)');
  }
  const authHeaders = { apikey: supabaseKey, Authorization: 'Bearer ' + supabaseKey, 'Content-Type': 'application/json' };

  await syncOdooStock(supabaseUrl, authHeaders);
  await syncCrmOrders(supabaseUrl, authHeaders);
  log('sync ทั้งหมดสำเร็จ');
}

main().catch(function (err) {
  console.error('[' + new Date().toISOString() + '] sync ล้มเหลว: ' + err.message);
  process.exitCode = 1;
});
