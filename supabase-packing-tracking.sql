-- เก็บเลข tracking ที่นำเข้ากลับมาจากไฟล์ export ของ MyOrder (2026-09-07) — ผูกกับ so_number เดียวกับ
-- packing_records (ดู supabase-packing.sql) เพราะ tracking เกิดหลังแพ็ค/ส่งออกไปให้ MyOrder แล้วเสมอ
-- รันใน Supabase SQL Editor ของโปรเจกต์ (ต่อจากไฟล์ supabase-*.sql เดิมทั้งหมด รวม supabase-packing.sql)

alter table packing_records add column if not exists tracking_no text;
alter table packing_records add column if not exists courier text;
alter table packing_records add column if not exists tracking_imported_at timestamptz;
