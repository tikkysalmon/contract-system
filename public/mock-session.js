// ข้อมูลจำลองแทนการเรียก GET /api/session/{token} จริง (ยังไม่มี backend/CRM จริงในรอบนี้)
// เมื่อมี api/session.js ใช้งานได้แล้ว ให้แทนที่การอ่านตัวแปรนี้ด้วย fetch จริงใน sign.js
// รูปแบบข้อมูลอิงจากตัวอย่างจริงที่ยืนยันกับ user แล้ว (SO-2026053100203, 2026-09-03):
// สินค้า iPad Gen 11 ราคา 36,790, ยอดวางดาวน์จริง 1,990 (จ่ายก่อนอนุมัติเครดิต), ผ่อนไปแล้ว 3 งวด (8,700),
// คงเหลือ 26,100, เหลือผ่อนอีก 9 งวด งวดละ 2,900 — ตัวเลขชุดนี้ตรวจสอบกับข้อมูลจริงจาก CRM แล้วทุกจุด
// (ยอดวางดาวน์ต้องแยกจากยอดที่ผ่อนไปแล้วหลังอนุมัติเครดิต ไม่ใช่ยอดสะสมรวมทั้งหมด — แก้ไข 2026-09-03)
//
// รูปแบบ items[] (2026-09-04) — session รองรับหลาย SO รวมกันในลิงก์เดียว (เช่น วางดาวน์เครื่อง + อุปกรณ์เสริม
// ที่ CRM บังคับแยก SO) ตัวอย่างนี้ใส่ไว้แค่ 1 รายการ ให้ทดสอบ UI ปกติได้เหมือนเดิม — ถ้าจะทดสอบเคสหลายรายการ
// เพิ่ม object ที่สองใน items array (ดูตัวอย่างจริงที่ contracts-tab.js ทดสอบผ่านแล้ว: SO-2026090200106 +
// SO-2026090200108)
var CONTRACT_DATE = new Date().toISOString().slice(0, 10);
window.MOCK_SESSION = {
  contractDate: CONTRACT_DATE,
  letterheadDataUrl: null,
  // ค่าที่ CRM ส่งมาให้ลูกค้ายืนยัน/แก้ (พรีฟิล) — ใช้ร่วมกันทุก item ในลิงก์เดียว (สมมติลูกค้าคนเดียวกัน)
  customer: {
    title: '', firstLastName: '', dob: '', citizenId: '', phone: '', nationality: 'ไทย',
  },
  items: [
    {
      soNumber: 'SO-2026053100203',
      // SALMONyyyymmdd-xxxxx (2026-09-03 user ขอ) — xxxxx คือ 5 หลักท้ายของเลข SO ด้านบน
      contractNo: buildContractNo(CONTRACT_DATE, 'SO-2026053100203'),
      product: 'Apple iPad Gen 11 (2025) A16 11 inch Wi-Fi 128GB',
      color: 'Silver',
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
    },
  ],
};
