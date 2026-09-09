// Vercel serverless function — รวม action ของทีมเร่งรัดหนี้สินต่อ submission หนึ่งใบไว้ที่เดียว (2026-09-06
// รวมจาก staff-sign-submit.js/staff-reject-submission.js/staff-confirm-submission.js เดิม เพื่อลดจำนวน
// serverless function ทั้งโปรเจกต์ — Vercel Hobby plan จำกัดไว้แค่ 12 ฟังก์ชัน/deployment เกินแล้ว deploy
// ล้มเงียบๆ เจอบั๊กจริง 2026-09-06 ตอนเพิ่มเมนูสต๊อค deploy พังเพราะเกินโควต้านี้พอดี)
//
// POST body: { action: 'sign' | 'reject' | 'confirm' | 'changeSo', submissionId, staffName, ...action-specific fields }
//   'sign'    — { signatureDataUrl } อัปโหลดรูปลายเซ็น + บันทึก staff_signed_at/staff_signed_by
//   'reject'  — { rejectedFields: string[], note? } ปฏิเสธ ส่งกลับให้ลูกค้าแก้ไข (ต้องรัน supabase-reject-correction.sql)
//   'confirm' — {} ยืนยันว่าตรวจสอบข้อมูลแล้วถูกต้อง (ต้องรัน supabase-review-confirm.sql)
//   'changeSo' — { oldSoNumber, newItem } (2026-09-07) — ใช้เมื่อพนักงานยกเลิก SO เดิมในระบบ CRM แล้วเปิด SO
//     ใหม่แทน (เช่น ลูกค้าเปลี่ยนสินค้า) สลับ item ใน crm_snapshot.items[] เป็น newItem (client ประกอบมาให้
//     ครบแล้ว รวม contractNo ใหม่ — ดู staff-sign-tab.js's confirmChangeSo, โครงเดียวกับ contracts-tab.js's
//     createLink) ใช้กลไกเดียวกับ 'reject' (session.status='needs_correction', เคลียร์เซ็น/ยืนยันทิ้ง) แต่
//     บังคับ rejected_fields เป็น ['order'] เสมอ (ไม่ผ่าน ALLOWED_REJECT_FIELDS — เก็บข้อมูลส่วนตัว/ที่อยู่/
//     เอกสารแนบเดิมของลูกค้าไว้ทั้งหมด ไม่ต้องกรอกใหม่ ให้ลูกค้าแค่ดูรายการที่ทำสัญญาใหม่แล้วเซ็นใหม่) ใช้
//     ลิงก์/token เดิม ไม่สร้างลิงก์ใหม่ (user ยืนยัน 2026-09-07)
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

async function doChangeSo(authHeaders, submissionId, staffName, oldSoNumber, newItem, res) {
  if (!oldSoNumber || !newItem || !newItem.soNumber) { res.status(400).json({ error: 'ข้อมูลไม่ครบ (oldSoNumber/newItem)' }); return; }

  const subRes = await fetch(
    SUPABASE_URL + '/rest/v1/contract_submissions?id=eq.' + encodeURIComponent(submissionId) + '&select=session_id',
    { headers: authHeaders }
  );
  const subRows = await subRes.json();
  if (!subRes.ok || !subRows.length) { res.status(404).json({ error: 'ไม่พบรายการนี้' }); return; }
  const sessionId = subRows[0].session_id;

  const sessRes = await fetch(
    SUPABASE_URL + '/rest/v1/contract_sessions?id=eq.' + encodeURIComponent(sessionId) + '&select=crm_snapshot',
    { headers: authHeaders }
  );
  const sessRows = await sessRes.json();
  if (!sessRes.ok || !sessRows.length) { res.status(404).json({ error: 'ไม่พบ session นี้' }); return; }
  const snapshot = sessRows[0].crm_snapshot || {};
  const items = Array.isArray(snapshot.items) ? snapshot.items.slice() : [];
  const idx = items.findIndex(function (it) { return it.soNumber === oldSoNumber; });
  if (idx === -1) { res.status(404).json({ error: 'ไม่พบ SO เดิม (' + oldSoNumber + ') ในสัญญานี้ — อาจถูกเปลี่ยนไปแล้วก่อนหน้านี้ ลองรีเฟรชคิว' }); return; }
  // 2026-09-09 แก้บั๊กจริง: newItem มาจาก staff-sign-tab.js's confirmChangeSo ซึ่งประกอบจากผลลัพธ์ crm-lookup
  // ตรงๆ ไม่มี deliveryChannel (ฟิลด์นี้ CS เป็นคนเลือกเองตอนสร้างลิงก์ ไม่ได้มาจาก CRM) — ถ้าไม่รักษาค่าเดิมไว้
  // จะหายไปเงียบๆ ทุกครั้งที่เปลี่ยน SO (กระทบเคส "ผ่อนสะสมยอด" ที่ต้องรู้ช่องทางจัดส่ง/สาขาที่นัดรับตรงๆ)
  if (newItem.deliveryChannel === undefined) newItem.deliveryChannel = items[idx].deliveryChannel || null;
  items[idx] = newItem;
  snapshot.items = items;

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const patchSessRes = await fetch(
    SUPABASE_URL + '/rest/v1/contract_sessions?id=eq.' + encodeURIComponent(sessionId) + '&select=token',
    {
      method: 'PATCH',
      headers: Object.assign({ 'Content-Type': 'application/json', Prefer: 'return=representation' }, authHeaders),
      body: JSON.stringify({ crm_snapshot: snapshot, status: 'needs_correction', expires_at: expiresAt }),
    }
  );
  if (!patchSessRes.ok) {
    const text = await patchSessRes.text();
    throw new Error('อัปเดตข้อมูลสัญญาไม่สำเร็จ (HTTP ' + patchSessRes.status + '): ' + text.slice(0, 300));
  }
  const sessTokenRows = await patchSessRes.json();

  const note = 'เปลี่ยนเลข SO จาก ' + oldSoNumber + ' เป็น ' + newItem.soNumber + ' (สินค้าเปลี่ยน) โดย ' + staffName;
  const patchSubRes = await fetch(
    SUPABASE_URL + '/rest/v1/contract_submissions?id=eq.' + encodeURIComponent(submissionId),
    {
      method: 'PATCH',
      headers: Object.assign({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }, authHeaders),
      body: JSON.stringify({
        rejected_at: new Date().toISOString(), rejected_by: staffName, rejected_fields: ['order'], rejected_note: note,
        staff_signature_path: null, staff_signed_by: null, staff_signed_at: null,
        reviewed_at: null, reviewed_by: null,
      }),
    }
  );
  if (!patchSubRes.ok) {
    const text = await patchSubRes.text();
    throw new Error('อัปเดตสถานะสัญญาไม่สำเร็จ (HTTP ' + patchSubRes.status + '): ' + text.slice(0, 300));
  }

  res.status(200).json({ ok: true, token: sessTokenRows[0] && sessTokenRows[0].token });
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
    if (action === 'changeSo') { await doChangeSo(authHeaders, submissionId, staffName, body.oldSoNumber, body.newItem, res); return; }
    res.status(400).json({ error: 'ไม่รู้จัก action นี้' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
