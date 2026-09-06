// Vercel serverless function — ลูกค้าเปิดลิงก์ /sign.html?token=... เรียกที่นี่เพื่ออ่าน session จริงจาก
// Supabase (2026-09-04) กลับมาเป็น session object เดียวกับที่ CS สร้างไว้ตอนกด "สร้างลิงก์" (เก็บทั้งก้อนไว้
// ใน crm_snapshot — ดู create-session.js) ไม่ต้องล็อกอิน ใช้แค่ token ในลิงก์
//
// ต้องตั้งค่าใน Vercel project settings: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — ใช้ service_role ไม่ใช่
// anon key เพราะ RLS ของตาราง contract_sessions เปิดอยู่ (ดูรายละเอียดเหตุผลใน create-session.js)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store'); // 2026-09-04 กัน Vercel edge cache เสิร์ฟข้อมูลเก่า (บั๊กจริงที่เจอ: GET /api/staff-signature หลังอัปเดตแล้วยังได้ค่าเก่า)
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
    const authHeaders = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY };
    const r = await fetch(
      SUPABASE_URL + '/rest/v1/contract_sessions?token=eq.' + encodeURIComponent(token) + '&select=id,crm_snapshot,expires_at,status',
      { headers: authHeaders }
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

    let correction = null;
    // สถานะ 'needs_correction' (2026-09-06) — พนักงานตรวจแล้วพบข้อมูลผิดบางส่วน ส่งลิงก์เดิมกลับมาให้แก้ไข —
    // ดึงข้อมูลที่ลูกค้าเคยกรอกไว้ + รายการที่ต้องแก้ ให้ sign.js เติมค่าเดิมไว้ก่อนแล้วเปิดให้แก้เฉพาะจุดที่ผิด
    if (row.status === 'needs_correction') {
      const subRes = await fetch(
        SUPABASE_URL + '/rest/v1/contract_submissions?session_id=eq.' + encodeURIComponent(row.id) +
          '&select=customer_data,rejected_fields,rejected_note&order=submitted_at.desc&limit=1',
        { headers: authHeaders }
      );
      if (subRes.ok) {
        const subRows = await subRes.json();
        if (subRows.length) {
          correction = {
            previousData: subRows[0].customer_data || {},
            fields: subRows[0].rejected_fields || [],
            note: subRows[0].rejected_note || '',
          };
        }
      }
    }

    res.status(200).json({ session: row.crm_snapshot, correction: correction });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
