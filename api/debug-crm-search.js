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
  const candidates = [
    '/crm/sale-order?customerName=' + encodeURIComponent('หทัยรัตน์'),
    '/crm/sale-order?customerName=' + encodeURIComponent('หทัยรัตน์  อินยาศรี'),
    '/crm/sale-order?customerName=' + encodeURIComponent('อินยาศรี'),
    '/crm/sale-order?customerName=' + encodeURIComponent('zzznonsensexyz'),
    '/crm/sale-order?customerName=',
  ];
  const results = [];
  for (const path of candidates) {
    try {
      const r = await fetch(CRM_API_BASE + path, { headers: { Authorization: 'Bearer ' + token } });
      const data = await r.json().catch(function () { return null; });
      const orders = data && data.saleOrders;
      results.push({
        path: path,
        status: r.status,
        count: Array.isArray(orders) ? orders.length : null,
        firstFew: Array.isArray(orders) ? orders.slice(0, 3).map(function (o) {
          return o.saleOrderId + ' | ' + o.customerFirstName + o.customerLastName;
        }) : data,
        pagination: data && data.pagination,
      });
    } catch (e) {
      results.push({ path: path, error: e.message });
    }
  }
  res.status(200).json({ results: results });
};
