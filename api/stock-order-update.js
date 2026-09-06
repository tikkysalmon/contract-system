// Vercel serverless function — อัปเดตเมทาดาต้าการเบิกของ SO หนึ่งใบ/หลายใบ (เมนู "สำหรับสต๊อค", 2026-09-06)
// action:
//   'setRound'   — { soNumbers: string[], round: string, staffName } กำหนดรอบการเบิก
//   'markPrinted'— { soNumbers: string[], staffName } บันทึกว่าพิมพ์ใบเบิกประจำวันแล้ว (เรียกหลังสร้าง PDF สำเร็จ)
//   'cancel'     — { soNumber: string, staffName, reason } ยกเลิกออเดอร์ในระบบนี้ (เฉพาะเคส CRM ยกเลิกเองไม่ได้)
//
// upsert ด้วย Prefer: resolution=merge-duplicates (so_number เป็น primary key) กันต้อง SELECT ก่อนว่ามีแถวหรือยัง
//
// ต้องรัน supabase-stock-orders.sql ก่อนใช้งาน
// ต้องตั้งค่าใน Vercel project settings: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function upsertMeta(authHeaders, rows) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/stock_order_meta?on_conflict=so_number', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, authHeaders),
    body: JSON.stringify(rows),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error('บันทึกไม่สำเร็จ (HTTP ' + r.status + '): ' + text.slice(0, 300));
  }
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
    if (!staffName) { res.status(400).json({ error: 'ไม่มี staffName' }); return; }
    const authHeaders = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY };

    if (action === 'setRound') {
      const soNumbers = Array.isArray(body.soNumbers) ? body.soNumbers : [];
      const round = String(body.round || '').trim();
      if (!soNumbers.length || !round) { res.status(400).json({ error: 'ข้อมูลไม่ครบ (soNumbers/round)' }); return; }
      await upsertMeta(authHeaders, soNumbers.map(function (so) {
        return { so_number: so, withdrawal_round: round, updated_at: new Date().toISOString() };
      }));
      res.status(200).json({ ok: true });
      return;
    }

    if (action === 'markPrinted') {
      const soNumbers = Array.isArray(body.soNumbers) ? body.soNumbers : [];
      if (!soNumbers.length) { res.status(400).json({ error: 'ไม่มี soNumbers' }); return; }
      await upsertMeta(authHeaders, soNumbers.map(function (so) {
        return { so_number: so, printed_at: new Date().toISOString(), printed_by: staffName, updated_at: new Date().toISOString() };
      }));
      res.status(200).json({ ok: true });
      return;
    }

    if (action === 'cancel') {
      const soNumber = String(body.soNumber || '').trim();
      const reason = String(body.reason || '').trim();
      if (!soNumber) { res.status(400).json({ error: 'ไม่มี soNumber' }); return; }
      await upsertMeta(authHeaders, [{
        so_number: soNumber, cancelled_at: new Date().toISOString(), cancelled_by: staffName,
        cancel_reason: reason || null, updated_at: new Date().toISOString(),
      }]);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(400).json({ error: 'ไม่รู้จัก action นี้' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
