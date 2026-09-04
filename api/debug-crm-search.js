// ไฟล์ทดสอบชั่วคราว (2026-09-04) — หา endpoint ค้นหาลูกค้าด้วยชื่อของ CRM จริง โดยลองยิงหลาย path ที่เป็นไปได้
// แล้วดูว่าตัวไหนตอบกลับมีข้อมูลจริง (ไม่ใช่ 404/error) — ลบไฟล์นี้ทิ้งหลังหา endpoint เจอแล้ว ไม่ใช่ของถาวร
const CRM_API_BASE = 'https://api.salmonphone.com';

async function crmLogin() {
  const res = await fetch(CRM_API_BASE + '/crm/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.CRM_USERNAME, password: process.env.CRM_PASSWORD }),
  });
  const data = await res.json();
  return data.token;
}

module.exports = async function handler(req, res) {
  const q = String((req.query && req.query.q) || 'หทัยรัตน์');
  const token = await crmLogin();
  const candidates = [
    '/crm/customer?name=' + encodeURIComponent(q),
    '/crm/customer?search=' + encodeURIComponent(q),
    '/crm/customer/search?q=' + encodeURIComponent(q),
    '/crm/customer/search?name=' + encodeURIComponent(q),
    '/crm/customers?name=' + encodeURIComponent(q),
    '/crm/customers?search=' + encodeURIComponent(q),
    '/crm/sale-order?customerName=' + encodeURIComponent(q),
    '/crm/sale-order?search=' + encodeURIComponent(q),
    '/crm/sale-order/search?customerName=' + encodeURIComponent(q),
    '/crm/sale-order/search?q=' + encodeURIComponent(q),
  ];
  const results = [];
  for (const path of candidates) {
    try {
      const r = await fetch(CRM_API_BASE + path, { headers: { Authorization: 'Bearer ' + token } });
      const text = await r.text();
      results.push({ path: path, status: r.status, bodySnippet: text.slice(0, 400) });
    } catch (e) {
      results.push({ path: path, error: e.message });
    }
  }
  res.status(200).json({ results: results });
};
