// Vercel serverless function — บันทึก/ดึงลายเซ็นที่พนักงานเคยวาดไว้ ให้ใช้ซ้ำได้โดยไม่ต้องวาดใหม่ทุกครั้ง
// (2026-09-04 user ขอ "ลดเวลาในการวาดลายเซ็น" — เก็บฝั่ง server ผูกกับ username ไม่ใช่แค่ localStorage เพราะ
// ต้องใช้งานได้ข้ามเครื่อง/เบราว์เซอร์ + คนละคนต้องไม่เห็นลายเซ็นของกันและกัน กรองด้วย username ตรงๆ)
//
// GET ?username=xxx  -> { signatureDataUrl } (null ถ้ายังไม่เคยบันทึก)
// POST { username, signatureDataUrl } -> { ok: true }  (upsert — เขียนทับของเดิมถ้ามี)
//
// ต้องตั้งค่าใน Vercel project settings: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ต้องรัน supabase-staff-signature.sql รอบ 2 ก่อน (สร้างตาราง staff_signatures)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET_PREFIX = 'staff-saved-signatures/'; // ใน bucket "contract-files" เดิม (คนละ prefix กับลายเซ็นที่เซ็นจริงต่อสัญญา)

function parseDataUrl(dataUrl) {
  if (!dataUrl) return null;
  const m = /^data:([\w.-]+\/[\w.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  const mime = m[1];
  const ext = mime.split('/')[1] === 'jpeg' ? 'jpg' : mime.split('/')[1];
  return { mime: mime, ext: ext, bytes: Buffer.from(m[2], 'base64') };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store'); // 2026-09-04 กัน Vercel edge cache เสิร์ฟข้อมูลเก่า (บั๊กจริงที่เจอ: GET /api/staff-signature หลังอัปเดตแล้วยังได้ค่าเก่า)
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({ error: 'ยังไม่ได้ตั้งค่า SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY บน server' });
    return;
  }
  const authHeaders = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY };

  if (req.method === 'GET') {
    const username = String((req.query && req.query.username) || '').trim();
    if (!username) { res.status(400).json({ error: 'ไม่มี username' }); return; }
    try {
      const r = await fetch(
        SUPABASE_URL + '/rest/v1/staff_signatures?username=eq.' + encodeURIComponent(username) + '&select=signature_path',
        { headers: authHeaders }
      );
      if (!r.ok) throw new Error('เรียก Supabase ไม่สำเร็จ (HTTP ' + r.status + ')');
      const rows = await r.json();
      if (!rows.length) { res.status(200).json({ signatureDataUrl: null }); return; }
      const fileRes = await fetch(SUPABASE_URL + '/storage/v1/object/contract-files/' + rows[0].signature_path, { headers: authHeaders });
      if (!fileRes.ok) { res.status(200).json({ signatureDataUrl: null }); return; } // record มีแต่ไฟล์หาย — ไม่ error ทั้งระบบ แค่ถือว่ายังไม่มี
      const buf = Buffer.from(await fileRes.arrayBuffer());
      res.status(200).json({ signatureDataUrl: 'data:image/png;base64,' + buf.toString('base64') });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
    return;
  }

  if (req.method === 'POST') {
    const username = String((req.body && req.body.username) || '').trim();
    const dataUrl = req.body && req.body.signatureDataUrl;
    if (!username || !dataUrl) { res.status(400).json({ error: 'ข้อมูลไม่ครบ (username/signatureDataUrl)' }); return; }
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) { res.status(400).json({ error: 'รูปลายเซ็นไม่ถูกต้อง' }); return; }
    try {
      const path = BUCKET_PREFIX + username.replace(/[^a-zA-Z0-9_.-]/g, '_') + '.' + parsed.ext;
      const uploadRes = await fetch(SUPABASE_URL + '/storage/v1/object/contract-files/' + path, {
        method: 'POST',
        headers: Object.assign({}, authHeaders, { 'Content-Type': parsed.mime, 'x-upsert': 'true' }),
        body: parsed.bytes,
      });
      if (!uploadRes.ok) {
        const text = await uploadRes.text();
        throw new Error('อัปโหลดลายเซ็นไม่สำเร็จ (HTTP ' + uploadRes.status + '): ' + text.slice(0, 200));
      }
      const upsertRes = await fetch(SUPABASE_URL + '/rest/v1/staff_signatures', {
        method: 'POST',
        headers: Object.assign({}, authHeaders, { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' }),
        body: JSON.stringify({ username: username, signature_path: path, updated_at: new Date().toISOString() }),
      });
      if (!upsertRes.ok) {
        const text = await upsertRes.text();
        throw new Error('บันทึกไม่สำเร็จ (HTTP ' + upsertRes.status + '): ' + text.slice(0, 200));
      }
      res.status(200).json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
