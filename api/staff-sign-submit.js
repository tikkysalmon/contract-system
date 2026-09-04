// Vercel serverless function — พนักงานกด "ยืนยันเซ็น" ในคิวเอกสาร (2026-09-04) — อัปโหลดรูปลายเซ็น
// (วาดจาก canvas เหมือนที่ลูกค้าใช้) เข้า Supabase Storage แล้วบันทึกลง contract_submissions ว่าใครเซ็น/เมื่อไหร่
//
// ต้องตั้งค่าใน Vercel project settings: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const { randomUUID } = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function parseDataUrl(dataUrl) {
  if (!dataUrl) return null;
  const m = /^data:([\w.-]+\/[\w.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  const mime = m[1];
  const ext = mime.split('/')[1] === 'jpeg' ? 'jpg' : mime.split('/')[1];
  return { mime: mime, ext: ext, bytes: Buffer.from(m[2], 'base64') };
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
    const submissionId = String((req.body && req.body.submissionId) || '').trim();
    const staffName = String((req.body && req.body.staffName) || '').trim();
    const signatureDataUrl = req.body && req.body.signatureDataUrl;
    if (!submissionId || !staffName || !signatureDataUrl) {
      res.status(400).json({ error: 'ข้อมูลไม่ครบ (submissionId/staffName/signatureDataUrl)' });
      return;
    }
    const parsed = parseDataUrl(signatureDataUrl);
    if (!parsed) { res.status(400).json({ error: 'รูปลายเซ็นไม่ถูกต้อง' }); return; }

    const path = 'staff-signatures/' + submissionId + '-' + randomUUID() + '.' + parsed.ext;
    const uploadRes = await fetch(SUPABASE_URL + '/storage/v1/object/contract-files/' + path, {
      method: 'POST',
      headers: {
        'Content-Type': parsed.mime,
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY,
        'x-upsert': 'true',
      },
      body: parsed.bytes,
    });
    if (!uploadRes.ok) {
      const text = await uploadRes.text();
      throw new Error('อัปโหลดลายเซ็นไม่สำเร็จ (HTTP ' + uploadRes.status + '): ' + text.slice(0, 200));
    }

    // เฉพาะแถวที่ยังไม่มีใครเซ็น (staff_signed_at=is.null) กันเคสกดซ้ำซ้อน/เซ็นทับคนอื่นที่เพิ่งเซ็นไปพร้อมกัน
    const patchRes = await fetch(
      SUPABASE_URL + '/rest/v1/contract_submissions?id=eq.' + encodeURIComponent(submissionId) + '&staff_signed_at=is.null',
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY,
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          staff_signature_path: path,
          staff_signed_by: staffName,
          staff_signed_at: new Date().toISOString(),
        }),
      }
    );
    if (!patchRes.ok) {
      const text = await patchRes.text();
      throw new Error('บันทึกการเซ็นไม่สำเร็จ (HTTP ' + patchRes.status + '): ' + text.slice(0, 300));
    }
    const updated = await patchRes.json();
    if (!updated.length) {
      res.status(409).json({ error: 'เอกสารนี้มีคนเซ็นไปแล้ว (อาจเซ็นซ้อนกันพอดี) กรุณารีเฟรชคิว' });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
