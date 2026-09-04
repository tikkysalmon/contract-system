// TEMPORARY — ทดสอบว่า public read URL ของ Storage bucket "contract-files" ใช้รูปแบบไหน (ลบไฟล์นี้ทิ้งหลังใช้)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const authHeaders = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY };
  const path = 'debug-test/url-check.png';
  const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  try {
    const up = await fetch(SUPABASE_URL + '/storage/v1/object/contract-files/' + path, {
      method: 'POST',
      headers: Object.assign({}, authHeaders, { 'Content-Type': 'image/png', 'x-upsert': 'true' }),
      body: tinyPng,
    });
    const uploadResult = { ok: up.ok, status: up.status };
    res.status(200).json({ uploadResult: uploadResult, urlNoPublic: SUPABASE_URL + '/storage/v1/object/contract-files/' + path, urlWithPublic: SUPABASE_URL + '/storage/v1/object/public/contract-files/' + path });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
