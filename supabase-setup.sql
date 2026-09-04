-- ระบบทำสัญญาออนไลน์ — Supabase schema เริ่มต้น
-- รันใน Supabase SQL Editor ของโปรเจกต์ใหม่ (ยังไม่ได้สร้างโปรเจกต์จริง ณ ตอนที่เขียนไฟล์นี้)

create table if not exists staff_users (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  password_hash text not null,
  display_name text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists contract_sessions (
  id uuid primary key default gen_random_uuid(),
  token text unique not null,               -- ใช้ในลิงก์ /sign/{token} ที่ส่งให้ลูกค้า ไม่ต้องล็อกอิน
  so_number text not null,                  -- เลขคำสั่งขายจาก CRM
  crm_snapshot jsonb,                       -- ข้อมูลดิบที่ดึงมาจาก CRM ตอน CS สร้างลิงก์ (เก็บไว้ตรวจสอบย้อนหลัง)
  plan_type text not null check (plan_type in ('downpayment', 'installment')),
  total_price numeric not null,
  down_payment numeric not null default 0,
  installment_count int not null,
  first_due_date date not null,
  product text not null,
  color text,
  status text not null default 'draft' check (status in ('draft', 'sent', 'submitted', 'generated', 'cancelled')),
  created_by uuid references staff_users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);

create table if not exists contract_submissions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references contract_sessions(id),
  customer_data jsonb not null,             -- ข้อมูลส่วนตัว/ผู้ปกครอง/ผู้ค้ำที่ลูกค้ากรอก
  file_paths jsonb not null default '{}'::jsonb, -- path ใน Supabase Storage ของรูปบัตร/เซลฟี่/ลายเซ็น
  contract_pdf_path text,                   -- path ของ PDF สัญญาที่สร้างเสร็จแล้ว
  submitted_at timestamptz not null default now()
);

create index if not exists idx_contract_sessions_token on contract_sessions(token);
create index if not exists idx_contract_sessions_so on contract_sessions(so_number);

-- Storage bucket สำหรับรูปบัตร/เซลฟี่/ลายเซ็น/PDF สัญญา (private, เข้าถึงผ่าน signed URL เท่านั้น
-- ตามแพทเทิร์นเดียวกับ debt-tracker's app-data bucket และ esign-module's esign-originals bucket)
insert into storage.buckets (id, name, public)
values ('contract-files', 'contract-files', false)
on conflict (id) do nothing;
