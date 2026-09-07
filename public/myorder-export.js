// Export รายการออเดอร์เป็นไฟล์ Excel ตามเทมเพลตนำเข้าของ MyOrder.ai (2026-09-07) — MyOrder ไม่มี API ให้เชื่อม
// ตรง (ยืนยันจาก user แล้ว) รองรับแค่นำเข้าไฟล์ Excel ตามเทมเพลตของเขาเท่านั้น (ดู
// 15_ระบบทำสัญญา\MyOrder_Default_Template.xlsx — แกะโครงสร้างคอลัมน์/dropdown/comment มาตรงนี้)
// ใช้ SheetJS (โหลดผ่าน CDN ใน app.html) เขียนไฟล์ .xlsx ฝั่ง browser เอง ตามแพทเทิร์นเดียวกับที่ระบบนี้ใช้
// html2canvas+jsPDF สร้าง PDF ฝั่ง browser อยู่แล้ว (ดู contract-html-renderer.js/stock-tab.js's printRequisition)
//
// คอลัมน์ที่ระบบนี้ไม่มีข้อมูลจริง (สีสินค้าอาจเป็นอังกฤษ, ขนาด/น้ำหนักสินค้า, ประเภทการชำระ, จำนวนเงิน,
// วันที่/เวลาโอน, ผู้รับเงิน, ช่องทางการจำหน่าย) ใส่ค่าเริ่มต้น/เว้นว่างไว้ก่อนตามที่ user ขอ "ใส่ข้อมูลพื้นฐาน
// ไว้เลย เดี๋ยวจะส่งข้อมูลเพิ่มเติมให้ทีหลัง" (2026-09-07) — ดู MYORDER_DEFAULTS ด้านล่าง ปรับได้จุดเดียว
//
// ⚠️ "ชื่อสินค้า (สำหรับขนส่ง)" และ "สีสินค้า" เทมเพลตกำหนดว่า **ต้องเป็นภาษาไทย ห้ามอังกฤษล้วน (ตามสคบ.)**
// แต่ชื่อสินค้า/สีในระบบนี้มาจาก CRM เป็นภาษาอังกฤษเป็นส่วนใหญ่ (เช่น "iPhone 17", "Silver") — ยังไม่ได้แปลง
// เป็นไทยให้อัตโนมัติ (รอ user ยืนยันวิธีแปล/ยืนยันว่ายอมรับได้แค่ไหน) สต๊อคต้องตรวจ/แก้ 2 คอลัมน์นี้เองก่อน
// อัปโหลดเข้า MyOrder จริงเสมอ

var MYORDER_TEMPLATE_HEADERS = [
  'ชื่อผู้รับ', 'เบอร์โทร', 'ที่อยู่', 'ตำบล', 'อำเภอ', 'จังหวัด', 'รหัสไปรษณีย์', 'อีเมล', 'หมายเหตุ',
  'ชื่อสินค้า', 'ชื่อสินค้า (สำหรับขนส่ง)', 'สีสินค้า', 'ความกว้างของสินค้า', 'ความยาวของสินค้า',
  'ความสูงของสินค้า', 'น้ำหนัก(กก.)', 'ประเภทการชำระ', 'จำนวนเงิน', 'วันที่โอนเงิน', 'เวลาที่โอน',
  'ผู้รับเงิน', 'ช่องทางการจำหน่าย',
];
var MYORDER_SHEET_NAME = 'Template ใหม่_New102024'; // ชื่อชีตเดิมในเทมเพลต MyOrder ให้ตรงกันเป๊ะ

// ค่าเริ่มต้นสำหรับคอลัมน์ที่ระบบนี้ไม่มีข้อมูลจริง — แก้ตรงนี้จุดเดียวเมื่อ user ส่งข้อมูลที่แน่นอนมาให้ทีหลัง
var MYORDER_DEFAULTS = {
  paymentType: 'BANK', // dropdown เทมเพลตมีแค่ BANK/COD — ตั้งเป็น BANK (ไม่ใช่ COD) กันคนขับรถส่งของเข้าใจผิด
  // ไปเก็บเงินปลายทางจากลูกค้าที่จริงๆ ผ่อนชำระกับบริษัทอยู่แล้ว (ตั้ง COD ผิดจะกระทบเงินจริง)
  salesChannel: 'Other', // dropdown มี Line/IG/Twitter/Facebook/Website/Tiktok/Lazada/Shopee/Other — ไม่มีอันไหน
  // ตรงกับการขายผ่อน/วางดาวน์ของระบบนี้ ใช้ Other ไปก่อน
};

// จับคู่ SO/เลขที่สัญญากับผลลัพธ์นำเข้าจริงยาก เพราะเทมเพลต MyOrder ไม่มีคอลัมน์อ้างอิงกลับมาที่ระบบเราเลย —
// ฝังเลขที่ SO/เลขที่สัญญาไว้ในคอลัมน์ "หมายเหตุ" แทน เผื่อใช้จับคู่ตอนนำเข้าเลข tracking กลับมา (ยังไม่ได้ทำ
// ส่วนนำเข้ากลับ รอไฟล์ตัวอย่างที่ MyOrder ส่งออกมาจาก user ก่อน — ดูสนทนา 2026-09-07)
function buildMyOrderNote(order) {
  var parts = ['SO: ' + order.soNumber];
  if (order.contractNo) parts.push('เลขที่สัญญา: ' + order.contractNo);
  return parts.join(' / ');
}

function orderToMyOrderRow(order) {
  var addr = order.shippingAddress || {};
  return [
    order.customerName || '',
    order.recipientPhone || '',
    addr.detail || '',
    addr.subdistrictName || '',
    addr.districtName || '',
    addr.provinceName || '',
    addr.zip || '',
    '', // อีเมล — ไม่มีข้อมูลในระบบนี้
    buildMyOrderNote(order),
    order.product || '',
    order.product || '', // ชื่อสินค้า (สำหรับขนส่ง) — ดูคำเตือนเรื่องภาษาไทยด้านบนไฟล์
    order.color || '',
    '', '', '', // กว้าง/ยาว/สูง — ไม่มีข้อมูล
    '', // น้ำหนัก — ไม่มีข้อมูล
    MYORDER_DEFAULTS.paymentType,
    '', // จำนวนเงิน — ไม่มีความหมายชัดเจนสำหรับการขายผ่อน (ไม่ใช่ COD) ปล่อยว่าง
    '', '', // วันที่/เวลาโอน — ไม่มีข้อมูล
    '', // ผู้รับเงิน — ไม่มีข้อมูล
    MYORDER_DEFAULTS.salesChannel,
  ];
}

// เรียกจากปุ่มใน stock-tab.js — orders คือ array ของ order object จาก /api/stock-orders (ต้องมี shippingAddress
// แล้ว — เพิ่มใน api/stock-orders.js เมื่อ 2026-09-07 พร้อมกัน)
function exportMyOrderExcel(orders) {
  var rows = [MYORDER_TEMPLATE_HEADERS].concat(orders.map(orderToMyOrderRow));
  var ws = XLSX.utils.aoa_to_sheet(rows);
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, MYORDER_SHEET_NAME);
  var filename = 'MyOrder_นำเข้า_' + new Date().toISOString().slice(0, 10) + '.xlsx';
  XLSX.writeFile(wb, filename);
}
