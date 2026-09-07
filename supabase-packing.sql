-- เก็บ IMEI/Serial Number ที่ทีมแพ็คกิ้งกรอกหลังแพ็คสินค้าเสร็จ ผูกกับ so_number (2026-09-06)
-- รันใน Supabase SQL Editor ของโปรเจกต์ (ต่อจาก supabase-setup.sql, supabase-staff-signature.sql,
-- supabase-staff-signature-2.sql, supabase-reject-correction.sql เดิม)
--
-- 1 SO ต่อ 1 เครื่อง (1 IMEI + 1 Serial) ตามที่ user ยืนยัน 2026-09-06 — so_number เป็น primary key เอง
-- (upsert ทับได้ ไม่เก็บ log ประวัติการแก้ไข ตามที่ user ยืนยันว่าไม่ต้องกันคนแก้ผิด)
-- วิธีที่ทีมแพ็คกิ้งจะ "ค้นหาออเดอร์ที่จะลง" ยังไม่กำหนด (user บอกจะอยู่ใน process ต่อไป) — ตารางนี้ผูกกับ
-- so_number เฉยๆ ไม่ขึ้นกับวิธีค้นหา เปลี่ยนหน้า UI ทีหลังได้โดยไม่กระทบ schema/API นี้

create table if not exists packing_records (
  so_number text primary key,
  imei text,
  serial_number text,
  packed_by text,             -- username พนักงานแพ็คกิ้งที่กรอก (จาก mock login ใน app.js ไปก่อน)
  packed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
