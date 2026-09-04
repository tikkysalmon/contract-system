-- เก็บลายเซ็นที่พนักงานเคยวาดไว้ ให้ใช้ซ้ำครั้งถัดไปได้โดยไม่ต้องวาดใหม่ (2026-09-04)
-- คนละตารางกับ contract_submissions.staff_signature_path (นั่นคือลายเซ็นที่เซ็นจริงต่อสัญญาแต่ละฉบับ
-- ส่วนตารางนี้คือ "ลายเซ็นล่าสุดที่บันทึกไว้ใช้ซ้ำ" ของพนักงานแต่ละคน — username เป็น primary key จึงมีได้
-- แค่ 1 แถวต่อคน (บันทึกทับของเดิมทุกครั้งที่เซ็นใหม่)
-- รันใน Supabase SQL Editor ของโปรเจกต์ (ต่อจาก supabase-setup.sql และ supabase-staff-signature.sql เดิม)

create table if not exists staff_signatures (
  username text primary key,
  signature_path text not null,
  updated_at timestamptz not null default now()
);
