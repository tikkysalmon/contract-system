-- "ดีลเปลี่ยนสินค้า" (2026-09-24) — เคสสินค้าที่ลูกค้าทำสัญญาไว้แล้วแต่จัดซื้อหาซื้อไม่ได้อีก ต้องดีลเปลี่ยน
-- สินค้าให้ลูกค้า flow: จัดซื้อสร้างรายการนี้จากเมนู "สำหรับจัดซื้อ" (status='pending') -> โผล่เป็นคอลัมน์
-- "ดีลเปลี่ยนสินค้า" ในเมนู "สำหรับสต๊อค" ให้ทีมสต๊อคติดต่อลูกค้า -> สต๊อคกดปิดสถานะเป็น deal_success หรือ
-- cancelled_refund -> ถ้า deal_success ให้เมนู "ข้อมูลลูกค้าทำสัญญา" เห็นข้อมูลนี้เพื่อออกเอกสารแนบท้ายสัญญา
-- (ส่วนออกเอกสารจริงรอไฟล์ตัวอย่างเทมเพลตจาก user ก่อน ยังไม่ได้ทำในรอบนี้)
-- รันใน Supabase SQL Editor ของโปรเจกต์ (ต่อจากไฟล์ supabase-*.sql เดิมทั้งหมด)

create table if not exists product_deal_changes (
  id uuid primary key default gen_random_uuid(),
  so_number text not null,               -- เลขคำสั่งขายที่ต้องดีลเปลี่ยนสินค้า
  original_product text not null,
  original_color text,
  replacement_product text not null,     -- สินค้าทดแทนที่จัดซื้อเช็คราคา/สต๊อกมาแล้ว (กรอกเองหลังเช็คในระบบเทียบราคาแยก)
  note text,
  status text not null default 'pending' check (status in ('pending', 'deal_success', 'cancelled_refund')),
  created_by text,                       -- staff (จัดซื้อ) ที่สร้างรายการนี้
  created_at timestamptz not null default now(),
  resolved_by text,                      -- staff (สต๊อค) ที่กดปิดสถานะ
  resolved_at timestamptz
);

create index if not exists idx_product_deal_changes_so on product_deal_changes(so_number);
