// Vercel serverless function — พนักงาน (ทีมเร่งรัดหนี้สิน) กด "ยืนยัน" หลังตรวจสอบข้อมูลสัญญาที่ลูกค้าส่งกลับ
// มาแล้วว่าถูกต้องไม่ต้องแก้ไข (2026-09-06) — คนละ action กับ "เซ็นเอกสาร"/"ปฏิเสธ" ที่มีอยู่แล้ว บันทึกแค่
// reviewed_at/reviewed_by ให้สถานะเปลี่ยนจาก "รอตรวจสอบ" เป็น "สัญญาลูกค้าเรียบร้อย" (ดู _lib/contract-status.js)
//
// ต้องรัน supabase-review-confirm.sql ก่อนใช้งาน (เพิ่มคอลัมน์ reviewed_at/reviewed_by)
// ต้องตั้งค่าใน Vercel project settings: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({ error: 'ยังไม่ได้ตั้งค่า SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY บน server' });
    return;
  }
  try {
    const submissionId = String((req.body && req.body.submissionId) || '').trim();
    const staffName = String((req.body && req.body.staffName) || '').trim();
    if (!submissionId || !staffName) {
      res.status(400).json({ error: 'ข้อมูลไม่ครบ (submissionId/staffName)' });
      return;
    }
    const authHeaders = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY };

    // เฉพาะแถวที่ยังไม่เคยยืนยัน (reviewed_at=is.null) กันกดซ้ำซ้อน/ยืนยันทับกันพอดี
    const patchRes = await fetch(
      SUPABASE_URL + '/rest/v1/contract_submissions?id=eq.' + encodeURIComponent(submissionId) + '&reviewed_at=is.null',
      {
        method: 'PATCH',
        headers: Object.assign({ 'Content-Type': 'application/json', Prefer: 'return=representation' }, authHeaders),
        body: JSON.stringify({ reviewed_at: new Date().toISOString(), reviewed_by: staffName }),
      }
    );
    if (!patchRes.ok) {
      const text = await patchRes.text();
      throw new Error('บันทึกการยืนยันไม่สำเร็จ (HTTP ' + patchRes.status + '): ' + text.slice(0, 300));
    }
    const updated = await patchRes.json();
    if (!updated.length) {
      res.status(409).json({ error: 'เอกสารนี้มีคนยืนยันไปแล้ว (หรือถูกปฏิเสธไปพร้อมกันพอดี) กรุณารีเฟรชคิว' });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
