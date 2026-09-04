// TEMPORARY — ใช้ครั้งเดียวเพื่อลบข้อมูลทดสอบ (testuser1/testuser2) ออกจาก staff_signatures
// + ไฟล์ใน Storage หลังทดสอบฟีเจอร์ "บันทึกลายเซ็นไว้ใช้ซ้ำ" (2026-09-04) — ลบไฟล์นี้ทิ้งหลังใช้งานเสร็จ

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({ error: 'ยังไม่ได้ตั้งค่า SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY บน server' });
    return;
  }
  const authHeaders = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY };
  const usernames = ['testuser1', 'testuser2'];
  const result = { deletedRows: [], deletedFiles: [], errors: [] };
  try {
    for (const u of usernames) {
      const r = await fetch(
        SUPABASE_URL + '/rest/v1/staff_signatures?username=eq.' + encodeURIComponent(u),
        { method: 'DELETE', headers: Object.assign({}, authHeaders, { Prefer: 'return=representation' }) }
      );
      const body = await r.json().catch(function () { return null; });
      if (r.ok && body && body.length) result.deletedRows.push(u);
    }
    for (const ext of ['png', 'jpg', 'jpeg']) {
      for (const u of usernames) {
        const path = 'staff-saved-signatures/' + u + '.' + ext;
        const r = await fetch(SUPABASE_URL + '/storage/v1/object/contract-files/' + path, {
          method: 'DELETE',
          headers: authHeaders,
        });
        if (r.ok) result.deletedFiles.push(path);
      }
    }
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message, partial: result });
  }
};
