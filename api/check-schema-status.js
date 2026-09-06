// TEMP DEBUG (2026-09-06) — เช็คว่าตาราง/คอลัมน์จาก supabase-*.sql ไฟล์ไหนรันแล้ว/ยังไม่ได้รันบ้าง โดยลอง
// SELECT คอลัมน์ที่คาดว่ามีจริง — ถ้าคอลัมน์/ตารางไม่มีจริง PostgREST จะตอบ error กลับมาให้เช็คได้ตรงๆ ไม่ต้อง
// เดา จะลบไฟล์นี้ทิ้งหลังใช้เสร็จ (ตามแพทเทิร์นเดิมของโปรเจกต์นี้)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CHECKS = [
  { file: 'supabase-setup.sql', table: 'contract_sessions', select: 'id,token,status' },
  { file: 'supabase-setup.sql', table: 'contract_submissions', select: 'id,session_id' },
  { file: 'supabase-staff-signature.sql', table: 'contract_submissions', select: 'staff_signature_path,staff_signed_by,staff_signed_at' },
  { file: 'supabase-staff-signature-2.sql', table: 'staff_signatures', select: 'username,signature_path' },
  { file: 'supabase-reject-correction.sql', table: 'contract_submissions', select: 'rejected_at,rejected_by,rejected_fields,rejected_note' },
  { file: 'supabase-imei-serial.sql', table: 'contract_submissions', select: 'imei,serial_number' },
  { file: 'supabase-review-confirm.sql', table: 'contract_submissions', select: 'reviewed_at,reviewed_by' },
  { file: 'supabase-stock-orders.sql', table: 'stock_order_meta', select: 'so_number,withdrawal_round,printed_at,cancelled_at' },
];

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({ error: 'ยังไม่ได้ตั้งค่า SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY บน server' });
    return;
  }
  const authHeaders = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY };
  const results = [];
  for (const c of CHECKS) {
    try {
      const r = await fetch(SUPABASE_URL + '/rest/v1/' + c.table + '?select=' + c.select + '&limit=1', { headers: authHeaders });
      if (r.ok) {
        results.push({ file: c.file, table: c.table, ok: true });
      } else {
        const body = await r.json().catch(function () { return {}; });
        results.push({ file: c.file, table: c.table, ok: false, detail: body.message || ('HTTP ' + r.status) });
      }
    } catch (err) {
      results.push({ file: c.file, table: c.table, ok: false, detail: err.message });
    }
  }
  res.status(200).json({ results: results });
};
