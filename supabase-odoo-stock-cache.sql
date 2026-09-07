-- แคชยอดสต๊อกคงเหลือจาก Odoo (2026-09-07) — เว็บ (Vercel) เข้าถึงเซิร์ฟเวอร์ Odoo ตรงไม่ได้ (ติด firewall,
-- ยืนยันแล้วว่ายิงจาก Vercel ค้าง 90 วิไม่ตอบเลย แต่จาก IP อื่นที่เข้าถึงได้อยู่แล้วเชื่อมสำเร็จปกติ) แก้โดยให้
-- สคริปต์ที่รันจากพีซี user เอง (scripts/sync-odoo-stock.js ผ่าน Windows Task Scheduler ทุก 15 นาที) ดึงจาก
-- Odoo มา "เขียนทับ" ตารางนี้แทน แล้วเว็บอ่านจากตารางนี้ (Supabase) แทนการยิง Odoo ตรง — ไม่มี relation กับ
-- ตารางอื่นในระบบ ลบทิ้ง/สร้างใหม่ได้อิสระ

create table if not exists odoo_stock_cache (
  product_name text primary key,   -- ชื่อสินค้าจาก Odoo ตรงๆ (product_id[1]) ไม่ normalize ที่นี่ — ฝั่งอ่าน
                                    -- (_lib/stock-reservation.js) normalize เองตอนเทียบกับชื่อสินค้าจาก CRM
  quantity numeric not null default 0,
  updated_at timestamptz not null default now()
);
