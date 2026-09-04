// TEMPORARY — ใช้ครั้งเดียวลบข้อมูลทดสอบของรอบนี้ (CS link-tracking + submission full-detail view) —
// ลบไฟล์นี้ทิ้งหลังใช้งานเสร็จ
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({ error: 'ยังไม่ได้ตั้งค่า SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY บน server' });
    return;
  }
  const authHeaders = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY };
  const token = String((req.query && req.query.token) || '').trim();
  const result = { deletedSubmissions: 0, deletedSessions: 0, deletedFiles: [], errors: [] };

  try {
    if (token) {
      const sessRes = await fetch(SUPABASE_URL + '/rest/v1/contract_sessions?token=eq.' + encodeURIComponent(token) + '&select=id', { headers: authHeaders });
      const sessRows = await sessRes.json();
      if (sessRows.length) {
        const sessionId = sessRows[0].id;
        const subDel = await fetch(SUPABASE_URL + '/rest/v1/contract_submissions?session_id=eq.' + sessionId, { method: 'DELETE', headers: Object.assign({}, authHeaders, { Prefer: 'return=representation' }) });
        const subDelBody = await subDel.json().catch(function () { return []; });
        result.deletedSubmissions = subDelBody.length || 0;

        const sessDel = await fetch(SUPABASE_URL + '/rest/v1/contract_sessions?id=eq.' + sessionId, { method: 'DELETE', headers: Object.assign({}, authHeaders, { Prefer: 'return=representation' }) });
        const sessDelBody = await sessDel.json().catch(function () { return []; });
        result.deletedSessions = sessDelBody.length || 0;

        // ลบไฟล์ใน Storage ใต้ sessions/{token}/ ทั้งหมด (list แล้วลบทีละไฟล์)
        const listRes = await fetch(SUPABASE_URL + '/storage/v1/object/list/contract-files', {
          method: 'POST',
          headers: Object.assign({}, authHeaders, { 'Content-Type': 'application/json' }),
          body: JSON.stringify({ prefix: 'sessions/' + token + '/' }),
        });
        const listBody = await listRes.json().catch(function () { return []; });
        if (Array.isArray(listBody)) {
          for (const f of listBody) {
            const path = 'sessions/' + token + '/' + f.name;
            const delRes = await fetch(SUPABASE_URL + '/storage/v1/object/contract-files/' + path, { method: 'DELETE', headers: authHeaders });
            if (delRes.ok) result.deletedFiles.push(path);
          }
        }
      }
    }

    // ไฟล์ debug-test/url-check.png ที่ค้างจากการทดสอบ public-URL รอบก่อนหน้าในรอบนี้ด้วย
    const debugDel = await fetch(SUPABASE_URL + '/storage/v1/object/contract-files/debug-test/url-check.png', { method: 'DELETE', headers: authHeaders });
    if (debugDel.ok) result.deletedFiles.push('debug-test/url-check.png');

    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message, partial: result });
  }
};
