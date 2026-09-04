// Vercel serverless function — ลูกค้ากด "ส่งข้อมูล" หลังเซ็นชื่อเสร็จ (ขั้นตอนสุดท้ายของ sign.js) เรียกที่นี่
// เพื่อ (1) อัปโหลดรูปเอกสาร/ลายเซ็นเข้า Supabase Storage bucket "contract-files" จริง (2) บันทึกข้อมูลลูกค้า
// ลง contract_submissions (3) อัปเดตสถานะ contract_sessions เป็น 'submitted' — แทนที่ console.log mock เดิม
// (2026-09-04)
//
// ต้องตั้งค่าใน Vercel project settings: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (เหมือน create/get-session)
//
// ข้อจำกัดที่ทราบแล้ว (ยังไม่แก้รอบนี้ — user ขอทดสอบด้วยข้อมูล mock ก่อน): ไฟล์ทั้งหมดส่งมาเป็น base64 ปนกับ
// ข้อมูลลูกค้าใน JSON ก้อนเดียว ถ้าลูกค้าอัปโหลดรูปจริงหลายไฟล์ขนาดใหญ่ (บัตร/เซลฟี่/ผู้ค้ำ/ผู้ปกครอง/ลายเซ็น
// รวมกันได้ถึงหลัก 10+ MB) อาจชนขีดจำกัดขนาด request body ของ Vercel serverless function ได้ — วิธีที่ถูกต้อง
// กว่าสำหรับใช้งานจริงคือให้ browser อัปโหลดตรงเข้า Supabase Storage ผ่าน signed URL แทน (ยังไม่ได้ทำ)

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

async function uploadFile(path, parsed) {
  const r = await fetch(SUPABASE_URL + '/storage/v1/object/contract-files/' + path, {
    method: 'POST',
    headers: {
      'Content-Type': parsed.mime,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY,
      'x-upsert': 'true',
    },
    body: parsed.bytes,
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error('อัปโหลดไฟล์ ' + path + ' ไม่สำเร็จ (HTTP ' + r.status + '): ' + text.slice(0, 200));
  }
  return path;
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
    const token = String((req.body && req.body.token) || '').trim();
    const customer = (req.body && req.body.customer) || {};
    if (!token) {
      res.status(400).json({ error: 'ไม่มี token' });
      return;
    }

    // หา session_id จริงจาก token (contract_submissions.session_id อ้างถึง uuid ไม่ใช่ token เอง)
    const sessRes = await fetch(
      SUPABASE_URL + '/rest/v1/contract_sessions?token=eq.' + encodeURIComponent(token) + '&select=id',
      { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY } }
    );
    const sessRows = await sessRes.json();
    if (!sessRes.ok || !sessRows.length) {
      res.status(404).json({ error: 'ไม่พบลิงก์นี้' });
      return;
    }
    const sessionId = sessRows[0].id;

    // อัปโหลดไฟล์ทั้งหมดที่มี (บัตร/เซลฟี่/ผู้ค้ำ/ผู้ปกครอง/ลายเซ็น) — ข้ามช่องที่เป็น null/ไม่มี
    const fileFields = {
      idCard: customer.files && customer.files.idCard,
      selfieWithId: customer.files && customer.files.selfieWithId,
      guardianId: customer.files && customer.files.guardianId,
      guarantorId: customer.files && customer.files.guarantorId,
      signature: customer.signature,
      guardianSignature: customer.guardianSignature,
      guarantorSignature: customer.guarantorSignature,
    };
    const filePaths = {};
    for (const key of Object.keys(fileFields)) {
      const parsed = parseDataUrl(fileFields[key]);
      if (!parsed) continue;
      const path = 'sessions/' + token + '/' + key + '-' + randomUUID() + '.' + parsed.ext;
      await uploadFile(path, parsed);
      filePaths[key] = path;
    }

    // customer_data เก็บเฉพาะข้อมูลข้อความ ไม่เก็บ base64 รูปซ้ำ (อยู่ใน Storage แล้ว ดูจาก file_paths)
    const customerData = Object.assign({}, customer);
    delete customerData.files;
    delete customerData.signature;
    delete customerData.guardianSignature;
    delete customerData.guarantorSignature;

    const insertRes = await fetch(SUPABASE_URL + '/rest/v1/contract_submissions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ session_id: sessionId, customer_data: customerData, file_paths: filePaths }),
    });
    if (!insertRes.ok) {
      const text = await insertRes.text();
      throw new Error('บันทึกข้อมูลลูกค้าไม่สำเร็จ (HTTP ' + insertRes.status + '): ' + text.slice(0, 300));
    }

    await fetch(SUPABASE_URL + '/rest/v1/contract_sessions?token=eq.' + encodeURIComponent(token), {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ status: 'submitted' }),
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
