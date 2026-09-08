-- แคชรายการคำสั่งขายจาก CRM ทั้งหมด (89,031 รายการ ณ 2026-09-07 — ดึงสดทุกครั้งไม่ได้เพราะ CRM ไม่รองรับ
-- filter ฝั่ง server เลย ต้องดึงทั้งหมดมาก่อนเสมอ ใช้เวลา ~40 วิ เกินเวลาที่ Vercel อนุญาตต่อ 1 request มาก)
-- sync จากพีซี user เอง (scripts/sync-odoo-stock.js) พร้อมกับสต๊อก Odoo ทุก 15 นาที เว็บอ่านตารางนี้แล้วกรอง
-- ด้วยวันที่/สถานะที่พนักงานเลือกแทนการยิง CRM สดทุกครั้ง — ไม่เก็บ productName ในนี้ (ต้องดึงเพิ่มทีละ SO
-- เฉพาะรายการที่ผ่านตัวกรองแล้วเท่านั้น เพราะดึง productName ครบทั้ง 89,031 รายการทุก 15 นาทีจะยิง CRM
-- หลายหมื่นครั้งต่อรอบ ไม่สมเหตุสมผล)
create table if not exists crm_orders_cache (
  sale_order_id text primary key,
  status text,
  installment_type text,
  order_date timestamptz,
  crm_updated_at timestamptz,
  customer_first_name text,
  customer_last_name text,
  synced_at timestamptz not null default now()
);

create index if not exists crm_orders_cache_order_date_idx on crm_orders_cache (order_date);
create index if not exists crm_orders_cache_status_idx on crm_orders_cache (status);
