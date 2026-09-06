-- รองรับปุ่ม "ยืนยัน" ของทีมเร่งรัดหนี้สิน (2026-09-06) — ตรวจสอบข้อมูลสัญญาที่ลูกค้าส่งกลับมาแล้วว่าถูกต้อง
-- ไม่ต้องแก้ไข (คนละ action กับ "เซ็นเอกสาร"/"ปฏิเสธ" ที่มีอยู่แล้ว) ใช้เป็นเงื่อนไข auto เปลี่ยนสถานะจาก
-- "รอตรวจสอบ" -> "สัญญาลูกค้าเรียบร้อย"
-- รันใน Supabase SQL Editor ของโปรเจกต์ (ต่อจากไฟล์ supabase-*.sql เดิมทั้งหมด)

alter table contract_submissions
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by text;
