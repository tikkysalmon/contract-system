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
  const token = await crmLogin();
  const name = 'อินยาศรี';
  const getCandidates = ['keyword', 'q', 'name', 'customer', 'customerFirstName', 'customerLastName', 'search', 'fullName', 'firstName'];
  const results = [];
  for (const param of getCandidates) {
    const path = '/crm/sale-order?' + param + '=' + encodeURIComponent(name);
    try {
      const r = await fetch(CRM_API_BASE + path, { headers: { Authorization: 'Bearer ' + token } });
      const data = await r.json().catch(function () { return null; });
      const orders = data && data.saleOrders;
      results.push({
        path: path,
        status: r.status,
        count: Array.isArray(orders) ? orders.length : null,
        firstId: Array.isArray(orders) && orders[0] ? orders[0].saleOrderId : null,
      });
    } catch (e) {
      results.push({ path: path, error: e.message });
    }
  }
  // ลอง POST body ด้วย เผื่อ filter ต้องส่งแบบนี้แทน query string
  for (const bodyKey of ['customerName', 'keyword', 'search']) {
    try {
      const r = await fetch(CRM_API_BASE + '/crm/sale-order', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ [bodyKey]: name }),
      });
      const text = await r.text();
      results.push({ path: 'POST /crm/sale-order {' + bodyKey + '}', status: r.status, bodySnippet: text.slice(0, 200) });
    } catch (e) {
      results.push({ path: 'POST /crm/sale-order {' + bodyKey + '}', error: e.message });
    }
  }
  res.status(200).json({ results: results });
};
