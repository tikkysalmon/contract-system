-- เพิ่ม 'cash' เป็นค่าที่ยอมรับได้ของ contract_sessions.plan_type (2026-09-30) — เดิม CHECK constraint จาก
-- supabase-setup.sql อนุญาตแค่ ('downpayment', 'installment') เท่านั้น ทำให้สร้างลิงก์ให้ลูกค้าประเภท
-- "ซื้อสด/ปิดยอด (ผ่อนครบรับของ)" ไม่ได้เลย (INSERT ชน CHECK constraint code 23514) — ตอนนี้ลูกค้ากลุ่มนี้
-- กรอกแค่ของแถม+ที่อยู่จัดส่ง ไม่ต้องทำสัญญา (ดู public/sign.js's isCashPlan()) ต้องอนุญาตให้สร้าง session ได้
-- รันใน Supabase SQL Editor ของโปรเจกต์ (ต่อจากไฟล์ supabase-*.sql เดิมทั้งหมด)

alter table contract_sessions drop constraint if exists contract_sessions_plan_type_check;
alter table contract_sessions add constraint contract_sessions_plan_type_check
  check (plan_type in ('downpayment', 'installment', 'cash'));
