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

async function getWarehouseStockLocationId(odoo, warehouseName) {
  const warehouses = await odoo.searchRead('stock.warehouse', [['name', '=', warehouseName]], ['id', 'name', 'lot_stock_id']);
  if (!warehouses.length) throw new Error('ไม่พบคลังชื่อ "' + warehouseName + '" ใน Odoo (stock.warehouse) — เช็คชื่อคลังให้ตรงกับที่ตั้งไว้จริง');
  return warehouses[0].lot_stock_id[0];
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
  const groups = await odoo.readGroup(
    'stock.quant',
    [['location_id', 'child_of', stockLocationId]],
    ['product_id', 'quantity:sum'],
    ['product_id']
  );
  const now = new Date().toISOString();
  const rows = groups
    .filter(function (g) { return g.product_id && Number(g.quantity || 0) > 0; })
    .map(function (g) { return { product_name: g.product_id[1], quantity: Number(g.quantity || 0), updated_at: now }; });
  log('ดึงจาก Odoo ได้ ' + rows.length + ' รายการสินค้าที่มีสต๊อก');

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
