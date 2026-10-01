// Vercel serverless function — รายการลิงก์แบบฟอร์มทั้งหมดที่ CS สร้างไว้ (2026-09-04 ตามที่ user ขอ ให้เมนู
// "สำหรับ CS" ตรวจสอบได้ว่าลูกค้ารายไหนสร้างลิงก์แล้ว/ยังไม่กรอกข้อมูลกลับมา + คัดลอกลิงก์เดิมส่งซ้ำได้)
//
// GET -> { sessions: [{ token, createdAt, customerName, products, soNumbers, submitted, submittedAt }] }
// submitted=false คือยังไม่มีแถวใน contract_submissions ผูกกับ session นี้ (ลูกค้ายังไม่กรอก/ส่งฟอร์มกลับมา)
//
// ต้องตั้งค่าใน Vercel project settings: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (เหมือน endpoint อื่นๆ)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const { computeContractStatus, computeShippingStatus } = require('./_lib/contract-status');

// ?view=customer-info (2026-10-01) — เมนู "ข้อมูลลูกค้า" (public/customer-info-tab.js) ให้แผนกบริการตรวจสอบ
// ข้อมูลลูกค้าเบื้องต้นและแจ้งลูกค้า 1 แถวต่อ 1 SO — ใส่เป็น view ในไฟล์นี้แทนสร้าง api/*.js ใหม่ เพราะโปรเจกต์
// ชนโควต้า 12 serverless function ของ Vercel Hobby แล้ว (ดู api/packing.js) ไม่แตะ response ปกติด้านล่างเลย
// สถานะการจัดส่ง: มีเลข tracking (packing_records.tracking_no นำเข้าจาก MyOrder ผ่านเมนู "สำหรับแพ็คกิ้ง") =
// "จัดส่งสินค้าแล้ว" อัตโนมัติ ไม่งั้น "รอจัดส่ง" — คำนวณสดทุกครั้ง ไม่เก็บเป็นคอลัมน์ จึงไม่มีทางค้างไม่ตรงกับเลขพัสดุ
async function handleCustomerInfo(res) {
  const authHeaders = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY };
  const r = await fetch(
    SUPABASE_URL + '/rest/v1/contract_sessions?select=token,created_at,crm_snapshot,contract_submissions(id,submitted_at,rejected_at,reviewed_at,staff_signed_at,imei,serial_number,customer_data)&order=created_at.desc&limit=500',
    { headers: authHeaders }
  );
  if (!r.ok) throw new Error('เรียก Supabase ไม่สำเร็จ (HTTP ' + r.status + ')');
  const sessions = await r.json();

  const soNumbers = [];
  sessions.forEach(function (s) {
    ((s.crm_snapshot || {}).items || []).forEach(function (it) { if (it.soNumber) soNumbers.push(it.soNumber); });
  });
  const trackingBySo = {};
  if (soNumbers.length) {
    const inList = soNumbers.map(function (s) { return encodeURIComponent(s); }).join(',');
    const pkRes = await fetch(
      SUPABASE_URL + '/rest/v1/packing_records?so_number=in.(' + inList + ')&select=so_number,tracking_no,courier',
      { headers: authHeaders }
    );
    if (pkRes.ok) (await pkRes.json()).forEach(function (p) { trackingBySo[p.so_number] = p; });
  }

  const rows = [];
  sessions.forEach(function (s) {
    const snap = s.crm_snapshot || {};
    // สถานะการทำสัญญา — สูตรเดียวกับเมนู "ข้อมูลลูกค้าทำสัญญา" (_lib/contract-status.js) ต่อ session (2026-10-01)
    const sub = (s.contract_submissions || [])[0] || null;
    const subShip = (sub && sub.customer_data && sub.customer_data.shippingAddress) || {};
    // ที่อยู่ในการจัดส่งสินค้าเป็นข้อความเดียว (2026-10-01 หน้ารายละเอียดเมนู "ข้อมูลลูกค้า") — สูตรเดียวกับที่อื่น: ใช้
    // shippingAddress ถ้าไม่ได้ติ๊ก "ที่อยู่เดียวกับปัจจุบัน" ไม่งั้น fallback ที่อยู่ปัจจุบัน คัดมาเฉพาะข้อความที่อยู่เท่านั้น
    const subData = (sub && sub.customer_data) || {};
    const effAddr = (subShip.sameAsCurrent === false || (subShip.sameAsCurrent === undefined && subShip.detail)) ? subShip : (subData.address || {});
    const shippingAddressText = [effAddr.detail, effAddr.subdistrictName && ('ต.' + effAddr.subdistrictName), effAddr.districtName && ('อ.' + effAddr.districtName),
      effAddr.provinceName && ('จ.' + effAddr.provinceName), effAddr.zip].filter(Boolean).join(' ') || null;
    const contractStatus = computeContractStatus({
      submitted: !!sub, rejectedAt: sub && sub.rejected_at, reviewedAt: sub && sub.reviewed_at,
      staffSignedAt: sub && sub.staff_signed_at, imei: sub && sub.imei, serialNumber: sub && sub.serial_number,
    });
    ((snap.items) || []).forEach(function (it) {
      const pk = trackingBySo[it.soNumber] || {};
      const trackingNo = pk.tracking_no || null;
      const channel = it.deliveryChannel || null;
      const isPickup = String(channel || '').indexOf('นัดรับสาขา') === 0;
      rows.push({
        soNumber: it.soNumber || null,
        customerId: it.customerId || null,
        customerName: (snap.customer && snap.customer.firstLastName) || '-',
        customerType: it.installmentTypeLabel || null,
        contractStatus: contractStatus,
        // ข้อมูลผู้รับสินค้า (2026-10-01) — คัดเฉพาะ 3 ฟิลด์ ไม่ส่ง customer_data ทั้งก้อนออกไป (มีข้อมูลส่วนตัวเต็ม)
        hasSubmission: !!sub,
        submissionId: sub ? sub.id : null, // ใช้ยิง staff-actions updateLogistics (แก้ช่องทางจัดส่ง/ของแถม ในเมนู "ข้อมูลลูกค้า")
        giftItem: subData.giftItem || null,
        shippingAddressText: shippingAddressText,
        recipientName: subShip.recipientName || null,
        recipientPhone: subShip.recipientPhone || null,
        shippingNote: subShip.note || null,
        planType: it.planType || null, // fallback ตอน installmentTypeLabel ว่าง (ลิงก์รุ่นเก่า)
        deliveryChannel: channel,
        pickupDate: isPickup ? (it.pickupDate || null) : null,
        pickupTime: isPickup ? (it.pickupTime || null) : null,
        // นัดรับสาขาไม่มีเลข tracking — ใช้ pickedUpAt ที่แผนกบริการกดยืนยัน (staff-actions 'markPickedUp') แทน
        shippingStatus: trackingNo ? 'จัดส่งสินค้าแล้ว' : (isPickup && it.pickedUpAt ? 'ลูกค้ารับสินค้าแล้ว' : 'รอจัดส่ง'),
        sessionToken: s.token,
        isPickup: isPickup,
        pickedUpAt: it.pickedUpAt || null,
        pickupHistory: isPickup && Array.isArray(it.pickupHistory) ? it.pickupHistory : [], // ประวัติเลื่อนนัดรับ (reschedulePickup)
        trackingNo: trackingNo,
        courier: pk.courier || null,
        createdAt: s.created_at,
      });
    });
  });
  res.status(200).json({ rows: rows });
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({ error: 'ยังไม่ได้ตั้งค่า SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY บน server' });
    return;
  }
  if (req.query && req.query.view === 'customer-info') {
    try { await handleCustomerInfo(res); } catch (err) { res.status(500).json({ error: err.message }); }
    return;
  }
  try {
    // embed contract_submissions ผ่าน FK (session_id) แค่ดูว่ามีแถวหรือไม่ + submitted_at เอาไปเรียงคิว/แสดงผล
    // จำกัด 200 แถวล่าสุด กันโหลดหนักถ้ามีลิงก์สะสมเยอะมาก (ยังไม่ทำ pagination/ค้นหาฝั่ง server รอบนี้)
    // 2026-09-09 เพิ่ม contract_submissions.id + customer_data — id ใช้เรียก /api/staff-actions'
    // updateLogistics (แก้ที่อยู่จัดส่ง/ของแถม/ช่องทางการจัดส่งได้ตรงนี้ ไม่ต้องผ่านทีมเร่งรัดหนี้สิน — ดู
    // "logistics" ด้านล่าง) customer_data ไม่ส่งทั้งก้อนออกไปให้ client เด็ดขาด (มีข้อมูลส่วนตัวเต็ม เช่น
    // เลขบัตร ปชช./เบอร์โทร) คัด **เฉพาะ 2 ฟิลด์ที่ CS ควรเห็น** (shippingAddress/giftItem) ออกมาเป็น
    // "logistics" ก่อนส่งเท่านั้น
    const r = await fetch(
      SUPABASE_URL + '/rest/v1/contract_sessions' +
        '?select=token,created_at,created_by_name,crm_snapshot,contract_submissions(id,submitted_at,rejected_at,reviewed_at,staff_signed_at,imei,serial_number,customer_data)' +
        '&order=created_at.desc&limit=200',
      { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY } }
    );
    if (!r.ok) throw new Error('เรียก Supabase ไม่สำเร็จ (HTTP ' + r.status + ')');
    const rows = await r.json();

    // "วันที่จัดส่ง" ต่อ SO (2026-09-08 user ขอ) — เอาจาก packing_records.tracking_imported_at เหมือน
    // staff-sign-queue.js (ดูหมายเหตุที่นั่น)
    const authHeaders = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY };
    const allSoNumbers = [];
    rows.forEach(function (row) {
      ((row.crm_snapshot || {}).items || []).forEach(function (it) { if (it.soNumber) allSoNumbers.push(it.soNumber); });
    });
    let packingBySo = {};
    if (allSoNumbers.length) {
      const inList = allSoNumbers.map(function (s) { return encodeURIComponent(s); }).join(',');
      const pkRes = await fetch(
        SUPABASE_URL + '/rest/v1/packing_records?so_number=in.(' + inList + ')&select=so_number,tracking_imported_at',
        { headers: authHeaders }
      );
      if (pkRes.ok) {
        const pkRows = await pkRes.json();
        pkRows.forEach(function (p) { packingBySo[p.so_number] = p; });
      }
    }

    const sessions = rows.map(function (row) {
      const snap = row.crm_snapshot || {};
      const items = (snap.items || []).map(function (it) {
        const pk = packingBySo[it.soNumber];
        return Object.assign({}, it, { shippingDate: (pk && pk.tracking_imported_at) || null });
      });
      const submissions = row.contract_submissions || [];
      const sub = submissions[0] || null;
      const customerData = (sub && sub.customer_data) || {};
      // เอฟเฟกทีฟที่อยู่จัดส่งปัจจุบัน — สูตรเดียวกับ api/stock-orders.js's fetchCreditOrders (ใช้ shippingAddress
      // ถ้าลูกค้าระบุไว้ไม่เหมือนที่อยู่ปัจจุบัน ไม่งั้น fallback ไปที่อยู่ปัจจุบัน) ให้ค่าเริ่มต้นของฟอร์มแก้ไขตรงกับ
      // ที่ระบบอื่นใช้จริงเป๊ะ
      const rawShip = customerData.shippingAddress || {};
      const effectiveShippingAddress = Object.assign({}, (rawShip && !rawShip.sameAsCurrent) ? rawShip : (customerData.address || {}), {
        // ชื่อผู้รับ/เบอร์/หมายเหตุ (2026-10-01) ต้องพกไปด้วยเสมอ แม้ใช้ที่อยู่เดียวกับที่อยู่ปัจจุบัน — ไม่งั้น CS กดบันทึก
        // แก้ไขข้อมูลจัดส่ง (updateLogistics เขียนทับทั้งก้อน shippingAddress) แล้ว 3 ฟิลด์นี้จะหายไป
        recipientName: rawShip.recipientName || '', recipientPhone: rawShip.recipientPhone || '', note: rawShip.note || '',
      });
      return {
        token: row.token,
        createdAt: row.created_at,
        createdByName: row.created_by_name || null, // ชื่อพนักงาน (CS) ที่กดสร้างลิงก์ (2026-09-07)
        customerName: (snap.customer && snap.customer.firstLastName) || '-',
        products: items.map(function (it) { return it.product; }),
        soNumbers: items.map(function (it) { return it.soNumber; }),
        // items[] เต็ม (soNumber/contractNo/planType/customerId) ให้แสดงเป็นแถวย่อยต่อ SO (2026-09-07 ดู staff-sign-tab.js's initCsStatusView)
        items: items,
        submitted: submissions.length > 0,
        submittedAt: sub ? sub.submitted_at : null,
        submissionId: sub ? sub.id : null, // ใช้ยิง /api/staff-actions action:updateLogistics (2026-09-09)
        // ข้อมูล "โลจิสติกส์" ที่ CS แก้ไขได้เอง (ไม่ต้องผ่านทีมเร่งรัดหนี้สิน) — คัดมาเฉพาะ 2 ฟิลด์นี้ ไม่ส่ง
        // customer_data ทั้งก้อนออกไปเด็ดขาด (มีข้อมูลส่วนตัวลูกค้าเต็ม เช่น เลขบัตร ปชช./เบอร์โทร ที่ CS ไม่ควรเห็น)
        logistics: sub ? { shippingAddress: effectiveShippingAddress, giftItem: customerData.giftItem || null } : null,
        // สถานะสรุปสำหรับ CS (2026-09-06) — CS เห็นแค่สถานะ ไม่เห็น/แก้ข้อมูลเต็มของลูกค้า (ดู _lib/contract-status.js)
        contractStatus: computeContractStatus({
          submitted: submissions.length > 0,
          rejectedAt: sub && sub.rejected_at,
          reviewedAt: sub && sub.reviewed_at,
          staffSignedAt: sub && sub.staff_signed_at,
          imei: sub && sub.imei,
          serialNumber: sub && sub.serial_number,
        }),
        shippingStatus: computeShippingStatus(),
      };
    });

    res.status(200).json({ sessions: sessions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
