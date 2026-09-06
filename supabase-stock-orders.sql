-- เมนู "สำหรับสต๊อค" (2026-09-06) — ระบบใหม่แทนที่ Lark Base เดิม ไม่เก็บสำเนาข้อมูลลูกค้า/สินค้าซ้ำ (ดึงสดจาก
-- contract_submissions ฝั่งเครดิตผ่าน/วางดาวน์ + จาก CRM ตรงๆ ฝั่งซื้อสด/ปิดยอด) เก็บแค่ "เมทาดาต้าการเบิก"
-- ที่ระบบเราเป็นเจ้าของเองต่อ SO เท่านั้น — รอบการเบิก/สถานะพิมพ์ใบเบิก/สถานะยกเลิก (ยกเลิกในระบบนี้เท่านั้น
-- ไม่แตะ CRM จริง เพราะ CRM เองยกเลิกออเดอร์ซื้อสดที่สถานะ "สำเร็จ" ไม่ได้ — ข้อจำกัดที่ user แจ้ง)
-- รันใน Supabase SQL Editor ของโปรเจกต์ (ต่อจากไฟล์ supabase-*.sql เดิมทั้งหมด)

create table if not exists stock_order_meta (
  so_number text primary key,
  withdrawal_round text,              -- เช้ารอบ1 / เช้ารอบ2 / เช้ารอบ3 / บ่ายรอบ1 / บ่ายรอบ2 / บ่ายรอบ3
  printed_at timestamptz,             -- พิมพ์ใบเบิกประจำวันแล้ว (auto สถานะ "พิมพ์ใบเบิกประจำวันแล้ว")
  printed_by text,
  cancelled_at timestamptz,           -- ยกเลิกออเดอร์ในระบบนี้ (เฉพาะเคสซื้อสด/ปิดยอดที่ CRM ยกเลิกเองไม่ได้)
  cancelled_by text,
  cancel_reason text,
  updated_at timestamptz not null default now()
);
