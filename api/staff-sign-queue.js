// Vercel serverless function — ข้อมูลทุกรายการในเมนู "ข้อมูลลูกค้าทำสัญญา" (ทั้งที่ลูกค้าส่งฟอร์มกลับมาแล้ว
// และที่ยังไม่ส่ง) เดิม (2026-09-04 รอบแรก) กรองเฉพาะ staff_signed_at is null (คิวรอเซ็น) ต่อมา (2026-09-04
// รอบสอง) เปลี่ยนเป็น base ที่ contract_submissions (มีแต่รายการที่ส่งฟอร์มแล้ว) — ตอนนี้ (2026-09-07 user ขอ
// คอลัมน์ "สถานะการสร้างลิงก์ส่งแบบฟอร์มให้ลูกค้า (มี Timestamp)" ซึ่งต้องรู้ตั้งแต่ตอนสร้างลิงก์ ก่อนลูกค้า
// จะส่งฟอร์มกลับมาด้วยซ้ำ) เปลี่ยน base มาเป็น contract_sessions แล้ว left-embed contract_submissions แทน —
// แถวที่ยังไม่มีใครส่งฟอร์มกลับมาจะมี submissionId เป็น null (ฝั่ง client ซ่อนปุ่ม ดูข้อมูลลูกค้า/ยืนยัน/เซ็น
// เอกสาร ไว้เพราะยังไม่มีข้อมูลให้ตรวจ)
//
// ไฟล์รูป/ลายเซ็นไม่ส่ง base64 ตรงๆ (bucket "contract-files" เป็น private ต้อง proxy ผ่าน server เท่านั้น —
// ทดสอบแล้ว GET ตรงจาก Storage โดยไม่ auth คืน 400 "Bucket not found") ส่งเป็น URL ของ /api/submission-file
// แทน ให้ client ใช้เป็น <img src="..."> ตรงๆ ได้เลย โหลดทีละไฟล์ตอนต้องใช้จริง ไม่ทำให้ response ก้อนนี้หนักเกินไป
//
// ต้องตั้งค่าใน Vercel project settings: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (เหมือน endpoint อื่นๆ)
// ต้องรัน supabase-staff-signature.sql ก่อน (เพิ่มคอลัมน์ staff_signature_path/staff_signed_by/staff_signed_at)
// ต้องรัน supabase-created-by.sql ก่อน (เพิ่มคอลัมน์ created_by_name — ชื่อพนักงานที่กดสร้างลิงก์)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const { computeContractStatus, computeShippingStatus } = require('./_lib/contract-status');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store'); // 2026-09-04 กัน Vercel edge cache เสิร์ฟข้อมูลเก่า (บั๊กจริงที่เจอ: GET /api/staff-signature หลังอัปเดตแล้วยังได้ค่าเก่า)
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({ error: 'ยังไม่ได้ตั้งค่า SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY บน server' });
    return;
  }
  try {
    // base = contract_sessions (ทุกลิงก์ที่เคยสร้าง ไม่ว่าลูกค้าจะส่งฟอร์มกลับมาแล้วหรือยัง) left-embed
    // contract_submissions ผ่าน FK (session_id) — ต่างจากเดิมที่ base เป็น contract_submissions (มีแต่รายการ
    // ที่ส่งฟอร์มแล้ว) จำกัด 500 แถวล่าสุด กันโหลดหนักถ้ามีลิงก์สะสมเยอะมาก
    const r = await fetch(
      SUPABASE_URL + '/rest/v1/contract_sessions' +
        '?select=id,token,created_at,created_by_name,crm_snapshot,' +
        'contract_submissions(id,submitted_at,customer_data,file_paths,staff_signature_path,staff_signed_at,staff_signed_by,' +
        'rejected_at,rejected_by,rejected_fields,rejected_note,imei,serial_number,reviewed_at,reviewed_by)' +
        '&order=created_at.desc&limit=500',
      { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY } }
    );
    if (!r.ok) throw new Error('เรียก Supabase ไม่สำเร็จ (HTTP ' + r.status + ')');
    const rows = await r.json();

    // "วันที่จัดส่ง" ต่อ SO (2026-09-08 user ขอ) — เอาจาก packing_records.tracking_imported_at (เวลาที่ทีม
    // แพ็คกิ้งนำเข้าเลข tracking จากไฟล์ export ของ MyOrder กลับมา ดู api/packing.js's handleList ที่ join
    // แบบเดียวกันนี้อยู่แล้ว) ไม่ใช่วันที่ระบบส่งออกไปให้ MyOrder แต่เป็นวันที่รู้ว่าพัสดุถูกรับเข้าขนส่งจริง
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

    const FILE_FIELDS = ['idCard', 'selfieWithId', 'guardianId', 'guarantorId', 'signature', 'guardianSignature', 'guarantorSignature', 'staffSignature'];

    const queue = rows.map(function (row) {
      const snapshot = row.crm_snapshot || {};
      const items = snapshot.items || [];
      // ปกติมีได้แค่ 1 submission ต่อ session (ลูกค้ากรอกฟอร์มครั้งเดียว) — sub เป็น null ถ้ายังไม่ส่งกลับมา
      const submissions = row.contract_submissions || [];
      const sub = submissions[0] || null;
      const customer = (sub && sub.customer_data) || {};
      const filePaths = (sub && sub.file_paths) || {};

      const files = {};
      FILE_FIELDS.forEach(function (field) {
        const hasFile = sub && (field === 'staffSignature' ? !!sub.staff_signature_path : !!filePaths[field]);
        files[field] = hasFile ? ('/api/submission-file?submissionId=' + sub.id + '&field=' + field) : null;
      });

      return {
        submissionId: sub ? sub.id : null,
        sessionToken: row.token,
        createdAt: row.created_at, // เวลาที่ CS กดสร้างลิงก์ (2026-09-07 คอลัมน์ "สถานะการสร้างลิงก์...")
        createdByName: row.created_by_name || null, // ชื่อพนักงาน (CS) ที่กดสร้างลิงก์ (2026-09-07)
        submittedAt: sub ? sub.submitted_at : null,
        customerName: (snapshot.customer && snapshot.customer.firstLastName) || customer.firstLastName || '-',
        products: items.map(function (it) { return it.product; }),
        soNumbers: items.map(function (it) { return it.soNumber; }),
        // items[] มี soNumber/contractNo/planType/customerId ต่อ SO ให้แสดงเป็นแถวย่อย (2026-09-07) +
        // shippingDate ต่อ SO (2026-09-08 — จาก packing_records.tracking_imported_at)
        items: items.map(function (it) {
          const pk = packingBySo[it.soNumber];
          return Object.assign({}, it, { shippingDate: (pk && pk.tracking_imported_at) || null });
        }),
        customer: customer, // ข้อมูลเต็มที่ลูกค้ากรอก (ส่วนตัว/ที่อยู่/บุคคลอ้างอิง/ผู้ปกครอง/ผู้ค้ำ) — ไม่มี base64 รูปปน (อยู่ใน Storage แยกแล้ว ดูผ่าน files) — ว่างเปล่าถ้ายังไม่ส่งฟอร์ม
        files: files,
        staffSignedAt: sub && sub.staff_signed_at,
        staffSignedBy: sub && sub.staff_signed_by,
        contractDate: snapshot.contractDate || null,
        letterheadDataUrl: snapshot.letterheadDataUrl || null,
        // สถานะ "พนักงานปฏิเสธ ส่งกลับให้ลูกค้าแก้ไข" (2026-09-06)
        rejectedAt: sub && sub.rejected_at,
        rejectedBy: sub && sub.rejected_by,
        rejectedFields: (sub && sub.rejected_fields) || [],
        rejectedNote: sub && sub.rejected_note,
        // เลข IMEI/Serial Number (2026-09-06) — ทีมแพ็คกิ้งจะเป็นคนกรอกจริง (เมนูนี้ยังไม่ได้สร้าง) เตรียม
        // ฟิลด์ไว้ก่อนให้สถานะ "สัญญาเสร็จสมบูรณ์" อ้างอิงได้
        imei: (sub && sub.imei) || null,
        serialNumber: (sub && sub.serial_number) || null,
        // "ยืนยัน" ตรวจสอบข้อมูลแล้ว (2026-09-06) — คนละ action กับ "เซ็นเอกสาร"
        reviewedAt: sub && sub.reviewed_at,
        reviewedBy: sub && sub.reviewed_by,
        contractStatus: computeContractStatus({
          submitted: !!sub,
          rejectedAt: sub && sub.rejected_at,
          reviewedAt: sub && sub.reviewed_at,
          staffSignedAt: sub && sub.staff_signed_at,
          imei: sub && sub.imei,
          serialNumber: sub && sub.serial_number,
        }),
        shippingStatus: computeShippingStatus(),
      };
    });

    res.status(200).json({ queue: queue });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
