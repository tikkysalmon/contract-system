// Vercel serverless function — ลูกค้าเปิดลิงก์ /sign.html?token=... เรียกที่นี่เพื่ออ่าน session จริงจาก
// Supabase (2026-09-04) กลับมาเป็น session object เดียวกับที่ CS สร้างไว้ตอนกด "สร้างลิงก์" (เก็บทั้งก้อนไว้
// ใน crm_snapshot — ดู create-session.js) ไม่ต้องล็อกอิน ใช้แค่ token ในลิงก์
//
// ต้องตั้งค่าใน Vercel project settings: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — ใช้ service_role ไม่ใช่
// anon key เพราะ RLS ของตาราง contract_sessions เปิดอยู่ (ดูรายละเอียดเหตุผลใน create-session.js)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({ error: 'ยังไม่ได้ตั้งค่า SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY บน server' });
    return;
  }
  const token = String((req.query && req.query.token) || '').trim();
  if (!token) {
    res.status(400).json({ error: 'ไม่มี token' });
    return;
  }

  try {
    const r = await fetch(
      SUPABASE_URL + '/rest/v1/contract_sessions?token=eq.' + encodeURIComponent(token) + '&select=crm_snapshot,expires_at,status',
      { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY } }
    );
    if (!r.ok) throw new Error('เรียก Supabase ไม่สำเร็จ (HTTP ' + r.status + ')');
    const rows = await r.json();
    if (!rows.length) {
      res.status(404).json({ error: 'ไม่พบลิงก์นี้ หรือลิงก์ไม่ถูกต้อง' });
      return;
    }
    const row = rows[0];
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      res.status(410).json({ error: 'ลิงก์นี้หมดอายุแล้ว กรุณาติดต่อ CS เพื่อขอลิงก์ใหม่' });
      return;
    }
    res.status(200).json({ session: row.crm_snapshot });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
