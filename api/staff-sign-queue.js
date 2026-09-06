// Vercel serverless function — ข้อมูลลูกค้าที่ส่งฟอร์มทำสัญญาแล้วทั้งหมด (เมนู "ข้อมูลลูกค้าทำสัญญา")
// เดิม (2026-09-04 รอบแรก) กรองเฉพาะ staff_signed_at is null (คิวรอเซ็น) — ตอนนี้ (2026-09-04 รอบนี้ ตามที่
// user ขอ "หากมีส่งกลับมาแล้วให้แสดงข้อมูลไว้ที่เมนูข้อมูลลูกค้าทำสัญญา") คืนข้อมูลลูกค้าที่ส่งฟอร์มแล้วทุกราย
// ไม่กรองสถานะเซ็นอีกต่อไป — พนักงานเลื่อนดูข้อมูลเต็มของทุกคนได้ ส่วนคนที่ยังไม่มีใครเซ็นจะมีปุ่ม "เซ็นเอกสาร"
// เพิ่มขึ้นมาให้กดจากฝั่ง client (ดู staff-sign-tab.js)
//
// ไฟล์รูป/ลายเซ็นไม่ส่ง base64 ตรงๆ (bucket "contract-files" เป็น private ต้อง proxy ผ่าน server เท่านั้น —
// ทดสอบแล้ว GET ตรงจาก Storage โดยไม่ auth คืน 400 "Bucket not found") ส่งเป็น URL ของ /api/submission-file
// แทน ให้ client ใช้เป็น <img src="..."> ตรงๆ ได้เลย โหลดทีละไฟล์ตอนต้องใช้จริง ไม่ทำให้ response ก้อนนี้หนักเกินไป
//
// ต้องตั้งค่าใน Vercel project settings: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (เหมือน endpoint อื่นๆ)
// ต้องรัน supabase-staff-signature.sql ก่อน (เพิ่มคอลัมน์ staff_signature_path/staff_signed_by/staff_signed_at)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
    // embed contract_sessions ผ่าน FK (session_id) ดึง crm_snapshot มาแสดงชื่อลูกค้า/รายการสินค้า — ไม่กรอง
    // staff_signed_at อีกต่อไป (แสดงทุกคนที่ส่งฟอร์มแล้ว) เรียงล่าสุดขึ้นก่อน (ไล่ดูของใหม่ได้ง่ายกว่า)
    const r = await fetch(
      SUPABASE_URL + '/rest/v1/contract_submissions' +
        '?select=id,submitted_at,customer_data,file_paths,staff_signature_path,staff_signed_at,staff_signed_by,' +
        'rejected_at,rejected_by,rejected_fields,rejected_note,contract_sessions(token,crm_snapshot)' +
        '&order=submitted_at.desc',
      { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY } }
    );
    if (!r.ok) throw new Error('เรียก Supabase ไม่สำเร็จ (HTTP ' + r.status + ')');
    const rows = await r.json();

    const FILE_FIELDS = ['idCard', 'selfieWithId', 'guardianId', 'guarantorId', 'signature', 'guardianSignature', 'guarantorSignature', 'staffSignature'];

    const queue = rows.map(function (row) {
      const session = row.contract_sessions || {};
      const snapshot = session.crm_snapshot || {};
      const items = snapshot.items || [];
      const customer = row.customer_data || {};
      const filePaths = row.file_paths || {};

      const files = {};
      FILE_FIELDS.forEach(function (field) {
        const hasFile = field === 'staffSignature' ? !!row.staff_signature_path : !!filePaths[field];
        files[field] = hasFile ? ('/api/submission-file?submissionId=' + row.id + '&field=' + field) : null;
      });

      return {
        submissionId: row.id,
        submittedAt: row.submitted_at,
        token: session.token || null,
        customerName: (snapshot.customer && snapshot.customer.firstLastName) || customer.firstLastName || '-',
        products: items.map(function (it) { return it.product; }),
        soNumbers: items.map(function (it) { return it.soNumber; }),
        customer: customer, // ข้อมูลเต็มที่ลูกค้ากรอก (ส่วนตัว/ที่อยู่/บุคคลอ้างอิง/ผู้ปกครอง/ผู้ค้ำ) — ไม่มี base64 รูปปน (อยู่ใน Storage แยกแล้ว ดูผ่าน files)
        files: files,
        staffSignedAt: row.staff_signed_at,
        staffSignedBy: row.staff_signed_by,
        // สำหรับปุ่ม "ดาวน์โหลดสัญญา" (2026-09-06) — เรนเดอร์ PDF ฉบับจริงต่อ SO เดียวกับที่ CS ใช้ดูตัวอย่าง
        // ก่อนลูกค้ากรอกฟอร์ม (ดู contracts-tab.js's previewContractFor) แต่ใช้ข้อมูล/รูปจริงที่ลูกค้าส่งมาแล้ว
        items: items,
        contractDate: snapshot.contractDate || null,
        letterheadDataUrl: snapshot.letterheadDataUrl || null,
        // สถานะ "พนักงานปฏิเสธ ส่งกลับให้ลูกค้าแก้ไข" (2026-09-06)
        rejectedAt: row.rejected_at,
        rejectedBy: row.rejected_by,
        rejectedFields: row.rejected_fields || [],
        rejectedNote: row.rejected_note,
      };
    });

    res.status(200).json({ queue: queue });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
