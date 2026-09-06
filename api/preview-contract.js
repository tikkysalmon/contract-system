// Vercel serverless function — เตรียมเนื้อหาสัญญาตัวอย่างให้ลูกค้าอ่านก่อนลงลายมือชื่อ (ขั้นตอน "sign" ใน
// sign.js) — คืน block ย่อหน้า/ตาราง (JSON) ไม่ใช่ PDF สำเร็จรูป — ฝั่ง client (contract-html-renderer.js)
// เป็นคนสร้าง PDF จริงเอง ด้วยเทคนิคเดียวกับ debt-tracker's หนังสือบอกเลิกสัญญา (html2canvas + jsPDF, ดู
// contract-html-renderer.js) แทนที่การ render ด้วย pdf-lib ฝั่ง server แบบเดิม (2026-09-04 user ขอให้ทำ
// แบบเดียวกับ debt-tracker — คุมหน้าตาได้เองทั้งหมด ไม่ต้องพึ่งบริการแปลงไฟล์ภายนอกที่มีค่าใช้จ่าย/ต้องสมัคร)
//
// เนื้อหาข้อความยังมาจากการเติมข้อมูลลง master-*.docx จริงด้วย docxtemplater เหมือนเดิม (เทมเพลตที่ verify
// แล้วว่าคำต่อคำตรงกับต้นฉบับ 100%) แล้วแยกเป็น block ด้วย _lib/docx-blocks.js — แค่ไม่ได้ render จบเป็น PDF
// เองฝั่ง server อีกต่อไป
//
// ข้อจำกัดที่ทราบแล้ว (ยังไม่แก้ในรอบนี้):
// 1. รูปถ่าย (บัตร ปชช./เซลฟี่/ผู้ค้ำ/ผู้ปกครอง) ยังไม่ฝังจริงในตัวอย่างนี้ — {%src} เป็น syntax เฉพาะของ
//    Lark Base เอง ใช้กับ docxtemplater-image-module-free ตรงๆ ไม่ได้ (ทดสอบแล้ว error "Raw tag not in
//    paragraph") ตอนนี้แสดงเป็นข้อความ [แนบไฟล์รูปถ่าย: ...] แทนตำแหน่งรูปแทน
// 2. ลายเซ็นที่ยังไม่ได้เซ็น (อยู่ระหว่างขั้นตอนอ่านสัญญาก่อนเซ็น) แสดงเป็นเส้นประว่างเหมือนต้นฉบับ

const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const { parseDocxBodyToBlocks } = require('./_lib/docx-blocks');
const { numberToThaiBahtText } = require('../public/validation.js');

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');
const TEMPLATE_FILES = {
  downpayment: 'master-downpayment.docx',
  installment: 'master-installment.docx',
};

// {#field} {#$isImage} {%src} {/} {#!$isImage} {$fileName} {/} {/field} เป็น syntax รูปภาพเฉพาะของ Lark
// Base เอง — แทนที่ส่วนกลางด้วยข้อความ placeholder ให้ docxtemplater (ธรรมดา) render เป็นข้อความอ่านได้
// แทนการพยายามฝังรูปจริง (ดูหมายเหตุข้อ 1 ด้านบน)
const IMAGE_INNER = '} {#$isImage} {%src} {/} {#!$isImage} {$fileName} {/} {/';
function stripImageTags(xmlText, placeholderText) {
  return xmlText.split(IMAGE_INNER).join('} [' + placeholderText + '] {/');
}

function fmtMoney(n) { return Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtThaiDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const monthsTh = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  return d.getDate() + ' ' + monthsTh[d.getMonth()] + ' ' + (d.getFullYear() + 543); // พ.ศ.
}

// แปลง session + ข้อมูลที่ลูกค้ากรอกในฟอร์ม (จาก sign.js's state.data) ให้เป็นฟิลด์ตรงกับ tag ในเทมเพลตจริง
// (รายชื่อ tag ยืนยันจากการแกะไฟล์ .docx ต้นฉบับ ดู templates/build_master_templates.js)
function buildTemplateData(body) {
  const s = body.session || {};
  const d = body.customer || {};
  const isDownpayment = s.planType === 'downpayment';
  const remaining = Number(s.remainingBalance) || 0;
  const installmentCount = Number(s.installmentCount) || 0;
  const perInstallment = installmentCount ? remaining / installmentCount : 0;
  const firstDue = s.firstDueDate ? new Date(s.firstDueDate) : null;
  const lastDue = firstDue ? new Date(firstDue) : null;
  if (lastDue && installmentCount) lastDue.setMonth(lastDue.getMonth() + (installmentCount - 1));

  const data = {
    'วันที่ที่ออกสัญญา': fmtThaiDate(s.contractDate),
    'เลขที่สัญญา': s.contractNo || s.soNumber || '',
    'คำนำหน้า': d.title || '',
    'ชื่อ_นามสกุลลูกค้า': d.firstLastName || '',
    'อายุลูกค้า': d.age ? String(d.age) : '', // ลูกค้าพิมพ์อายุตรงๆ (2026-09-03) ไม่ได้เก็บวันเกิดเต็มแล้ว
    'เลขบัตรประชาชน': d.citizenId || '',
    'เบอร์ติดต่อ': d.phone || '',
    'รายการสินค้า': s.product || '',
    'สีสินค้า': s.color || '',
    'ชื่อบุคคลที่ติดต่อได้คนที่หนึ่ง': (d.reference && d.reference.firstLastName) || '',
    'เบอร์ติดต่อบุคคลอ้างอิงที่1': (d.reference && d.reference.phone) || '',
    'ความเกี่ยวข้อง1': (d.reference && d.reference.relation) || '',
    '_ชำระทุกวันที่': firstDue ? String(firstDue.getDate()) : '',
    'วันที่เริ่มส่งยอด': fmtThaiDate(s.firstDueDate),
    'วันสุดท้ายที่ส่งยอด': lastDue ? fmtThaiDate(lastDue.toISOString().slice(0, 10)) : '',
    'รูปถ่ายบัตรประชาชน': true,
    'รูปถ่ายคู่บัตรประชาชน': true,
  };

  if (isDownpayment) {
    Object.assign(data, {
      'ราคา__ดาวน์_': fmtMoney(s.downPayment),
      'ราคา__ดาวน์__ภาษาไทย': numberToThaiBahtText(s.downPayment),
      'ระยะเวลาผ่อน__ดาวน์_': String(installmentCount),
      'ราคาผ่อนต่องวด__ดาวน์_': fmtMoney(perInstallment),
      'ราคาผ่อนต่องวด__ดาวน์__ภาษาไทย': numberToThaiBahtText(perInstallment),
      'ราคาสุทธิ์__ดาวน์_': fmtMoney(s.netPrice),
      'ยอดคงเหลือที่ต้องชำระ__ดาวน์_': fmtMoney(remaining),
    });
  } else {
    Object.assign(data, {
      'ราคาเครื่องเต็ม__ผ่อน_': fmtMoney(s.netPrice),
      '_ราคาเครื่องเต็ม_ภาษาไทย__ผ่อน_': numberToThaiBahtText(s.netPrice),
      'ยอดที่ชำระไว้ทั้งสิ้น__ผ่อน_': fmtMoney(s.downPayment),
      '_ยอดที่ชำระไว้ทั้งสิ้น_ภาษาไทย__ผ่อน_': numberToThaiBahtText(s.downPayment),
      'ยอดคงเหลือที่ต้องชำระ__ผ่อน_': fmtMoney(remaining),
      'ยอดคงเหลือที่ต้องชำระภาษาไทย__ผ่อน_': numberToThaiBahtText(remaining),
      'ระยะเวลาผ่อน__ผ่อน_': String(installmentCount),
    });
  }

  for (let i = 1; i <= 12; i++) {
    if (i <= installmentCount && firstDue) {
      const due = new Date(firstDue);
      due.setMonth(due.getMonth() + (i - 1));
      data['งวดที่_' + i] = fmtThaiDate(due.toISOString().slice(0, 10));
      const satang = Math.round(remaining * 100);
      const baseSatang = Math.floor(satang / installmentCount);
      const remainderSatang = satang - baseSatang * installmentCount;
      const amt = (baseSatang + (i === installmentCount ? remainderSatang : 0)) / 100;
      data['ยอดผ่อน_' + i] = fmtMoney(amt);
    } else {
      data['งวดที่_' + i] = '-';
      data['ยอดผ่อน_' + i] = '-';
    }
  }

  // เกณฑ์อายุแบบง่าย < 19 ปี — user ตัดสินใจ 2026-09-03 ไม่เพิ่มช่องเดือนเกิดจากลูกค้า เพราะถ้าจะเช็คแม่นจริง
  // ควรใช้ OCR อ่านวันเกิดจากบัตร ปชช. ผ่าน API key แทน (ยังไม่ได้สร้าง — กฎอนุโลม 3 เดือนตามสเปกเดิมจะกลับมา
  // ใช้แม่นยำอีกครั้งตอนนั้น ด้วย requiresGuardian(dob, contractDate) เดิมใน validation.js)
  const hasGuarantor = d.nationality && d.nationality !== 'ไทย';
  const hasGuardian = !hasGuarantor && Number(d.age) > 0 && Number(d.age) < 19;
  data.hasGuarantor = !!hasGuarantor;
  data.hasGuardian = !!hasGuardian;
  if (hasGuarantor) {
    Object.assign(data, {
      'คำนำหน้าผู้ค้ำ': (d.guarantor && d.guarantor.title) || '',
      'ชื่อ_นามสกุล_ผู้ค้ำประกัน': (d.guarantor && d.guarantor.firstLastName) || '',
      'เบอร์ติดต่อ_ผู้ค้ำ': (d.guarantor && d.guarantor.phone) || '',
      'ไฟล์_บัตรประชาชนผู้ค้ำ': true,
    });
  }
  if (hasGuardian) {
    Object.assign(data, {
      'คำนำหน้า_ผู้ปกครอง': (d.guardian && d.guardian.title) || '',
      'ชื่อ_นามสกุล_ผู้ปกครอง': (d.guardian && d.guardian.firstLastName) || '',
      'เบอร์ติดต่อ_ผู้ปกครอง': (d.guardian && d.guardian.phone) || '',
      'รูปภาพสำเนาบัตรประชาชน_ผู้ปกครอง': true,
    });
  }
  return data;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store'); // 2026-09-04 กัน Vercel edge cache เสิร์ฟข้อมูลเก่า (บั๊กจริงที่เจอ: GET /api/staff-signature หลังอัปเดตแล้วยังได้ค่าเก่า)
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const body = req.body || {};
    const planType = (body.session && body.session.planType) === 'downpayment' ? 'downpayment' : 'installment';
    const templatePath = path.join(TEMPLATES_DIR, TEMPLATE_FILES[planType]);

    const zip = new PizZip(fs.readFileSync(templatePath, 'binary'));
    const cleanedXml = stripImageTags(zip.file('word/document.xml').asText(), 'แนบไฟล์รูปถ่าย');
    zip.file('word/document.xml', cleanedXml);

    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
    const templateData = buildTemplateData(body);
    doc.render(templateData);

    const outXml = doc.getZip().file('word/document.xml').asText();
    // แยกเป็น block ย่อหน้า/ตารางตามที่ปรากฏจริงในเอกสาร (ไม่ตัด tag ทิ้งรวมเป็นข้อความก้อนเดียว) ให้ตาราง
    // แสดงการผ่อนชำระออกมาเป็นตารางจริงตอนขึ้น HTML/PDF ฝั่ง client แทนที่จะเป็นตัวเลขไหลรวมกันอ่านไม่ออก
    const rawBlocks = parseDocxBodyToBlocks(outXml);

    // ตัดจำนวนแถวในตารางผ่อนให้เท่ากับ installmentCount จริง (เดิม fix 12 แถวเสมอ เติม "-" ในแถวที่เกิน —
    // 2026-09-04 user ขอให้แสดงเท่าจำนวนงวดจริงเท่านั้น) + ตัดทุกอย่างตั้งแต่ placeholder รูปแนบตัวแรกทิ้ง
    // (ไม่ใช่ตัดทุกอย่างหลังตารางแบบเดิม — เจอบั๊กจริง: กรณีมีผู้ค้ำ เนื้อหา "หนังสือสัญญาค้ำประกัน" อยู่ต่อ
    // จากตารางแต่ก่อนรูปแนบ ถูกตัดทิ้งไปด้วยทั้งที่เป็นเนื้อหาจริงที่ต้องเก็บไว้) ส่วนรูปแนบ/ตรารับรองสำเนา/
    // ลายเซ็น contract-html-renderer.js ฝั่ง client เป็นคนสร้างเองทั้งหมดจากข้อมูลลูกค้าจริง ไม่ต้องพึ่ง docx
    const installmentCount = Number((body.session && body.session.installmentCount) || 0);
    const tableIdx = rawBlocks.findIndex((b) => b.type === 'table');
    const headingIdx = rawBlocks.findIndex((b) => b.type === 'paragraph' && b.text.indexOf('ตารางแสดงภาระหนี้') === 0);
    const photoPlaceholderIdx = rawBlocks.findIndex((b) => b.type === 'paragraph' && b.text.indexOf('แนบไฟล์รูปถ่าย') !== -1);
    let blocks = photoPlaceholderIdx !== -1 ? rawBlocks.slice(0, photoPlaceholderIdx) : rawBlocks;
    if (tableIdx !== -1) {
      blocks[tableIdx] = Object.assign({}, blocks[tableIdx], {
        rows: installmentCount > 0 ? blocks[tableIdx].rows.slice(0, installmentCount) : blocks[tableIdx].rows,
      });
      if (headingIdx !== -1 && headingIdx < blocks.length) {
        blocks[headingIdx] = Object.assign({}, blocks[headingIdx], { pageBreakBefore: true });
      }
    }

    res.status(200).json({
      blocks: blocks,
      // final=true (2026-09-06) — พนักงานกด "ดาวน์โหลดสัญญา" ตรวจเอกสารที่ลูกค้าเซ็น/ส่งกลับมาแล้วจริง
      // ไม่ใช่ฉบับร่างก่อนเซ็นอีกต่อไป (ดู staff-sign-tab.js)
      title: (body.final ? 'สัญญาเช่าซื้อ (ฉบับที่ลูกค้าลงลายมือชื่อแล้ว)' : 'ตัวอย่างสัญญาเช่าซื้อ (ฉบับร่างก่อนลงลายมือชื่อ)'),
    });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
};
