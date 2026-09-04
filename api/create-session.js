// Vercel serverless function — CS กด "สร้างลิงก์ให้ลูกค้า" เรียกที่นี่เพื่อเขียน session จริงลง Supabase
// (2026-09-04 แทนที่ localStorage demo bridge เดิมที่ contracts-tab.js ใช้ทดสอบในเครื่องอย่างเดียว)
//
// ต้องตั้งค่าใน Vercel project settings: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (ห้าม commit ค่าจริงลงไฟล์
// นี้เด็ดขาด) — ใช้ service_role key ไม่ใช่ anon key เพราะ RLS ของตาราง contract_sessions เปิดอยู่ (ยืนยันจริง
// 2026-09-04: ลองเขียนด้วย anon key แล้วโดน RLS บล็อก error 42501) โค้ดนี้รันฝั่ง server (Vercel function)
// เท่านั้น ไม่เคยถูกเรียกตรงจากเบราว์เซอร์ ใช้ service_role (bypass RLS) ได้อย่างปลอดภัยตราบใดที่ไม่ leak
// ค่านี้ไปฝั่ง client
//
// เก็บ session object ทั้งก้อนไว้ใน crm_snapshot (jsonb) เพราะ field ที่ sign.js/preview-contract.js ต้องใช้
// จริง (contractNo, totalDiscount, netPrice, installmentsPaidSoFar/Count, remainingBalance, customer prefill,
// letterheadDataUrl ฯลฯ) มีมากกว่าคอลัมน์ typed ที่ประกาศไว้ใน supabase-setup.sql — คอลัมน์ typed (so_number,
// plan_type, total_price, ...) เก็บไว้แค่ให้ query/ทำรายงานทีหลังได้สะดวก ไม่ใช่แหล่งข้อมูลหลักที่แอปอ่าน
//
// session.items[] (2026-09-04) — 1 session รองรับได้หลาย SO รวมกัน (ข้อจำกัด CRM: วางดาวน์เครื่อง + อุปกรณ์
// เสริมพร้อมกันต้องเปิดแยก SO แต่ user ต้องการให้ลูกค้ากรอกฟอร์มครั้งเดียว) — คอลัมน์ typed ข้างบน (ออกแบบไว้
// สำหรับ 1 SO/session) ใส่แค่ค่าของ "รายการแรก" เป็น best-effort สำหรับ query/รายงานคร่าวๆ เท่านั้น ตัวจริง
// ที่แอปใช้อ่านคือ crm_snapshot.items[] เสมอ (ดู get-session.js)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function randomToken() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return require('crypto').randomUUID();
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store'); // 2026-09-04 กัน Vercel edge cache เสิร์ฟข้อมูลเก่า (บั๊กจริงที่เจอ: GET /api/staff-signature หลังอัปเดตแล้วยังได้ค่าเก่า)
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({ error: 'ยังไม่ได้ตั้งค่า SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY บน server' });
    return;
  }
  try {
    const session = (req.body && req.body.session) || {};
    const items = Array.isArray(session.items) ? session.items : [];
    if (!items.length || !items[0].soNumber) {
      res.status(400).json({ error: 'ไม่มีเลขที่คำสั่งขาย' });
      return;
    }
    const main = items[0]; // ใช้เติมคอลัมน์ typed แบบ best-effort เท่านั้น (ดูหมายเหตุด้านบน)

    const token = randomToken();
    const row = {
      token: token,
      so_number: main.soNumber,
      crm_snapshot: session,
      plan_type: main.planType,
      total_price: main.productPrice,
      down_payment: main.downPayment || 0,
      installment_count: main.installmentCount,
      first_due_date: main.firstDueDate,
      product: main.product,
      color: main.color || null,
      status: 'sent',
    };

    const r = await fetch(SUPABASE_URL + '/rest/v1/contract_sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
    });
    if (!r.ok) {
      const text = await r.text();
      throw new Error('บันทึกลง Supabase ไม่สำเร็จ (HTTP ' + r.status + '): ' + text.slice(0, 300));
    }
    res.status(200).json({ token: token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
