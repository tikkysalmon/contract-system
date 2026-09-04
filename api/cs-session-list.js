// Vercel serverless function — รายการลิงก์แบบฟอร์มทั้งหมดที่ CS สร้างไว้ (2026-09-04 ตามที่ user ขอ ให้เมนู
// "สำหรับ CS" ตรวจสอบได้ว่าลูกค้ารายไหนสร้างลิงก์แล้ว/ยังไม่กรอกข้อมูลกลับมา + คัดลอกลิงก์เดิมส่งซ้ำได้)
//
// GET -> { sessions: [{ token, createdAt, customerName, products, soNumbers, submitted, submittedAt }] }
// submitted=false คือยังไม่มีแถวใน contract_submissions ผูกกับ session นี้ (ลูกค้ายังไม่กรอก/ส่งฟอร์มกลับมา)
//
// ต้องตั้งค่าใน Vercel project settings: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (เหมือน endpoint อื่นๆ)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({ error: 'ยังไม่ได้ตั้งค่า SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY บน server' });
    return;
  }
  try {
    // embed contract_submissions ผ่าน FK (session_id) แค่ดูว่ามีแถวหรือไม่ + submitted_at เอาไปเรียงคิว/แสดงผล
    // จำกัด 200 แถวล่าสุด กันโหลดหนักถ้ามีลิงก์สะสมเยอะมาก (ยังไม่ทำ pagination/ค้นหาฝั่ง server รอบนี้)
    const r = await fetch(
      SUPABASE_URL + '/rest/v1/contract_sessions' +
        '?select=token,created_at,crm_snapshot,contract_submissions(submitted_at)' +
        '&order=created_at.desc&limit=200',
      { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY } }
    );
    if (!r.ok) throw new Error('เรียก Supabase ไม่สำเร็จ (HTTP ' + r.status + ')');
    const rows = await r.json();

    const sessions = rows.map(function (row) {
      const snap = row.crm_snapshot || {};
      const items = snap.items || [];
      const submissions = row.contract_submissions || [];
      return {
        token: row.token,
        createdAt: row.created_at,
        customerName: (snap.customer && snap.customer.firstLastName) || '-',
        products: items.map(function (it) { return it.product; }),
        soNumbers: items.map(function (it) { return it.soNumber; }),
        submitted: submissions.length > 0,
        submittedAt: submissions.length ? submissions[0].submitted_at : null,
      };
    });

    res.status(200).json({ sessions: sessions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
