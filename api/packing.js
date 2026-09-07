// Vercel serverless function — เมนู "สำหรับแพ็คกิ้ง" (packing-tab.js) ทั้งหมด รวม packing-lookup.js +
// packing-submit.js เดิมไว้ในไฟล์เดียว (2026-09-07 — โปรเจกต์นี้ชนโควต้า 12 ฟังก์ชัน/deployment ของ Vercel
// Hobby plan มาแล้วครั้งหนึ่ง ดู git log "ลดจำนวน serverless function ให้ไม่เกินโควต้า" — เพิ่มไฟล์ api/*.js
// ใหม่แยกๆ อีกจะเกินโควต้าอีกรอบ)
//
// GET ?so=xxx    — ค้นหาเดี่ยว: เคยมีคนลง IMEI/Serial ของ SO นี้ไว้หรือยัง (เดิม packing-lookup.js)
// GET (ไม่มี so) — LIST รายการที่แพ็คเสร็จแล้วทั้งหมด (มี imei+serial ครบใน contract_submissions) พร้อมข้อมูล
//   ลูกค้า/ที่อยู่จัดส่ง/สินค้า/เลข tracking สำหรับตาราง "รายการที่แพ็คแล้ว" — ใช้เป็น input ให้ปุ่ม "Export
//   ไฟล์นำเข้า MyOrder" (ดู public/myorder-export.js, public/packing-tab.js)
// POST { action: 'submit', soNumber, imei, serialNumber, packedBy }
//   — บันทึก IMEI/Serial ของ SO นี้ (upsert ด้วย so_number, เดิม packing-submit.js) sync เข้า
//   contract_submissions.imei/serial_number ด้วยเสมอ (ดูหมายเหตุ handleSubmit ด้านล่าง — บั๊กจริงที่เจอ
//   2026-09-07: เดิมเขียนแค่ packing_records ตัวเดียว ทำให้สถานะสัญญา/ตัวกรองที่อื่นในระบบไม่เห็นผลเลย)
// POST { action: 'importTracking', rows: [{ soNumber, trackingNo, courier }] }
//   — บันทึกเลข tracking ที่ parse ได้จากไฟล์ export ของ MyOrder ฝั่ง browser (SheetJS) กลับเข้า packing_records
//
// ต้องรัน supabase-packing.sql ก่อน (สร้างตาราง packing_records — ยังไม่เคยรันในระบบจริง ณ 2026-09-07)
// ต้องรัน supabase-packing-tracking.sql ก่อน (เพิ่มคอลัมน์ tracking_no/courier/tracking_imported_at)
// ต้องตั้งค่าใน Vercel project settings: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function handleSingleLookup(req, res, authHeaders, soNumber) {
  const r = await fetch(
    SUPABASE_URL + '/rest/v1/packing_records?so_number=eq.' + encodeURIComponent(soNumber) +
      '&select=imei,serial_number,packed_by,updated_at',
    { headers: authHeaders }
  );
  if (!r.ok) throw new Error('เรียก Supabase ไม่สำเร็จ (HTTP ' + r.status + ')');
  const rows = await r.json();
  res.status(200).json({ record: rows[0] || null });
}

// รายการที่แพ็คเสร็จแล้วทั้งหมด (มี imei+serial ครบใน contract_submissions — ตรงเงื่อนไขเดียวกับที่
// api/stock-orders.js ใช้ "กรองออก" จากรายการที่ยังไม่แพ็ค) join กับ packing_records เอาแค่ tracking info
async function handleList(req, res, authHeaders) {
  const subRes = await fetch(
    SUPABASE_URL + '/rest/v1/contract_submissions' +
      '?select=id,customer_data,imei,serial_number,contract_sessions(crm_snapshot)' +
      '&reviewed_at=not.is.null&rejected_at=is.null&imei=not.is.null&serial_number=not.is.null',
    { headers: authHeaders }
  );
  if (!subRes.ok) throw new Error('เรียก Supabase (contract_submissions) ไม่สำเร็จ (HTTP ' + subRes.status + ')');
  const subRows = await subRes.json();

  const items = [];
  subRows.forEach(function (row) {
    const session = row.contract_sessions || {};
    const snapshot = session.crm_snapshot || {};
    const snapshotItems = snapshot.items || [];
    const customer = row.customer_data || snapshot.customer || {};
    const addr = (customer.shippingAddress && !customer.shippingAddress.sameAsCurrent)
      ? customer.shippingAddress
      : (customer.address || {});
    snapshotItems.forEach(function (item) {
      items.push({
        soNumber: item.soNumber,
        contractNo: item.contractNo || null,
        customerId: item.customerId || null,
        customerName: customer.firstLastName || (snapshot.customer && snapshot.customer.firstLastName) || '-',
        product: item.product,
        color: item.color || null,
        recipientPhone: customer.phone || null,
        shippingAddress: {
          detail: addr.detail || null,
          subdistrictName: addr.subdistrictName || null,
          districtName: addr.districtName || null,
          provinceName: addr.provinceName || null,
          zip: addr.zip || null,
        },
        imei: row.imei,
        serialNumber: row.serial_number,
      });
    });
  });

  const soNumbers = items.map(function (it) { return it.soNumber; }).filter(Boolean);
  let packingBySo = {};
  if (soNumbers.length) {
    const inList = soNumbers.map(function (s) { return encodeURIComponent(s); }).join(',');
    const pkRes = await fetch(
      SUPABASE_URL + '/rest/v1/packing_records?so_number=in.(' + inList + ')' +
        '&select=so_number,packed_by,packed_at,tracking_no,courier,tracking_imported_at',
      { headers: authHeaders }
    );
    if (pkRes.ok) {
      const pkRows = await pkRes.json();
      pkRows.forEach(function (p) { packingBySo[p.so_number] = p; });
    }
  }

  const list = items.map(function (it) {
    const pk = packingBySo[it.soNumber] || {};
    return Object.assign({}, it, {
      packedBy: pk.packed_by || null,
      packedAt: pk.packed_at || null,
      trackingNo: pk.tracking_no || null,
      courier: pk.courier || null,
      trackingImportedAt: pk.tracking_imported_at || null,
    });
  });

  res.status(200).json({ items: list });
}

async function handleSubmit(req, res, authHeaders) {
  const body = req.body || {};
  const soNumber = String(body.soNumber || '').trim();
  const imei = String(body.imei || '').trim();
  const serialNumber = String(body.serialNumber || '').trim();
  const packedBy = String(body.packedBy || '').trim();
  if (!soNumber) { res.status(400).json({ error: 'ไม่มีเลขที่คำสั่งขาย (SO)' }); return; }
  if (!imei && !serialNumber) { res.status(400).json({ error: 'กรุณากรอก IMEI หรือ Serial Number อย่างน้อย 1 ช่อง' }); return; }

  const row = {
    so_number: soNumber,
    imei: imei || null,
    serial_number: serialNumber || null,
    packed_by: packedBy || null,
    updated_at: new Date().toISOString(),
  };

  const r = await fetch(SUPABASE_URL + '/rest/v1/packing_records?on_conflict=so_number', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, authHeaders),
    body: JSON.stringify(row),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error('บันทึกลง Supabase ไม่สำเร็จ (HTTP ' + r.status + '): ' + text.slice(0, 300));
  }

  // ซิงก์ไปที่ contract_submissions.imei/serial_number ด้วย (2026-09-07 แก้บั๊กจริง — เดิม endpoint นี้
  // เขียนแค่ packing_records ตัวเดียว แต่ตรรกะ "สถานะการทำสัญญา" (_lib/contract-status.js) และตัวกรอง "ยัง
  // ไม่แพ็ค" ใน api/stock-orders.js อ่านจาก contract_submissions.imei/serial_number ทั้งคู่ ทำให้ก่อนหน้านี้
  // ต่อให้แพ็คกิ้งกรอกข้อมูลจริง สถานะสัญญาก็ไม่มีทางขึ้น "สัญญาเสร็จสมบูรณ์"/"รอพนักงานเซ็นเอกสาร" ได้เลย)
  // หา submission ที่มี SO นี้อยู่ใน crm_snapshot.items[] แบบเดียวกับที่ api/stock-orders.js ใช้กรอง ไม่เจอก็
  // ไม่ error (แค่แปลว่า SO นี้ยังไม่ถึงขั้นตอนที่ทีมเร่งรัดหนี้สินยืนยันข้อมูลแล้ว — บันทึก packing_records
  // ไว้ก่อนได้)
  let synced = false;
  try {
    const subRes = await fetch(
      SUPABASE_URL + '/rest/v1/contract_submissions' +
        '?select=id,contract_sessions(crm_snapshot)&reviewed_at=not.is.null&rejected_at=is.null',
      { headers: authHeaders }
    );
    if (subRes.ok) {
      const subRows = await subRes.json();
      const match = subRows.find(function (row) {
        const items = (row.contract_sessions && row.contract_sessions.crm_snapshot && row.contract_sessions.crm_snapshot.items) || [];
        return items.some(function (it) { return it.soNumber === soNumber; });
      });
      if (match) {
        const patchRes = await fetch(SUPABASE_URL + '/rest/v1/contract_submissions?id=eq.' + encodeURIComponent(match.id), {
          method: 'PATCH',
          headers: Object.assign({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }, authHeaders),
          body: JSON.stringify({ imei: imei || null, serial_number: serialNumber || null }),
        });
        synced = patchRes.ok;
      }
    }
  } catch (syncErr) { /* ไม่บล็อกการบันทึกหลัก — packing_records สำเร็จไปแล้วถือว่าใช้ได้ */ }

  res.status(200).json({ ok: true, synced: synced });
}

async function handleImportTracking(req, res, authHeaders) {
  const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : [];
  if (!rows.length) { res.status(400).json({ error: 'ไม่มีรายการ tracking ให้นำเข้า' }); return; }
  const now = new Date().toISOString();
  const upserts = rows
    .filter(function (r) { return r && r.soNumber && r.trackingNo; })
    .map(function (r) {
      return {
        so_number: String(r.soNumber).trim(),
        tracking_no: String(r.trackingNo).trim(),
        courier: r.courier ? String(r.courier).trim() : null,
        tracking_imported_at: now,
        updated_at: now,
      };
    });
  if (!upserts.length) { res.status(400).json({ error: 'ไม่มีแถวที่มีทั้งเลข SO และเลข tracking ครบ' }); return; }

  const r = await fetch(SUPABASE_URL + '/rest/v1/packing_records?on_conflict=so_number', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, authHeaders),
    body: JSON.stringify(upserts),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error('บันทึกเลข tracking ไม่สำเร็จ (HTTP ' + r.status + '): ' + text.slice(0, 300));
  }
  res.status(200).json({ ok: true, imported: upserts.length });
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({ error: 'ยังไม่ได้ตั้งค่า SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY บน server' });
    return;
  }
  const authHeaders = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY };
  try {
    if (req.method === 'GET') {
      const soNumber = String((req.query && req.query.so) || '').trim();
      if (soNumber) { await handleSingleLookup(req, res, authHeaders, soNumber); return; }
      await handleList(req, res, authHeaders);
      return;
    }
    if (req.method === 'POST') {
      const action = String(req.body && req.body.action || '');
      if (action === 'submit') { await handleSubmit(req, res, authHeaders); return; }
      if (action === 'importTracking') { await handleImportTracking(req, res, authHeaders); return; }
      res.status(400).json({ error: 'ไม่รู้จัก action นี้' });
      return;
    }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
