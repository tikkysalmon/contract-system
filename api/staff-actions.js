// Vercel serverless function — รวม action ของทีมเร่งรัดหนี้สินต่อ submission หนึ่งใบไว้ที่เดียว (2026-09-06
// รวมจาก staff-sign-submit.js/staff-reject-submission.js/staff-confirm-submission.js เดิม เพื่อลดจำนวน
// serverless function ทั้งโปรเจกต์ — Vercel Hobby plan จำกัดไว้แค่ 12 ฟังก์ชัน/deployment เกินแล้ว deploy
// ล้มเงียบๆ เจอบั๊กจริง 2026-09-06 ตอนเพิ่มเมนูสต๊อค deploy พังเพราะเกินโควต้านี้พอดี)
//
// POST body: { action: 'sign' | 'reject' | 'confirm', submissionId, staffName, ...action-specific fields }
//   'sign'    — { signatureDataUrl } อัปโหลดรูปลายเซ็น + บันทึก staff_signed_at/staff_signed_by
//   'reject'  — { rejectedFields: string[], note? } ปฏิเสธ ส่งกลับให้ลูกค้าแก้ไข (ต้องรัน supabase-reject-correction.sql)
//   'confirm' — {} ยืนยันว่าตรวจสอบข้อมูลแล้วถูกต้อง (ต้องรัน supabase-review-confirm.sql)
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

// ต้องตรงกับ step key ที่ sign.js ใช้จริง (STEP_DEFS) — เป็นขั้นตอนที่ลูกค้าแก้ไขข้อมูลได้จริงเท่านั้น
const ALLOWED_REJECT_FIELDS = ['personal', 'address', 'guardian', 'guarantor', 'uploads'];

async function doSign(authHeaders, submissionId, staffName, signatureDataUrl, res) {
  if (!signatureDataUrl) { res.status(400).json({ error: 'ไม่มี signatureDataUrl' }); return; }
  const parsed = parseDataUrl(signatureDataUrl);
  if (!parsed) { res.status(400).json({ error: 'รูปลายเซ็นไม่ถูกต้อง' }); return; }

  const path = 'staff-signatures/' + submissionId + '-' + randomUUID() + '.' + parsed.ext;
  const uploadRes = await fetch(SUPABASE_URL + '/storage/v1/object/contract-files/' + path, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': parsed.mime, 'x-upsert': 'true' }, authHeaders),
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
      headers: Object.assign({ 'Content-Type': 'application/json', Prefer: 'return=representation' }, authHeaders),
      body: JSON.stringify({ staff_signature_path: path, staff_signed_by: staffName, staff_signed_at: new Date().toISOString() }),
    }
  );
  if (!patchRes.ok) {
    const text = await patchRes.text();
    throw new Error('บันทึกการเซ็นไม่สำเร็จ (HTTP ' + patchRes.status + '): ' + text.slice(0, 300));
  }
  const updated = await patchRes.json();
  if (!updated.length) { res.status(409).json({ error: 'เอกสารนี้มีคนเซ็นไปแล้ว (อาจเซ็นซ้อนกันพอดี) กรุณารีเฟรชคิว' }); return; }
  res.status(200).json({ ok: true });
}

async function doReject(authHeaders, submissionId, staffName, rejectedFieldsRaw, note, res) {
  const rejectedFields = Array.isArray(rejectedFieldsRaw) ? rejectedFieldsRaw.filter(function (f) { return ALLOWED_REJECT_FIELDS.indexOf(f) !== -1; }) : [];
  if (!rejectedFields.length) { res.status(400).json({ error: 'กรุณาระบุอย่างน้อย 1 รายการที่ต้องแก้ไข' }); return; }

  const subRes = await fetch(
    SUPABASE_URL + '/rest/v1/contract_submissions?id=eq.' + encodeURIComponent(submissionId) + '&select=session_id',
    { headers: authHeaders }
  );
  const subRows = await subRes.json();
  if (!subRes.ok || !subRows.length) { res.status(404).json({ error: 'ไม่พบรายการนี้' }); return; }
  const sessionId = subRows[0].session_id;

  // เคลียร์สถานะเซ็น/ยืนยันของพนักงานทิ้งด้วย ต้องทำใหม่หลังลูกค้าแก้ไขแล้ว
  const patchSubRes = await fetch(
    SUPABASE_URL + '/rest/v1/contract_submissions?id=eq.' + encodeURIComponent(submissionId),
    {
      method: 'PATCH',
      headers: Object.assign({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }, authHeaders),
      body: JSON.stringify({
        rejected_at: new Date().toISOString(), rejected_by: staffName, rejected_fields: rejectedFields, rejected_note: note || null,
        staff_signature_path: null, staff_signed_by: null, staff_signed_at: null,
        reviewed_at: null, reviewed_by: null,
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
}

async function doConfirm(authHeaders, submissionId, staffName, res) {
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
  if (!updated.length) { res.status(409).json({ error: 'เอกสารนี้มีคนยืนยันไปแล้ว (หรือถูกปฏิเสธไปพร้อมกันพอดี) กรุณารีเฟรชคิว' }); return; }
  res.status(200).json({ ok: true });
}

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
    const body = req.body || {};
    const action = String(body.action || '');
    const submissionId = String(body.submissionId || '').trim();
    const staffName = String(body.staffName || '').trim();
    if (!submissionId || !staffName) { res.status(400).json({ error: 'ข้อมูลไม่ครบ (submissionId/staffName)' }); return; }
    const authHeaders = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY };

    if (action === 'sign') { await doSign(authHeaders, submissionId, staffName, body.signatureDataUrl, res); return; }
    if (action === 'reject') { await doReject(authHeaders, submissionId, staffName, body.rejectedFields, body.note, res); return; }
    if (action === 'confirm') { await doConfirm(authHeaders, submissionId, staffName, res); return; }
    res.status(400).json({ error: 'ไม่รู้จัก action นี้' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
