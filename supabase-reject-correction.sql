-- รองรับ "พนักงานตรวจสัญญาแล้วปฏิเสธ ส่งลิงก์เดิมกลับให้ลูกค้าแก้ไขเฉพาะข้อมูลที่ผิด" (2026-09-06)
-- รันใน Supabase SQL Editor ของโปรเจกต์ (ต่อจาก supabase-setup.sql, supabase-staff-signature.sql,
-- supabase-staff-signature-2.sql เดิม)

alter table contract_submissions
  add column if not exists rejected_at timestamptz,
  add column if not exists rejected_by text,
  add column if not exists rejected_fields jsonb, -- array ของ step key ที่พนักงานระบุว่าผิด เช่น ["personal","uploads"]
  add column if not exists rejected_note text;

-- เพิ่มสถานะ 'needs_correction' ให้ contract_sessions.status (เดิมมีแค่ draft/sent/submitted/generated/cancelled)
alter table contract_sessions drop constraint if exists contract_sessions_status_check;
alter table contract_sessions add constraint contract_sessions_status_check
  check (status in ('draft', 'sent', 'submitted', 'needs_correction', 'generated', 'cancelled'));
