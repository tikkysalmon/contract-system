// ข้อมูลจำลองแทนการเรียก GET /api/session/{token} จริง (ยังไม่มี backend/CRM จริงในรอบนี้)
// เมื่อมี api/session.js ใช้งานได้แล้ว ให้แทนที่การอ่านตัวแปรนี้ด้วย fetch จริงใน sign.js
// รูปแบบข้อมูลอิงจากตัวอย่างจริงที่ยืนยันกับ user แล้ว (SO-2026053100203, 2026-09-03):
// สินค้า iPad Gen 11 ราคา 36,790, ยอดวางดาวน์จริง 1,990 (จ่ายก่อนอนุมัติเครดิต), ผ่อนไปแล้ว 3 งวด (8,700),
// คงเหลือ 26,100, เหลือผ่อนอีก 9 งวด งวดละ 2,900 — ตัวเลขชุดนี้ตรวจสอบกับข้อมูลจริงจาก CRM แล้วทุกจุด
// (ยอดวางดาวน์ต้องแยกจากยอดที่ผ่อนไปแล้วหลังอนุมัติเครดิต ไม่ใช่ยอดสะสมรวมทั้งหมด — แก้ไข 2026-09-03)
window.MOCK_SESSION = {
  token: 'demo',
  soNumber: 'SO-2026053100203',
  contractDate: new Date().toISOString().slice(0, 10),
  // SALMONyyyymmdd-xxxxx (2026-09-03 user ขอ) — xxxxx คือ 5 หลักท้ายของเลข SO ด้านบน
  contractNo: buildContractNo(new Date().toISOString().slice(0, 10), 'SO-2026053100203'),
  product: 'Apple iPad Gen 11 (2025) A16 11 inch Wi-Fi 128GB',
  color: 'Silver',
  // ราคา/แผนผ่อนที่ CS ดึงจาก CRM มาเติมไว้ล่วงหน้า (ลูกค้าแก้ไม่ได้ แก้ได้แค่ข้อมูลส่วนตัว)
  planType: 'downpayment', // 'downpayment' | 'installment'
  productPrice: 36790,
  totalDiscount: 0,
  netPrice: 36790,
  downPayment: 1990, // ยอดวางดาวน์ที่แท้จริง (จ่ายก่อนอนุมัติเครดิต) — ไม่ใช่ยอดสะสมทั้งหมด
  installmentsPaidSoFar: 8700, // งวดที่ผ่อนไปแล้วหลังอนุมัติเครดิต (3 งวด x 2,900)
  installmentsPaidCount: 3,
  remainingBalance: 26100,
  installmentCount: 9, // ยืนยัน/แก้ไขโดย CS ก่อนสร้างลิงก์เสมอ ไม่ใช้ค่าจาก CRM ตรงๆ
  firstDueDate: '2026-10-05',
  // ค่าที่ CRM ส่งมาให้ลูกค้ายืนยัน/แก้ (พรีฟิล)
  customer: {
    title: '', firstLastName: '', dob: '', citizenId: '', phone: '', nationality: 'ไทย',
  },
};
