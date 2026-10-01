// Vercel serverless function — รวม action ของทีมเร่งรัดหนี้สินต่อ submission หนึ่งใบไว้ที่เดียว (2026-09-06
// รวมจาก staff-sign-submit.js/staff-reject-submission.js/staff-confirm-submission.js เดิม เพื่อลดจำนวน
// serverless function ทั้งโปรเจกต์ — Vercel Hobby plan จำกัดไว้แค่ 12 ฟังก์ชัน/deployment เกินแล้ว deploy
// ล้มเงียบๆ เจอบั๊กจริง 2026-09-06 ตอนเพิ่มเมนูสต๊อค deploy พังเพราะเกินโควต้านี้พอดี)
//
// POST body: { action: 'sign' | 'reject' | 'confirm' | 'changeSo' | 'updateLogistics', submissionId, staffName, ...action-specific fields }
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
//   'updateLogistics' — { soNumber, shippingAddress?, giftItem?, deliveryChannel? } (2026-09-09) — ให้ CS
//     แก้ที่อยู่จัดส่ง/ของแถม/ช่องทางการจัดส่งได้ตรงๆ โดยไม่ต้องผ่านทีมเร่งรัดหนี้สิน (เคส "ลูกค้าเปลี่ยนช่องทาง
//     จัดส่งทีหลัง"/"นัดรับสาขา ผ่อนสะสมยอด") — ยืนยันแล้วว่าทั้ง 3 ฟิลด์นี้ไม่ได้ถูกพิมพ์ลงในตัวเอกสารสัญญาที่
//     เซ็นจริงเลย (ไม่มีที่ไหนอ้างอิงใน preview-contract.js/master template) จึง **ไม่ต้องรีเซ็ต reviewed_at/
//     rejected_at/staff_signed_at เหมือน reject/changeSo** แก้ตรงๆ ได้เลยไม่กระทบสถานะเซ็น/ตรวจสอบ ส่งฟิลด์
//     ไหนมาก็แก้แค่ฟิลด์นั้น (ไม่บังคับส่งครบทั้ง 3) — shippingAddress ไปแก้ contract_submissions.customer_data,
//     giftItem ไปแก้ contract_submissions.customer_data เหมือนกัน, deliveryChannel ไปแก้ item ใน
//     contract_sessions.crm_snapshot.items[] (ต้องมี soNumber ระบุว่าแก้ item ไหน)
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
// 2026-10-01 'address' (เดิม = ที่อยู่+บุคคลอ้างอิงรวมกัน) แยกเป็น address_current/address_shipping/reference — ยังรับ 'address'
// ไว้เพื่อ API/รายการเก่า (sign.js ตีความ 'address' = แก้ครบทั้ง 3 ส่วน)
const ALLOWED_REJECT_FIELDS = ['personal', 'address', 'address_current', 'address_shipping', 'reference', 'guardian', 'guarantor', 'uploads'];

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
  // 2026-10-01 แก้ช่องโหว่เดียวกัน: วัน/เวลานัดรับ (+ประวัติเลื่อนนัด/สถานะรับแล้ว) ก็เป็นข้อมูลที่ CS/หน้าร้านกรอก
  // เอง ไม่ได้มาจาก CRM ต้องย้ายตามไปกับการเปลี่ยน SO ด้วย ไม่งั้นหายเงียบๆ
  ['pickupDate', 'pickupTime', 'pickupHistory', 'pickedUpAt', 'pickedUpBy', 'promoType', 'promoDetail'].forEach(function (k) {
    if (newItem[k] === undefined && items[idx][k] !== undefined) newItem[k] = items[idx][k];
  });
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

// 'markPickedUp' (2026-10-01) — { sessionToken, soNumber, pickedUp: boolean } ลูกค้ามารับสินค้าที่สาขาแล้ว (เมนู
// "ข้อมูลลูกค้า") เก็บ pickedUpAt/pickedUpBy ไว้ใน item ของ crm_snapshot.items[] แบบเดียวกับ deliveryChannel
// ไม่กระทบสถานะเซ็น/ตรวจสอบสัญญา ใช้ได้เฉพาะ item ที่ช่องทางเป็น "นัดรับสาขา..." (แถวส่งพัสดุใช้เลข tracking แทน)
async function doMarkPickedUp(authHeaders, staffName, sessionToken, soNumber, pickedUp, res) {
  if (!sessionToken || !soNumber) { res.status(400).json({ error: 'ข้อมูลไม่ครบ (sessionToken/soNumber)' }); return; }
  const sessRes = await fetch(
    SUPABASE_URL + '/rest/v1/contract_sessions?token=eq.' + encodeURIComponent(sessionToken) + '&select=id,crm_snapshot',
    { headers: authHeaders }
  );
  const sessRows = await sessRes.json();
  if (!sessRes.ok || !sessRows.length) { res.status(404).json({ error: 'ไม่พบ session นี้' }); return; }
  const snapshot = sessRows[0].crm_snapshot || {};
  const items = Array.isArray(snapshot.items) ? snapshot.items.slice() : [];
  const idx = items.findIndex(function (it) { return it.soNumber === soNumber; });
  if (idx === -1) { res.status(404).json({ error: 'ไม่พบ SO นี้ (' + soNumber + ') ในสัญญา' }); return; }
  if (String(items[idx].deliveryChannel || '').indexOf('นัดรับสาขา') !== 0) {
    res.status(400).json({ error: 'SO นี้ไม่ได้เลือกช่องทางนัดรับสาขา' });
    return;
  }
  items[idx] = Object.assign({}, items[idx], pickedUp
    ? { pickedUpAt: new Date().toISOString(), pickedUpBy: staffName }
    : { pickedUpAt: null, pickedUpBy: null });
  snapshot.items = items;
  const patchRes = await fetch(SUPABASE_URL + '/rest/v1/contract_sessions?id=eq.' + encodeURIComponent(sessRows[0].id), {
    method: 'PATCH',
    headers: Object.assign({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }, authHeaders),
    body: JSON.stringify({ crm_snapshot: snapshot }),
  });
  if (!patchRes.ok) {
    const text = await patchRes.text();
    throw new Error('บันทึกสถานะรับสินค้าไม่สำเร็จ (HTTP ' + patchRes.status + '): ' + text.slice(0, 300));
  }
  res.status(200).json({ ok: true });
}

// 'reschedulePickup' (2026-10-01) — { sessionToken, soNumber, pickupDate:'YYYY-MM-DD', pickupTime:'HH:MM', reason? }
// ลูกค้าขอเลื่อนนัดรับที่สาขา พนักงานหน้าร้านกรอกวัน/เวลาใหม่ — เขียนทับ pickupDate/pickupTime ของ item (ค่าที่
// เมนูอื่นอ่านอยู่แล้ว จึงตามไปทุกที่อัตโนมัติ) และต่อประวัติไว้ใน pickupHistory[] (ค่าเดิม → ค่าใหม่/เหตุผล/ใคร/เมื่อไหร่)
// ใช้ได้เฉพาะ item ที่เป็นนัดรับสาขาและยังไม่ถูกกด "ลูกค้ารับสินค้าแล้ว"
async function doReschedulePickup(authHeaders, staffName, sessionToken, soNumber, pickupDate, pickupTime, reason, res) {
  if (!sessionToken || !soNumber) { res.status(400).json({ error: 'ข้อมูลไม่ครบ (sessionToken/soNumber)' }); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pickupDate || '')) { res.status(400).json({ error: 'กรุณาระบุวันที่นัดรับใหม่' }); return; }
  if (!/^\d{2}:\d{2}$/.test(pickupTime || '')) { res.status(400).json({ error: 'กรุณาระบุเวลานัดรับใหม่' }); return; }
  const sessRes = await fetch(
    SUPABASE_URL + '/rest/v1/contract_sessions?token=eq.' + encodeURIComponent(sessionToken) + '&select=id,crm_snapshot',
    { headers: authHeaders }
  );
  const sessRows = await sessRes.json();
  if (!sessRes.ok || !sessRows.length) { res.status(404).json({ error: 'ไม่พบ session นี้' }); return; }
  const snapshot = sessRows[0].crm_snapshot || {};
  const items = Array.isArray(snapshot.items) ? snapshot.items.slice() : [];
  const idx = items.findIndex(function (it) { return it.soNumber === soNumber; });
  if (idx === -1) { res.status(404).json({ error: 'ไม่พบ SO นี้ (' + soNumber + ') ในสัญญา' }); return; }
  const cur = items[idx];
  if (String(cur.deliveryChannel || '').indexOf('นัดรับสาขา') !== 0) { res.status(400).json({ error: 'SO นี้ไม่ได้เลือกช่องทางนัดรับสาขา' }); return; }
  if (cur.pickedUpAt) { res.status(400).json({ error: 'SO นี้ลูกค้ารับสินค้าแล้ว เลื่อนนัดไม่ได้' }); return; }
  if (cur.pickupDate === pickupDate && cur.pickupTime === pickupTime) { res.status(400).json({ error: 'วัน/เวลาที่ระบุตรงกับนัดเดิม' }); return; }
  const history = Array.isArray(cur.pickupHistory) ? cur.pickupHistory.slice() : [];
  history.push({
    fromDate: cur.pickupDate || null, fromTime: cur.pickupTime || null, toDate: pickupDate, toTime: pickupTime,
    reason: String(reason || '').trim() || null, by: staffName, at: new Date().toISOString(),
  });
  items[idx] = Object.assign({}, cur, { pickupDate: pickupDate, pickupTime: pickupTime, pickupHistory: history });
  snapshot.items = items;
  const patchRes = await fetch(SUPABASE_URL + '/rest/v1/contract_sessions?id=eq.' + encodeURIComponent(sessRows[0].id), {
    method: 'PATCH',
    headers: Object.assign({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }, authHeaders),
    body: JSON.stringify({ crm_snapshot: snapshot }),
  });
  if (!patchRes.ok) {
    const text = await patchRes.text();
    throw new Error('บันทึกการเลื่อนนัดรับไม่สำเร็จ (HTTP ' + patchRes.status + '): ' + text.slice(0, 300));
  }
  res.status(200).json({ ok: true });
}

// 'updateShippingRecipient' (2026-10-01) — { sessionToken, recipientName?, recipientPhone?, note? } แก้ชื่อผู้รับสินค้า/
// เบอร์โทร/หมายเหตุ ของการจัดส่ง (เมนู "ข้อมูลลูกค้า") — เขียนเฉพาะ 3 ฟิลด์นี้ลง customer_data.shippingAddress ของ
// submission ล่าสุดของ session นั้น ไม่แตะที่อยู่/สถานะเซ็น/ตรวจสอบสัญญา (ต่างจาก updateLogistics ที่เขียนทับทั้งที่อยู่)
async function doUpdateShippingRecipient(authHeaders, staffName, sessionToken, fields, res) {
  if (!sessionToken) { res.status(400).json({ error: 'ข้อมูลไม่ครบ (sessionToken)' }); return; }
  const sessRes = await fetch(
    SUPABASE_URL + '/rest/v1/contract_sessions?token=eq.' + encodeURIComponent(sessionToken) + '&select=id',
    { headers: authHeaders }
  );
  const sessRows = await sessRes.json();
  if (!sessRes.ok || !sessRows.length) { res.status(404).json({ error: 'ไม่พบ session นี้' }); return; }
  const subRes = await fetch(
    SUPABASE_URL + '/rest/v1/contract_submissions?session_id=eq.' + encodeURIComponent(sessRows[0].id) +
      '&select=id,customer_data&order=submitted_at.desc&limit=1',
    { headers: authHeaders }
  );
  const subRows = await subRes.json();
  if (!subRes.ok || !subRows.length) { res.status(404).json({ error: 'ลูกค้ายังไม่ได้ส่งข้อมูลมา จึงยังแก้ไขไม่ได้' }); return; }
  const customerData = subRows[0].customer_data || {};
  const ship = Object.assign({}, customerData.shippingAddress || {});
  if (fields.recipientName !== undefined) ship.recipientName = String(fields.recipientName || '').trim();
  if (fields.recipientPhone !== undefined) {
    const phone = String(fields.recipientPhone || '').replace(/[\s-]/g, '');
    if (phone && !/^0\d{9}$/.test(phone)) { res.status(400).json({ error: 'เบอร์โทรไม่ถูกต้อง (ต้องเป็นเบอร์ไทย 10 หลัก)' }); return; }
    ship.recipientPhone = phone;
  }
  if (fields.note !== undefined) ship.note = String(fields.note || '').trim();
  customerData.shippingAddress = ship;
  const patchRes = await fetch(SUPABASE_URL + '/rest/v1/contract_submissions?id=eq.' + encodeURIComponent(subRows[0].id), {
    method: 'PATCH',
    headers: Object.assign({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }, authHeaders),
    body: JSON.stringify({ customer_data: customerData }),
  });
  if (!patchRes.ok) {
    const text = await patchRes.text();
    throw new Error('บันทึกข้อมูลผู้รับสินค้าไม่สำเร็จ (HTTP ' + patchRes.status + '): ' + text.slice(0, 300));
  }
  res.status(200).json({ ok: true });
}

async function doUpdateLogistics(authHeaders, submissionId, staffName, soNumber, shippingAddress, giftItem, deliveryChannel, pickupDate, pickupTime, res) {
  const hasCustomerDataUpdate = shippingAddress !== undefined || giftItem !== undefined;
  const hasDeliveryChannelUpdate = deliveryChannel !== undefined;
  if (!hasCustomerDataUpdate && !hasDeliveryChannelUpdate) { res.status(400).json({ error: 'ไม่มีข้อมูลที่จะแก้ไข' }); return; }

  if (hasCustomerDataUpdate) {
    const subRes = await fetch(
      SUPABASE_URL + '/rest/v1/contract_submissions?id=eq.' + encodeURIComponent(submissionId) + '&select=customer_data',
      { headers: authHeaders }
    );
    const subRows = await subRes.json();
    if (!subRes.ok || !subRows.length) { res.status(404).json({ error: 'ไม่พบรายการนี้' }); return; }
    const customerData = subRows[0].customer_data || {};
    // เซ็ต sameAsCurrent เป็น false เสมอตอน CS แก้ตรงนี้ — ให้ค่าที่แก้มีผลจริงเป็นที่อยู่จัดส่งตัวสุดท้าย
    // (ไม่งั้นถ้า flag เดิมเป็น true ระบบอื่น (เช่น stock-orders.js) จะ fallback ไปใช้ที่อยู่ปัจจุบันแทนเงียบๆ)
    if (shippingAddress !== undefined) customerData.shippingAddress = Object.assign({}, shippingAddress, { sameAsCurrent: false });
    if (giftItem !== undefined) customerData.giftItem = giftItem;
    const patchRes = await fetch(
      SUPABASE_URL + '/rest/v1/contract_submissions?id=eq.' + encodeURIComponent(submissionId),
      {
        method: 'PATCH',
        headers: Object.assign({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }, authHeaders),
        body: JSON.stringify({ customer_data: customerData }),
      }
    );
    if (!patchRes.ok) {
      const text = await patchRes.text();
      throw new Error('บันทึกที่อยู่จัดส่ง/ของแถมไม่สำเร็จ (HTTP ' + patchRes.status + '): ' + text.slice(0, 300));
    }
  }

  if (hasDeliveryChannelUpdate) {
    if (!soNumber) { res.status(400).json({ error: 'ไม่มี soNumber (จำเป็นสำหรับแก้ช่องทางการจัดส่ง)' }); return; }
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
    const idx = items.findIndex(function (it) { return it.soNumber === soNumber; });
    if (idx === -1) { res.status(404).json({ error: 'ไม่พบ SO นี้ (' + soNumber + ') ในสัญญา' }); return; }
    // วัน/เวลานัดรับ (2026-10-01) — ใช้เฉพาะช่องทาง "นัดรับสาขา..." ถ้าเปลี่ยนไปช่องทางอื่นต้องเคลียร์ทิ้ง ไม่งั้น
    // ค้างเป็นนัดรับผีในเมนู "ข้อมูลลูกค้า"/ใบเบิกสินค้า ส่วนวัน/เวลาที่ส่งมาด้วย (ถ้ามี) CS แก้ตรงๆ ในฐานะแก้ไข
    // ข้อมูลผิด ไม่นับเป็นการ "เลื่อนนัด" (ประวัติเลื่อนนัดบันทึกเฉพาะ action reschedulePickup)
    const isPickupChannel = String(deliveryChannel || '').indexOf('นัดรับสาขา') === 0;
    const patch = { deliveryChannel: deliveryChannel };
    if (!isPickupChannel) {
      patch.pickupDate = null; patch.pickupTime = null; patch.pickedUpAt = null; patch.pickedUpBy = null;
    } else {
      if (pickupDate !== undefined) patch.pickupDate = pickupDate || null;
      if (pickupTime !== undefined) patch.pickupTime = pickupTime || null;
    }
    items[idx] = Object.assign({}, items[idx], patch);
    snapshot.items = items;

    const patchSessRes = await fetch(
      SUPABASE_URL + '/rest/v1/contract_sessions?id=eq.' + encodeURIComponent(sessionId),
      {
        method: 'PATCH',
        headers: Object.assign({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }, authHeaders),
        body: JSON.stringify({ crm_snapshot: snapshot }),
      }
    );
    if (!patchSessRes.ok) {
      const text = await patchSessRes.text();
      throw new Error('บันทึกช่องทางการจัดส่งไม่สำเร็จ (HTTP ' + patchSessRes.status + '): ' + text.slice(0, 300));
    }
  }

  res.status(200).json({ ok: true });
}

// 2026-09-24 "ดีลเปลี่ยนสินค้า" — จัดซื้อสร้างรายการนี้จากเมนู "สำหรับจัดซื้อ" ตอนหาสินค้าเดิมไม่ได้แล้ว (ต้อง
// รันสคริปต์ supabase-product-deal-changes.sql ก่อนใช้งาน) — ไม่เพิ่ม endpoint ใหม่ (ชนโควต้า 12 ฟังก์ชันของ
// Vercel Hobby plan พอดีอยู่แล้ว) รวมไว้ในไฟล์นี้เหมือน action อื่นๆ ผลลัพธ์ที่บันทึกอ่านออกมาแสดงผ่าน
// api/stock-orders.js (join เข้ากับแต่ละ order ด้วย so_number ให้ทั้งเมนู "สำหรับจัดซื้อ"/"สำหรับสต๊อค" เห็นตรงกัน)
async function doCreateDealChange(authHeaders, staffName, soNumber, originalProduct, originalColor, replacementProduct, note, res) {
  if (!soNumber || !originalProduct || !replacementProduct) {
    res.status(400).json({ error: 'ข้อมูลไม่ครบ (soNumber/originalProduct/replacementProduct)' });
    return;
  }
  const insertRes = await fetch(SUPABASE_URL + '/rest/v1/product_deal_changes', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }, authHeaders),
    body: JSON.stringify({
      so_number: soNumber, original_product: originalProduct, original_color: originalColor || null,
      replacement_product: replacementProduct, note: note || null, status: 'pending', created_by: staffName,
    }),
  });
  if (!insertRes.ok) {
    const text = await insertRes.text();
    throw new Error('สร้างรายการดีลเปลี่ยนสินค้าไม่สำเร็จ (HTTP ' + insertRes.status + '): ' + text.slice(0, 300) +
      ' — ตรวจว่ารัน supabase-product-deal-changes.sql แล้วหรือยัง');
  }
  res.status(200).json({ ok: true });
}

// สต๊อคติดต่อลูกค้าแล้วปิดสถานะ — 'deal_success' (ดีลสำเร็จ) หรือ 'cancelled_refund' (ยกเลิกสัญญาคืนเงิน)
async function doSetDealChangeStatus(authHeaders, staffName, dealChangeId, status, res) {
  if (!dealChangeId || ['deal_success', 'cancelled_refund'].indexOf(status) === -1) {
    res.status(400).json({ error: 'ข้อมูลไม่ครบ/สถานะไม่ถูกต้อง (dealChangeId/status)' });
    return;
  }
  const patchRes = await fetch(SUPABASE_URL + '/rest/v1/product_deal_changes?id=eq.' + encodeURIComponent(dealChangeId), {
    method: 'PATCH',
    headers: Object.assign({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }, authHeaders),
    body: JSON.stringify({ status: status, resolved_by: staffName, resolved_at: new Date().toISOString() }),
  });
  if (!patchRes.ok) {
    const text = await patchRes.text();
    throw new Error('บันทึกสถานะดีลเปลี่ยนสินค้าไม่สำเร็จ (HTTP ' + patchRes.status + '): ' + text.slice(0, 300));
  }
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
    const staffName = String(body.staffName || '').trim();
    if (!staffName) { res.status(400).json({ error: 'ข้อมูลไม่ครบ (staffName)' }); return; }
    const authHeaders = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY };

    // "ดีลเปลี่ยนสินค้า" ไม่ผูกกับ submissionId (ผูกกับ so_number ตรงๆ) — เช็คแยกจาก action อื่นด้านล่างที่ต้องมี
    if (action === 'createDealChange') {
      await doCreateDealChange(authHeaders, staffName, body.soNumber, body.originalProduct, body.originalColor, body.replacementProduct, body.note, res);
      return;
    }
    if (action === 'setDealChangeStatus') {
      await doSetDealChangeStatus(authHeaders, staffName, body.dealChangeId, body.status, res);
      return;
    }

    if (action === 'markPickedUp') {
      await doMarkPickedUp(authHeaders, staffName, String(body.sessionToken || '').trim(), String(body.soNumber || '').trim(), !!body.pickedUp, res);
      return;
    }

    if (action === 'updateShippingRecipient') {
      await doUpdateShippingRecipient(authHeaders, staffName, String(body.sessionToken || '').trim(),
        { recipientName: body.recipientName, recipientPhone: body.recipientPhone, note: body.note }, res);
      return;
    }
    if (action === 'reschedulePickup') {
      await doReschedulePickup(authHeaders, staffName, String(body.sessionToken || '').trim(), String(body.soNumber || '').trim(),
        String(body.pickupDate || '').trim(), String(body.pickupTime || '').trim(), body.reason, res);
      return;
    }

    const submissionId = String(body.submissionId || '').trim();
    if (!submissionId) { res.status(400).json({ error: 'ข้อมูลไม่ครบ (submissionId)' }); return; }

    if (action === 'sign') { await doSign(authHeaders, submissionId, staffName, body.signatureDataUrl, res); return; }
    if (action === 'reject') { await doReject(authHeaders, submissionId, staffName, body.rejectedFields, body.note, res); return; }
    if (action === 'confirm') { await doConfirm(authHeaders, submissionId, staffName, res); return; }
    if (action === 'changeSo') { await doChangeSo(authHeaders, submissionId, staffName, body.oldSoNumber, body.newItem, res); return; }
    if (action === 'updateLogistics') {
      await doUpdateLogistics(authHeaders, submissionId, staffName, body.soNumber, body.shippingAddress, body.giftItem, body.deliveryChannel, body.pickupDate, body.pickupTime, res);
      return;
    }
    res.status(400).json({ error: 'ไม่รู้จัก action นี้' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
