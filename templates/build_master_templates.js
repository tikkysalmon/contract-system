// สร้างเทมเพลตหลัก 2 ไฟล์ (แยกตามแผนผ่อน) ที่รองรับทั้ง 3 กลุ่มลูกค้า (ทั่วไป/ผู้ค้ำ/ผู้ปกครอง) ด้วย
// {#hasGuarantor}/{#hasGuardian} — เนื้อหาทุกตัวอักษร copy จากไฟล์ต้นฉบับ 3 ไฟล์ ไม่มีการแก้ไขถ้อยคำใดๆ
// วิธีการ: หา paragraph boundary ที่ปลอดภัย (ไม่ตัดกลาง floating textbox) แล้วแทรก marker paragraph ใหม่
// ล้วนๆ (ไม่แตะเนื้อหาเดิม) ให้ docxtemplater เป็นคนจัดการซ่อน/แสดงตอน render — ตรวจสอบผลด้วย text-diff
// กับไฟล์ต้นฉบับจริงเสมอ (ดู build_and_verify_docx2.js / build_and_verify_docx3.js ที่ผ่านการทดสอบแล้ว)

const fs = require('fs');
const path = require('path');
const PizZip = require('C:/Users/user/OneDrive/Desktop/AI/claude code/15_ระบบทำสัญญา/webapp/node_modules/pizzip');
const Docxtemplater = require('C:/Users/user/OneDrive/Desktop/AI/claude code/15_ระบบทำสัญญา/webapp/node_modules/docxtemplater');

const base = __dirname;
const DOCX1 = 'C:/Users/user/OneDrive/Desktop/AI/claude code/15_ระบบทำสัญญา/สัญญาเช่าซื้อวางดาวน์ (Revise 26.05.2026).docx';
const DOCX2 = 'C:/Users/user/OneDrive/Desktop/AI/claude code/15_ระบบทำสัญญา/สัญญาเช่าซื้อ+หนังสือค้ำประกัน (Revise 26.05.2026).docx';
const DOCX3 = 'C:/Users/user/OneDrive/Desktop/AI/claude code/15_ระบบทำสัญญา/สัญญาเช่าซื้อ+หนังสือรับรอง (Revise 26.05.2026).docx';

function readDocxXml(docxPath) {
  const zip = new PizZip(fs.readFileSync(docxPath, 'binary'));
  return zip.file('word/document.xml').asText();
}
function marker(tag) { return '<w:p><w:r><w:t>' + tag + '</w:t></w:r></w:p>'; }
function prevParaStart(xml, idx) {
  const re = /<w:p(?:\s[^>]*)?>/g; let last = -1, m;
  while ((m = re.exec(xml)) && m.index < idx) last = m.index;
  return last;
}
function nextParaStart(xml, fromIdx) {
  const re = /<w:p(?:\s[^>]*)?>/g; re.lastIndex = fromIdx;
  const m = re.exec(xml);
  return m.index;
}
function landmarksFor(xml, titleFindFn) {
  const P1 = titleFindFn(xml);
  const custIdIdx = xml.indexOf('รูปถ่ายบัตรประชาชน');
  const P2 = prevParaStart(xml, custIdIdx);
  const selfieOpen = xml.indexOf('รูปถ่ายคู่บัตรประชาชน');
  const selfieClose = xml.indexOf('รูปถ่ายคู่บัตรประชาชน', selfieOpen + 1);
  const P3 = nextParaStart(xml, selfieClose);
  const P4 = xml.lastIndexOf('<w:sectPr');
  return { P1, P2, P3, P4 };
}

// --- ดึง XML ของ 2 ไฟล์ต้นทาง (guarantor/guardian) มาเป็น raw string segment สำหรับ "copy" เข้าไฟล์อื่น ---
const xml2 = readDocxXml(DOCX2);
const xml3 = readDocxXml(DOCX3);
const L2 = landmarksFor(xml2, (x) => x.lastIndexOf('</w:tbl>') + '</w:tbl>'.length);
const L3 = landmarksFor(xml3, (x) => x.lastIndexOf('</w:tbl>') + '</w:tbl>'.length);

const guarantorTextSeg = xml2.slice(L2.P1, L2.P2); // หนังสือค้ำประกัน + ลายเซ็น (ไม่รวมรูปลูกค้า)
const guarantorPhotoSeg = xml2.slice(L2.P3, L2.P4); // รูปบัตรผู้ค้ำ (ไม่รวมรูปลูกค้า)
const guardianTextSeg = xml3.slice(L3.P1, L3.P2);
const guardianPhotoSeg = xml3.slice(L3.P3, L3.P4);

console.log('ขนาด segment ที่ copy มา (ตัวอักษร): guarantorText', guarantorTextSeg.length, 'guarantorPhoto', guarantorPhotoSeg.length,
  'guardianText', guardianTextSeg.length, 'guardianPhoto', guardianPhotoSeg.length);

function wrap(tag, segXml) {
  return marker('{#' + tag + '}') + segXml + marker('{/' + tag + '}');
}

// ---------- Master A: แผนผ่อน (ใช้ xml2 เป็นฐาน มี guarantor เดิมอยู่แล้ว, เติม guardian เพิ่ม) ----------
function buildInstallmentMaster() {
  let out = xml2;
  // แทรกจากท้ายไปหน้าเสมอ กัน offset เพี้ยน
  // 1) หุ้ม guarantor เดิม (2 จุด) ด้วย marker (เหมือน build_and_verify_docx2.js ที่ผ่านแล้ว)
  out = out.slice(0, L2.P4) + marker('{/hasGuarantor}') + out.slice(L2.P4);
  out = out.slice(0, L2.P3) + marker('{#hasGuarantor}') + out.slice(L2.P3);
  out = out.slice(0, L2.P2) + marker('{/hasGuarantor}') + out.slice(L2.P2);
  out = out.slice(0, L2.P1) + marker('{#hasGuarantor}') + out.slice(L2.P1);
  // 2) แทรก guardian ใหม่ (copy จาก docx3) ไว้ท้ายสุดก่อน sectPr (offset L2.P4 เดิมยังไม่เพี้ยนเพราะเราแทรกก่อนหน้ามันมาแล้วในตัวแปร out
  //    ต้องคำนวณตำแหน่งใหม่ = หา sectPr ล่าสุดใน out อีกที ปลอดภัยกว่าคำนวณ offset เอง)
  const insertAt = out.lastIndexOf('<w:sectPr');
  const guardianBlock = wrap('hasGuardian', guardianTextSeg) + wrap('hasGuardian', guardianPhotoSeg);
  out = out.slice(0, insertAt) + guardianBlock + out.slice(insertAt);
  return out;
}

// ---------- Master B: แผนวางดาวน์ (ใช้ xml1 เป็นฐาน ไม่มี guarantor/guardian เลย ต้อง copy เข้าไปทั้งคู่) ----------
function buildDownpaymentMaster() {
  const xml1 = readDocxXml(DOCX1);
  const insertAt = xml1.lastIndexOf('<w:sectPr');
  const block = wrap('hasGuarantor', guarantorTextSeg) + wrap('hasGuarantor', guarantorPhotoSeg) +
    wrap('hasGuardian', guardianTextSeg) + wrap('hasGuardian', guardianPhotoSeg);
  return xml1.slice(0, insertAt) + block + xml1.slice(insertAt);
}

const installmentMasterXml = buildInstallmentMaster();
const downpaymentMasterXml = buildDownpaymentMaster();

function saveDocx(origPath, newXml, outPath) {
  const zip = new PizZip(fs.readFileSync(origPath, 'binary'));
  zip.file('word/document.xml', newXml);
  fs.writeFileSync(outPath, zip.generate({ type: 'nodebuffer' }));
}
saveDocx(DOCX2, installmentMasterXml, path.join(base, 'master-installment.docx'));
saveDocx(DOCX1, downpaymentMasterXml, path.join(base, 'master-downpayment.docx'));
console.log('บันทึกไฟล์ master ทั้ง 2 แล้ว');

module.exports = {}; // เผื่อไฟล์ verify เรียกใช้ path ต่อ
