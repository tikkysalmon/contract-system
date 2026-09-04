// Vercel serverless function — คิวเอกสารที่ลูกค้าส่งฟอร์ม/เซ็นแล้ว รอพนักงานเซ็นทีหลัง (2026-09-04 ตามที่
// user ขอ "นำการเซ็นออนไลน์ของระบบขออนุมัติเอกสารมาใช้" — ลูกค้าเซ็นก่อน พนักงาน 1 คนเซ็นทีหลัง ผ่านการล็อกอิน
// เข้า app.html เดิม ไม่ใช่ token link แบบ esign-approval's ผู้เซ็นภายนอก)
//
// ต้องตั้งค่าใน Vercel project settings: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (เหมือน endpoint อื่นๆ)
// ต้องรัน supabase-staff-signature.sql ก่อน (เพิ่มคอลัมน์ staff_signature_path/staff_signed_by/staff_signed_at)

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
  try {
    // embed contract_sessions ผ่าน FK (session_id) ดึง crm_snapshot มาแสดงชื่อลูกค้า/รายการสินค้าให้พนักงานเห็น
    // ก่อนตัดสินใจเปิดเซ็น — staff_signed_at is null คือยังไม่มีใครเซ็น (คิวที่ต้องทำ)
    const r = await fetch(
      SUPABASE_URL + '/rest/v1/contract_submissions' +
        '?select=id,submitted_at,customer_data,contract_sessions(token,crm_snapshot)' +
        '&staff_signed_at=is.null&order=submitted_at.asc',
      { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY } }
    );
    if (!r.ok) throw new Error('เรียก Supabase ไม่สำเร็จ (HTTP ' + r.status + ')');
    const rows = await r.json();

    const queue = rows.map(function (row) {
      const session = row.contract_sessions || {};
      const snapshot = session.crm_snapshot || {};
      const items = snapshot.items || [];
      return {
        submissionId: row.id,
        submittedAt: row.submitted_at,
        customerName: (snapshot.customer && snapshot.customer.firstLastName) || (row.customer_data && row.customer_data.firstLastName) || '-',
        products: items.map(function (it) { return it.product; }),
        soNumbers: items.map(function (it) { return it.soNumber; }),
      };
    });

    res.status(200).json({ queue: queue });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
