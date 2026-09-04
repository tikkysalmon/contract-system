// ไฟล์ทดสอบชั่วคราว (2026-09-04) — ยืนยัน endpoint ค้นหาลูกค้าด้วยชื่อจริงที่เจอจาก Network tab ของ user:
// GET /crm/customer?page=1&pageSize=10&mode=quick&searchBy=name&searchValue=<ชื่อ>
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
  const name = String((req.query && req.query.name) || 'อินยาศรี');
  const token = await crmLogin();
  const path = '/crm/customer?page=1&pageSize=10&mode=quick&searchBy=name&searchValue=' + encodeURIComponent(name);
  const r = await fetch(CRM_API_BASE + path, { headers: { Authorization: 'Bearer ' + token } });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) { /* ignore */ }
  res.status(200).json({ requestedPath: path, status: r.status, raw: data || text });
};
