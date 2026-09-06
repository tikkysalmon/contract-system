// TEMPORARY — ลบ session ทดสอบ 4 รายการที่ user สร้างเองระหว่างทดสอบเมนู "สำหรับ CS" ตามที่ขอ
// (ลบไฟล์นี้ทิ้งหลังใช้งานเสร็จ)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const TOKENS_TO_DELETE = [
  'bf99c988-46a1-41f4-86f0-ca1b2b18ede9',
  '2aa62a01-aec7-4d27-a5c5-e79b124f2103',
  '7efc6e79-4580-42e5-b305-513f39c97cef',
  '6dd362d6-83a1-492c-85f8-0c2905b7a82b',
];

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({ error: 'ยังไม่ได้ตั้งค่า SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY บน server' });
    return;
  }
  const authHeaders = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY };
  const result = { deleted: [], notFound: [], errors: [] };

  try {
    for (const token of TOKENS_TO_DELETE) {
      const sessRes = await fetch(SUPABASE_URL + '/rest/v1/contract_sessions?token=eq.' + encodeURIComponent(token) + '&select=id', { headers: authHeaders });
      const sessRows = await sessRes.json();
      if (!sessRows.length) { result.notFound.push(token); continue; }
      const sessionId = sessRows[0].id;

      // ลบ submissions ที่ผูกกับ session นี้ก่อน (ถ้ามี — เท่าที่เช็คไว้ทั้ง 4 รายการยังไม่มีใครส่งข้อมูลกลับมา)
      await fetch(SUPABASE_URL + '/rest/v1/contract_submissions?session_id=eq.' + sessionId, { method: 'DELETE', headers: authHeaders });

      const sessDel = await fetch(SUPABASE_URL + '/rest/v1/contract_sessions?id=eq.' + sessionId, { method: 'DELETE', headers: Object.assign({}, authHeaders, { Prefer: 'return=representation' }) });
      const sessDelBody = await sessDel.json().catch(function () { return []; });
      if (sessDelBody.length) result.deleted.push(token); else result.errors.push(token);
    }
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message, partial: result });
  }
};
