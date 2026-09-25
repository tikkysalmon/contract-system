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
const IAPP_API_KEY = process.env.IAPP_API_KEY;

// 2026-09-25 "อ่านข้อมูลจากบัตรประชาชนอัตโนมัติ" (ส่วนที่ 1 ของ flow ใหม่ที่ user ขอ — ถ่ายบัตร -> OCR ->
// เติมข้อมูลให้ลูกค้าตรวจสอบ ก่อนเข้าขั้นตอนกรอกข้อมูลส่วนตัว/ที่อยู่ตามปกติ) ส่วนที่ 2 เปลี่ยนจาก active liveness
// เป็นเทียบใบหน้าธรรมดาแทน (ดู handleCompareFaces ด้านล่าง)
//
// **รอบแรกทำด้วย Claude vision (ANTHROPIC_API_KEY) ไปก่อน — เปลี่ยนมาใช้ iApp Technology's Thai National ID
// Card OCR แทนแล้ว (2026-09-25 user ขอทดลอง iApp ตัวเดียวกับที่ตั้งค่า IAPP_API_KEY ไว้แล้วสำหรับเทียบใบหน้า
// อยู่แล้ว ไม่ต้องสมัคร Anthropic เพิ่มอีกเจ้า)** เป็นโมเดลเฉพาะทางสำหรับบัตรไทยโดยตรง แม่นกว่า/มีฟิลด์แยกชัดเจน
// กว่าให้ vision LLM ทั่วไปอ่านเอง (ราคา 1.25 IC/ครั้ง แพงกว่า Claude แต่ยังถูกมาก และไม่ต้องมี vendor 2 เจ้า)
// ดู https://iapp.co.th/docs/ekyc/thai-national-id-card — **ยังไม่เคยทดสอบกับบัตรจริง/API key จริง** เพราะยัง
// ไม่มี key ให้ทดสอบตอนเขียนโค้ดนี้ ทดสอบกับบัตรจริงครั้งแรกก่อนเชื่อผลลัพธ์ทั้งหมด
//
// รวมไว้ในไฟล์นี้แทนที่จะสร้าง endpoint ใหม่ (api/submit-contract.js เป็น endpoint สาธารณะที่ลูกค้าเรียกได้
// โดยไม่ต้องล็อกอินอยู่แล้ว ตรงกับ use case นี้พอดี) — Vercel Hobby plan จำกัด 12 ฟังก์ชัน/deployment เต็มโควต้า
// อยู่แล้ว (ดู staff-actions.js ที่ทำแบบเดียวกัน)
//
// ต้องตั้งค่าใน Vercel project settings: IAPP_API_KEY (ตัวเดียวกับ handleCompareFaces ด้านล่าง)

// en_dob จาก iApp เป็นรูปแบบ "15 Mar. 1957" (วัน + เดือนย่อภาษาอังกฤษมีจุด ยกเว้น May ไม่มีจุด + ปี ค.ศ.) —
// แปลงเองแทนใช้ new Date(string) ตรงๆ เพราะรูปแบบนี้ไม่ใช่มาตรฐานที่ JS Date รับประกันว่า parse ถูกทุกเอนจิน
const EN_MONTH_MAP = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};
function computeAgeFromEnDob(enDob) {
  if (!enDob) return null;
  const m = /^(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(\d{4})$/.exec(String(enDob).trim());
  if (!m) return null;
  const monthIdx = EN_MONTH_MAP[m[2].slice(0, 3).toLowerCase()];
  if (monthIdx == null) return null;
  const dobDate = new Date(Number(m[3]), monthIdx, Number(m[1]));
  if (isNaN(dobDate)) return null;
  const today = new Date();
  let age = today.getFullYear() - dobDate.getFullYear();
  const notYetBirthday = today.getMonth() < dobDate.getMonth() ||
    (today.getMonth() === dobDate.getMonth() && today.getDate() < dobDate.getDate());
  if (notYetBirthday) age--;
  return age;
}

async function handleOcrIdCard(req, res) {
  if (!IAPP_API_KEY) {
    res.status(500).json({ error: 'ยังไม่ได้ตั้งค่า IAPP_API_KEY บน server' });
    return;
  }
  const parsed = parseDataUrl(req.body && req.body.imageDataUrl);
  if (!parsed) { res.status(400).json({ error: 'ไม่มีรูปบัตรประชาชน หรือรูปแบบไฟล์ไม่ถูกต้อง' }); return; }
  try {
    const form = new FormData();
    form.append('file', new Blob([parsed.bytes], { type: parsed.mime }), 'idcard.' + parsed.ext);
    const iappRes = await fetch('https://api.iapp.co.th/v3/store/ekyc/thai-national-id-card/front', {
      method: 'POST',
      headers: { apikey: IAPP_API_KEY },
      body: form,
    });
    const body = await iappRes.json();
    if (!iappRes.ok) throw new Error(body.message || body.error || ('iApp API error HTTP ' + iappRes.status));

    const firstLastName = [body.th_fname, body.th_lname].filter(Boolean).join(' ') || null;
    const addressParts = [body.address, body.sub_district, body.district, body.province].filter(Boolean);

    res.status(200).json({
      title: body.th_init || null,
      firstLastName: firstLastName,
      citizenId: body.id_number || null,
      age: computeAgeFromEnDob(body.en_dob),
      address: addressParts.length ? addressParts.join(' ') : null,
    });
  } catch (err) {
    res.status(500).json({ error: 'อ่านข้อมูลจากบัตรไม่สำเร็จ: ' + err.message });
  }
}

function parseDataUrl(dataUrl) {
  if (!dataUrl) return null;
  const m = /^data:([\w.-]+\/[\w.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  const mime = m[1];
  const ext = mime.split('/')[1] === 'jpeg' ? 'jpg' : mime.split('/')[1];
  return { mime: mime, ext: ext, bytes: Buffer.from(m[2], 'base64') };
}

// 2026-09-25 "ตรวจสอบใบหน้ารูปคู่บัตรตรงกับรูปบนบัตรประชาชนไหม" (ตัดสินใจแล้วว่าไม่ทำ active liveness เต็มรูปแบบ
// — ใช้ iApp Technology's Face Comparison API เทียบรูปนิ่ง 2 รูปแทน ถูกกว่า/ง่ายกว่า liveness เต็มรูปแบบมาก
// และตอบโจทย์ที่ต้องการจริงๆ คือเช็คว่าคนถ่ายคู่บัตรเป็นคนเดียวกับรูปบนบัตรหรือไม่ — ดู
// https://iapp.co.th/docs/ekyc/face-recognition, ราคา 0.3 IC/ครั้ง (~0.4 บาท)) ผลลัพธ์เป็นแค่ "ค่าความเหมือน"
// ให้พนักงานตรวจสอบประกอบการพิจารณา ไม่ได้บล็อกลูกค้าส่งฟอร์มไม่ให้ผ่านถ้าค่าต่ำ (กันเคส false-negative จากรูป
// คุณภาพต่ำ/แสงไม่ดี ปิดกั้นลูกค้าจริงเกินจำเป็น) — รวมไว้ในไฟล์นี้เหมือน ocrIdCard ด้านบน ไม่เพิ่ม endpoint ใหม่
async function handleCompareFaces(req, res) {
  if (!IAPP_API_KEY) {
    res.status(500).json({ error: 'ยังไม่ได้ตั้งค่า IAPP_API_KEY บน server' });
    return;
  }
  const idCardParsed = parseDataUrl(req.body && req.body.idCardImage);
  const selfieParsed = parseDataUrl(req.body && req.body.selfieImage);
  if (!idCardParsed || !selfieParsed) {
    res.status(400).json({ error: 'ไม่มีรูปบัตรประชาชนหรือรูปคู่บัตรให้เปรียบเทียบ' });
    return;
  }
  try {
    const form = new FormData();
    form.append('file1', new Blob([idCardParsed.bytes], { type: idCardParsed.mime }), 'idcard.' + idCardParsed.ext);
    form.append('file2', new Blob([selfieParsed.bytes], { type: selfieParsed.mime }), 'selfie.' + selfieParsed.ext);
    const iappRes = await fetch('https://api.iapp.co.th/v3/store/ekyc/face-comparison', {
      method: 'POST',
      headers: { apikey: IAPP_API_KEY },
      body: form,
    });
    const iappBody = await iappRes.json();
    if (!iappRes.ok) throw new Error(iappBody.message || iappBody.error || ('iApp API error HTTP ' + iappRes.status));
    res.status(200).json({
      similarityScore: iappBody.similarity_score != null ? iappBody.similarity_score : null,
      match: iappBody.match != null ? iappBody.match : null,
      face1Detected: iappBody.status ? iappBody.status.face1_detected : null,
      face2Detected: iappBody.status ? iappBody.status.face2_detected : null,
    });
  } catch (err) {
    res.status(500).json({ error: 'เปรียบเทียบใบหน้าไม่สำเร็จ: ' + err.message });
  }
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
  res.setHeader('Cache-Control', 'no-store'); // 2026-09-04 กัน Vercel edge cache เสิร์ฟข้อมูลเก่า (บั๊กจริงที่เจอ: GET /api/staff-signature หลังอัปเดตแล้วยังได้ค่าเก่า)
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  // OCR บัตรประชาชน / เปรียบเทียบใบหน้า (2026-09-25) ไม่ต้องมี token/Supabase — แยกออกก่อนเช็ค SUPABASE_URL/KEY ด้านล่าง
  if (req.body && req.body.action === 'ocrIdCard') { await handleOcrIdCard(req, res); return; }
  if (req.body && req.body.action === 'compareFaces') { await handleCompareFaces(req, res); return; }
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
    const authHeaders = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY };

    // ส่งซ้ำหลังพนักงานปฏิเสธ/ขอแก้ไข (2026-09-06) — มีแถว contract_submissions เดิมของ session นี้อยู่แล้ว
    // 1 แถวเสมอ (ไม่ insert ซ้ำ) หาไว้ก่อนเผื่อต้อง (1) UPDATE แถวเดิมแทน insert ใหม่ (2) เอา path รูปเดิมมาใช้
    // ต่อสำหรับฟิลด์รูปที่รอบนี้ไม่ได้ให้แก้ (sign.js ไม่โชว์ขั้นตอนอัปโหลดใหม่ให้ ค่าที่ส่งมาจะเป็น null)
    const existingRes = await fetch(
      SUPABASE_URL + '/rest/v1/contract_submissions?session_id=eq.' + encodeURIComponent(sessionId) + '&select=id,file_paths',
      { headers: authHeaders }
    );
    const existingRows = existingRes.ok ? await existingRes.json() : [];
    const existing = existingRows[0] || null;
    const existingFilePaths = (existing && existing.file_paths) || {};

    // อัปโหลดไฟล์ทั้งหมดที่มีมาใหม่รอบนี้ (บัตร/เซลฟี่/ผู้ค้ำ/ผู้ปกครอง/ลายเซ็น) — ข้ามช่องที่เป็น null/ไม่มี
    const fileFields = {
      idCard: customer.files && customer.files.idCard,
      selfieWithId: customer.files && customer.files.selfieWithId,
      guardianId: customer.files && customer.files.guardianId,
      guarantorId: customer.files && customer.files.guarantorId,
      signature: customer.signature,
      guardianSignature: customer.guardianSignature,
      guarantorSignature: customer.guarantorSignature,
    };
    const filePaths = Object.assign({}, existingFilePaths); // เริ่มจาก path เดิมทั้งหมด แล้วทับด้วยไฟล์ใหม่ที่ส่งมารอบนี้
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

    if (existing) {
      // อัปเดตแถวเดิม + เคลียร์สถานะปฏิเสธ/เซ็นของพนักงานทิ้ง (ต้องให้พนักงานตรวจ/เซ็นใหม่จากข้อมูลที่แก้แล้ว)
      const updateRes = await fetch(SUPABASE_URL + '/rest/v1/contract_submissions?id=eq.' + encodeURIComponent(existing.id), {
        method: 'PATCH',
        headers: Object.assign({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }, authHeaders),
        body: JSON.stringify({
          customer_data: customerData,
          file_paths: filePaths,
          submitted_at: new Date().toISOString(),
          rejected_at: null,
          rejected_by: null,
          rejected_fields: null,
          rejected_note: null,
          staff_signature_path: null,
          staff_signed_by: null,
          staff_signed_at: null,
          reviewed_at: null, // ข้อมูลแก้ไขใหม่แล้ว การยืนยันตรวจสอบเดิม (ถ้ามี) เป็นโมฆะ ต้องยืนยันใหม่
          reviewed_by: null,
        }),
      });
      if (!updateRes.ok) {
        const text = await updateRes.text();
        throw new Error('บันทึกข้อมูลลูกค้าไม่สำเร็จ (HTTP ' + updateRes.status + '): ' + text.slice(0, 300));
      }
    } else {
      const insertRes = await fetch(SUPABASE_URL + '/rest/v1/contract_submissions', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }, authHeaders),
        body: JSON.stringify({ session_id: sessionId, customer_data: customerData, file_paths: filePaths }),
      });
      if (!insertRes.ok) {
        const text = await insertRes.text();
        throw new Error('บันทึกข้อมูลลูกค้าไม่สำเร็จ (HTTP ' + insertRes.status + '): ' + text.slice(0, 300));
      }
    }

    await fetch(SUPABASE_URL + '/rest/v1/contract_sessions?token=eq.' + encodeURIComponent(token), {
      method: 'PATCH',
      headers: Object.assign({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }, authHeaders),
      body: JSON.stringify({ status: 'submitted' }),
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
