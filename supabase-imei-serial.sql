-- รองรับข้อมูลที่ทีมแพ็คกิ้งจะลงภายหลัง (2026-09-06) — เลข IMEI/Serial Number ของเครื่องที่จัดส่งจริง
-- ใช้เป็นเงื่อนไข auto "สถานะการทำสัญญา = สัญญาเสร็จสมบูรณ์" (ต้องมีครบทั้ง IMEI/Serial + ลายเซ็นพนักงาน)
-- เมนู "สำหรับแพ็คกิ้ง" ที่จะกรอกข้อมูลนี้จริงยังไม่ได้สร้าง (รอสเปกเพิ่มเติมจาก user) — คอลัมน์นี้เตรียมไว้ก่อน
-- ให้ตรรกะสถานะอ้างอิงได้ ไม่บล็อกงานส่วนอื่น
-- รันใน Supabase SQL Editor ของโปรเจกต์ (ต่อจาก supabase-setup.sql และไฟล์ supabase-*.sql เดิมทั้งหมด)

alter table contract_submissions
  add column if not exists imei text,
  add column if not exists serial_number text;
