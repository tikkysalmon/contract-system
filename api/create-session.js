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

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function randomToken() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return require('crypto').randomUUID();
}

module.exports = async function handler(req, res) {
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
    if (!session.soNumber) {
      res.status(400).json({ error: 'ไม่มีเลขที่คำสั่งขาย' });
      return;
    }

    const token = randomToken();
    const row = {
      token: token,
      so_number: session.soNumber,
      crm_snapshot: session,
      plan_type: session.planType,
      total_price: session.productPrice,
      down_payment: session.downPayment || 0,
      installment_count: session.installmentCount,
      first_due_date: session.firstDueDate,
      product: session.product,
      color: session.color || null,
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
