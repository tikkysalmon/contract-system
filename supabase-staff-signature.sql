-- เพิ่มคอลัมน์รองรับ "พนักงานเซ็นเอกสาร" (2026-09-04) — เซ็นทีหลังจากลูกค้าเซ็น/ส่งฟอร์มแล้ว
-- รันใน Supabase SQL Editor ของโปรเจกต์ (ต่อจาก supabase-setup.sql เดิม)

alter table contract_submissions
  add column if not exists staff_signature_path text,
  add column if not exists staff_signed_by text,
  add column if not exists staff_signed_at timestamptz;

create index if not exists idx_contract_submissions_pending_staff_sign
  on contract_submissions(staff_signed_at)
  where staff_signed_at is null;
