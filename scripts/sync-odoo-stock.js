#!/usr/bin/env node
// สคริปต์ sync สต๊อกจาก Odoo -> Supabase (ตาราง odoo_stock_cache) — รันจากพีซี user เอง (ผ่าน Windows Task
// Scheduler ทุก 15 นาทีตามที่ user ขอ 2026-09-07) เพราะเว็บ (Vercel) เข้าถึงเซิร์ฟเวอร์ Odoo ตรงไม่ได้ — ยิงจาก
// Vercel ทดสอบจริงแล้วค้าง 90 วิไม่ตอบเลย (ติด firewall/network ฝั่ง Odoo) แต่จากเครื่องนี้ (ที่เข้าถึง Odoo
// ได้อยู่แล้วปกติ) เชื่อมต่อสำเร็จเร็วปกติ — ดู README.md หัวข้อ "สคริปต์ sync สต๊อก Odoo" วิธีตั้งเวลารันซ้ำ
//
// ใช้: node scripts/sync-odoo-stock.js
// ต้องมีไฟล์ scripts/.env ก่อน (คัดลอกจาก scripts/.env.example แล้วกรอกค่าจริง — ไฟล์ .env ห้าม commit
// ขึ้น git เด็ดขาด อยู่ในเครื่อง user เท่านั้น)
//
// ล้างตาราง odoo_stock_cache ทิ้งทุกครั้งก่อนเขียนชุดใหม่ทั้งหมด (กันแถวค้าง — เช่นสินค้าที่เพิ่งหมดสต๊อกพอดี
// จะไม่มีในผลลัพธ์รอบนี้เลย ถ้าไม่ล้างก่อนจะเหลือเลขเก่าผิดๆ ค้างอยู่)

const fs = require('fs');
const path = require('path');

// โหลด scripts/.env เอง แบบง่ายๆ (ไม่เพิ่ม dependency ภายนอกอย่าง dotenv — ตรงกับแพทเทิร์นเดิมของโปรเจกต์นี้
// ที่หลีกเลี่ยง dependency ที่ไม่จำเป็น)
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

function log(msg) { console.log('[' + new Date().toISOString() + '] ' + msg); }

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('ยังไม่ได้ตั้งค่า SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ใน scripts/.env (คัดลอกจาก scripts/.env.example)');
  }
  const authHeaders = { apikey: supabaseKey, Authorization: 'Bearer ' + supabaseKey, 'Content-Type': 'application/json' };

  log('เชื่อมต่อ Odoo แล้วดึงสต๊อกคงเหลือ...');
  const odoo = getOdooClientFromEnv();
  const groups = await odoo.readGroup(
    'stock.quant',
    [['location_id.usage', '=', 'internal'], ['quantity', '>', 0]],
    ['product_id', 'quantity:sum'],
    ['product_id']
  );
  const now = new Date().toISOString();
  const rows = groups
    .filter(function (g) { return g.product_id; })
    .map(function (g) { return { product_name: g.product_id[1], quantity: Number(g.quantity || 0), updated_at: now }; });
  log('ดึงจาก Odoo ได้ ' + rows.length + ' รายการสินค้าที่มีสต๊อก');

  log('ล้างตาราง odoo_stock_cache เดิมทิ้ง...');
  const delRes = await fetch(supabaseUrl + '/rest/v1/odoo_stock_cache?product_name=neq.__never_matches__', {
    method: 'DELETE', headers: authHeaders,
  });
  if (!delRes.ok) throw new Error('ล้างตารางเดิมไม่สำเร็จ (HTTP ' + delRes.status + '): ' + (await delRes.text()).slice(0, 300));

  if (rows.length) {
    log('บันทึกชุดใหม่ลง Supabase...');
    const insRes = await fetch(supabaseUrl + '/rest/v1/odoo_stock_cache', {
      method: 'POST',
      headers: Object.assign({ Prefer: 'return=minimal' }, authHeaders),
      body: JSON.stringify(rows),
    });
    if (!insRes.ok) throw new Error('บันทึกข้อมูลใหม่ไม่สำเร็จ (HTTP ' + insRes.status + '): ' + (await insRes.text()).slice(0, 300));
  }

  log('sync สำเร็จ — บันทึก ' + rows.length + ' รายการสินค้าเข้า Supabase เรียบร้อยแล้ว');
}

main().catch(function (err) {
  console.error('[' + new Date().toISOString() + '] sync ล้มเหลว: ' + err.message);
  process.exitCode = 1;
});
