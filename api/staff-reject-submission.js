// Vercel serverless function — พนักงานตรวจสัญญาที่ลูกค้าส่งกลับมาแล้วพบว่าข้อมูลบางส่วนผิด (2026-09-06)
// กด "ปฏิเสธ" ระบุว่าข้อมูลกลุ่มไหนผิด (ตรงกับ step key ใน sign.js) + หมายเหตุ (ไม่บังคับ) — บันทึกไว้ที่
// contract_submissions แล้วเปลี่ยนสถานะ contract_sessions เป็น 'needs_correction' พร้อมต่ออายุลิงก์เดิมอีก
// 7 วัน (ลิงก์เดิมอาจใกล้/เลยกำหนดหมดอายุแล้วตอนที่ตรวจพบ) — ลูกค้าเปิดลิงก์เดิมซ้ำได้ (ดู get-session.js /
// sign.js ที่ต่อขยายมาให้เห็นเฉพาะขั้นตอนที่ต้องแก้ + ข้อมูลเดิมที่ถูกต้องอยู่แล้ว)
//
// ต้องรัน supabase-reject-correction.sql ก่อนใช้งาน (เพิ่มคอลัมน์ rejected_*/สถานะ needs_correction)
// ต้องตั้งค่าใน Vercel project settings: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ต้องตรงกับ step key ที่ sign.js ใช้จริง (STEP_DEFS) — เป็นขั้นตอนที่ลูกค้าแก้ไขข้อมูลได้จริงเท่านั้น
// ('review'/'sign' ไม่อยู่ในนี้เพราะเป็นขั้นตอนที่ต้องทำใหม่เสมออยู่แล้วทุกครั้งที่แก้ไขอะไรก็ตาม)
const ALLOWED_FIELDS = ['personal', 'address', 'guardian', 'guarantor', 'uploads'];

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
    const note = req.body && req.body.note ? String(req.body.note).trim() : null;
    const rejectedFields = Array.isArray(req.body && req.body.rejectedFields)
      ? req.body.rejectedFields.filter(function (f) { return ALLOWED_FIELDS.indexOf(f) !== -1; })
      : [];
    if (!submissionId || !staffName) {
      res.status(400).json({ error: 'ข้อมูลไม่ครบ (submissionId/staffName)' });
      return;
    }
    if (!rejectedFields.length) {
      res.status(400).json({ error: 'กรุณาระบุอย่างน้อย 1 รายการที่ต้องแก้ไข' });
      return;
    }
    const authHeaders = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY };

    const subRes = await fetch(
      SUPABASE_URL + '/rest/v1/contract_submissions?id=eq.' + encodeURIComponent(submissionId) + '&select=session_id',
      { headers: authHeaders }
    );
    const subRows = await subRes.json();
    if (!subRes.ok || !subRows.length) { res.status(404).json({ error: 'ไม่พบรายการนี้' }); return; }
    const sessionId = subRows[0].session_id;

    // เคลียร์สถานะเซ็นของพนักงานทิ้งด้วย (ถ้าเผลอเซ็นไปก่อนเจอว่าข้อมูลผิด) — ต้องกลับไปเซ็นใหม่หลังลูกค้าแก้แล้ว
    const patchSubRes = await fetch(
      SUPABASE_URL + '/rest/v1/contract_submissions?id=eq.' + encodeURIComponent(submissionId),
      {
        method: 'PATCH',
        headers: Object.assign({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }, authHeaders),
        body: JSON.stringify({
          rejected_at: new Date().toISOString(),
          rejected_by: staffName,
          rejected_fields: rejectedFields,
          rejected_note: note,
          staff_signature_path: null,
          staff_signed_by: null,
          staff_signed_at: null,
        }),
      }
    );
    if (!patchSubRes.ok) {
      const text = await patchSubRes.text();
      throw new Error('บันทึกการปฏิเสธไม่สำเร็จ (HTTP ' + patchSubRes.status + '): ' + text.slice(0, 300));
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const patchSessRes = await fetch(
      SUPABASE_URL + '/rest/v1/contract_sessions?id=eq.' + encodeURIComponent(sessionId) + '&select=token',
      {
        method: 'PATCH',
        headers: Object.assign({ 'Content-Type': 'application/json', Prefer: 'return=representation' }, authHeaders),
        body: JSON.stringify({ status: 'needs_correction', expires_at: expiresAt }),
      }
    );
    if (!patchSessRes.ok) {
      const text = await patchSessRes.text();
      throw new Error('อัปเดตสถานะลิงก์ไม่สำเร็จ (HTTP ' + patchSessRes.status + '): ' + text.slice(0, 300));
    }
    const sessRows = await patchSessRes.json();

    res.status(200).json({ ok: true, token: sessRows[0] && sessRows[0].token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
