// Vercel serverless function — สตรีมไฟล์รูป/ลายเซ็นของลูกค้าที่ส่งฟอร์มแล้ว กลับมาแสดงในเมนู "ข้อมูลลูกค้า
// ทำสัญญา" (2026-09-04) — ต้อง proxy ผ่าน server เท่านั้น เพราะ bucket "contract-files" เป็น private จริง
// (ทดสอบแล้ว: GET ตรงจาก Storage โดยไม่ auth คืน 400 "Bucket not found" แม้จะเคยเข้าใจผิดว่า public จาก curl -I
// ที่ใช้ HEAD request ซึ่งพฤติกรรมต่างจาก GET จริง) — endpoint นี้ใช้ SUPABASE_SERVICE_ROLE_KEY ฝั่ง server
// อ่านไฟล์แล้วส่งต่อ (stream) ให้ browser โดยตรง ไม่ต้องเปิด bucket เป็น public หรือส่ง key ออกไปฝั่ง client
//
// GET ?submissionId=<id>&field=<idCard|selfieWithId|guardianId|guarantorId|signature|guardianSignature|
//                              guarantorSignature|staffSignature>
//
// ต้องตั้งค่าใน Vercel project settings: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (เหมือน endpoint อื่นๆ)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const MIME_BY_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({ error: 'ยังไม่ได้ตั้งค่า SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY บน server' });
    return;
  }
  const submissionId = String((req.query && req.query.submissionId) || '').trim();
  const field = String((req.query && req.query.field) || '').trim();
  if (!submissionId || !field) {
    res.status(400).json({ error: 'ไม่มี submissionId หรือ field' });
    return;
  }
  const authHeaders = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY };

  try {
    const rowRes = await fetch(
      SUPABASE_URL + '/rest/v1/contract_submissions?id=eq.' + encodeURIComponent(submissionId) +
        '&select=file_paths,staff_signature_path',
      { headers: authHeaders }
    );
    if (!rowRes.ok) throw new Error('เรียก Supabase ไม่สำเร็จ (HTTP ' + rowRes.status + ')');
    const rows = await rowRes.json();
    if (!rows.length) { res.status(404).json({ error: 'ไม่พบข้อมูลนี้' }); return; }

    const filePaths = rows[0].file_paths || {};
    const path = field === 'staffSignature' ? rows[0].staff_signature_path : filePaths[field];
    if (!path) { res.status(404).json({ error: 'ไม่มีไฟล์นี้' }); return; }

    const fileRes = await fetch(SUPABASE_URL + '/storage/v1/object/contract-files/' + path, { headers: authHeaders });
    if (!fileRes.ok) { res.status(404).json({ error: 'ไฟล์นี้ในระบบหายไป' }); return; }
    const buf = Buffer.from(await fileRes.arrayBuffer());
    const ext = (path.split('.').pop() || '').toLowerCase();
    // path มี UUID ต่อท้ายชื่อไฟล์เสมอ (สร้างครั้งเดียวไม่มีการเขียนทับ) จึง cache ยาวได้อย่างปลอดภัย — ต่างจาก
    // staff-signature.js ที่ path เดิมถูก upsert ทับได้ (ต้อง no-store กันเสิร์ฟค่าเก่า)
    res.writeHead(200, { 'Content-Type': MIME_BY_EXT[ext] || 'application/octet-stream', 'Cache-Control': 'private, max-age=86400' });
    res.end(buf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
