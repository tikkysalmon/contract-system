// คำนวณ "สถานะการทำสัญญา" ตามสเปกที่ user ให้มา (2026-09-06) — ใช้ร่วมกันทั้ง cs-session-list.js (CS เห็น
// แค่สถานะ อ่านอย่างเดียว) และ staff-sign-queue.js (ทีมเร่งรัดหนี้สิน/บัญชี เห็นเต็ม แก้ไขได้) กันเขียนตรรกะ
// ซ้ำ 2 ที่แล้วหลุดไม่ตรงกัน
//
// 1.1 รอลูกค้ากรอกข้อมูลสัญญา — ยังไม่มีใครส่งฟอร์มกลับมา (อยู่ระหว่าง CS ส่งลิงก์รอลูกค้ากรอก)
// 1.3 สัญญาไม่เรียบร้อย — auto เมื่อทีมเร่งรัดหนี้สินปฏิเสธ/ขอแก้ไขข้อมูล (rejected_at ไม่ null)
// 1.4 สัญญาลูกค้าเรียบร้อย — auto ทันทีที่ลูกค้าส่งฟอร์มกลับมาและไม่ถูกปฏิเสธ (2026-09-06 user แก้ไข: ไม่ต้อง
//     รอพนักงานเซ็นก่อนแล้ว — พนักงานเซ็น "เซ็นเอกสาร" เมื่อไหร่ก็ได้ทีหลัง ไม่ใช่เงื่อนไขของสถานะนี้อีกต่อไป)
// 1.5 สัญญาเสร็จสมบูรณ์ — auto เมื่อมี IMEI + Serial Number ครบ (ทีมแพ็คกิ้งกรอก — ยังไม่มีเมนูนี้จริง) และ
//     ลายเซ็นพนักงานครบถ้วน (ตรวจลายเซ็นพนักงานอีกครั้งตรงนี้แทน)
function computeContractStatus(input) {
  input = input || {};
  if (!input.submitted) return { key: 'awaiting_customer', label: 'รอลูกค้ากรอกข้อมูลสัญญา' };
  if (input.rejectedAt) return { key: 'needs_correction', label: 'สัญญาไม่เรียบร้อย' };
  if (input.staffSignedAt && input.imei && input.serialNumber) return { key: 'complete', label: 'สัญญาเสร็จสมบูรณ์' };
  return { key: 'customer_ok', label: 'สัญญาลูกค้าเรียบร้อย' };
}

// สถานะการจัดส่งสินค้า — สเปกที่ได้รับมามีแค่ข้อ 2.1 (2026-09-06 user บอกจะเพิ่มข้อมูลระบบจัดการออเดอร์ของ
// ทีมสต๊อคให้อีกครั้ง) ยังไม่มีเมนู/ข้อมูลใบเบิกสินค้าจริงให้ตรวจ จึงคืนค่า "-" (ยังไม่ถึงขั้นตอนนี้) ไปก่อนเสมอ
// รอสเปกที่เหลือค่อยเติม logic จริง
function computeShippingStatus() {
  return { key: 'none', label: '-' };
}

module.exports = { computeContractStatus: computeContractStatus, computeShippingStatus: computeShippingStatus };
