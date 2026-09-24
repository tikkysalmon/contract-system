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

// 2026-09-24 แก้บั๊กจริงที่ user เจอ: "หนังสือยินยอมผู้แทนโดยชอบธรรม" (guardian) หายไปจากสัญญาที่แสดงจริง
// (preview-contract.js) ทั้งที่มีอยู่ใน docx — ต้นเหตุคือโค้ดเดิมแทรก guardian block (ทั้งข้อความ+รูป) ไว้
// "ท้ายสุดก่อน sectPr" เสมอ ซึ่งอยู่ "หลัง" ส่วนรูปถ่ายบัตร ปชช./เซลฟี่ของลูกค้าเอง (ที่ต้องมีทุกเคสไม่ว่ามี
// guardian/guarantor หรือไม่) — แต่ preview-contract.js ตัดเนื้อหาทุกอย่างตั้งแต่ placeholder รูปแนบตัวแรกทิ้ง
// (เพราะฝั่ง client เป็นคนวาดรูปเอง ไม่ใช้ block พวกนี้) ทำให้ guardian block ที่อยู่หลังรูปโดนตัดทิ้งไปด้วยเสมอ
// (guarantor เคสแผนผ่อนรอดเพราะเนื้อหาข้อความอยู่ "ก่อน" รูปถ่ายของลูกค้าอยู่แล้วในไฟล์ต้นฉบับ แต่เคสแผนวางดาวน์
// ของ guarantor เองก็โดนบั๊กเดียวกันด้วย เพราะโค้ดเดิมแทรกไว้ท้ายสุดเหมือนกัน)
//
// แก้ให้ถูกต้องคือแทรกข้อความยินยอม/ค้ำประกันไว้ "ก่อน" ส่วนรูปถ่ายบัตร ปชช. ของลูกค้าเอง (ตำแหน่งเดียวกับที่
// guarantorTextSeg เคยอยู่ในไฟล์ต้นฉบับ xml2 จริงๆ) และแทรกรูปแนบของผู้ค้ำ/ผู้ปกครองไว้ "หลัง" ส่วนรูปเซลฟี่คู่
// บัตรของลูกค้าเอง (ตำแหน่งเดียวกับ guarantorPhotoSeg เดิม) — ใช้ helper เดียวกันนี้กับทั้ง 2 ไฟล์ master

// หาตำแหน่งเริ่มต้นของ "ส่วนรูปถ่ายบัตร ปชช. ของลูกค้าเอง" (ก่อนหัวข้อนี้ = จุดแทรกข้อความยินยอม/ค้ำประกัน)
function findOwnIdPhotoStart(xml) {
  return prevParaStart(xml, xml.indexOf('รูปถ่ายบัตรประชาชน'));
}
// หาตำแหน่งท้าย "ส่วนรูปถ่ายคู่บัตรของลูกค้าเอง" (หลังหัวข้อนี้ = จุดแทรกรูปแนบผู้ค้ำ/ผู้ปกครอง)
function findOwnSelfiePhotoEnd(xml) {
  const selfieOpen = xml.indexOf('รูปถ่ายคู่บัตรประชาชน');
  const selfieClose = xml.indexOf('รูปถ่ายคู่บัตรประชาชน', selfieOpen + 1);
  return nextParaStart(xml, selfieClose);
}

// ---------- Master A: แผนผ่อน (ใช้ xml2 เป็นฐาน มี guarantor เดิมอยู่แล้ว, เติม guardian เพิ่ม) ----------
function buildInstallmentMaster() {
  let out = xml2;
  // แทรกจากท้ายไปหน้าเสมอ กัน offset เพี้ยน
  // 1) หุ้ม guarantor เดิม (2 จุด) ด้วย marker (เหมือน build_and_verify_docx2.js ที่ผ่านแล้ว) — ตำแหน่งเดิม
  //    ของ guarantor ในไฟล์ต้นฉบับถูกต้องอยู่แล้ว (ข้อความก่อนรูปลูกค้า, รูปผู้ค้ำหลังรูปลูกค้า) ไม่ต้องย้าย
  out = out.slice(0, L2.P4) + marker('{/hasGuarantor}') + out.slice(L2.P4);
  out = out.slice(0, L2.P3) + marker('{#hasGuarantor}') + out.slice(L2.P3);
  out = out.slice(0, L2.P2) + marker('{/hasGuarantor}') + out.slice(L2.P2);
  out = out.slice(0, L2.P1) + marker('{#hasGuarantor}') + out.slice(L2.P1);

  // 2) แทรกข้อความยินยอมผู้ปกครอง (copy จาก docx3) ไว้ "ก่อน" ส่วนรูปถ่ายบัตร ปชช. ของลูกค้าเอง (คำนวณตำแหน่ง
  //    ใหม่จาก out ล่าสุดเสมอ ไม่อิง offset เดิมของ L2 ที่เพี้ยนไปแล้วหลังแทรก marker guarantor ด้านบน)
  const textInsertAt = findOwnIdPhotoStart(out);
  out = out.slice(0, textInsertAt) + wrap('hasGuardian', guardianTextSeg) + out.slice(textInsertAt);

  // 3) แทรกรูปแนบบัตร ปชช. ผู้ปกครอง ไว้ "หลัง" ส่วนรูปเซลฟี่คู่บัตรของลูกค้าเอง (คำนวณตำแหน่งใหม่อีกครั้งจาก
  //    out หลังขั้นตอน 2 เพราะการแทรกข้อความด้านบนเลื่อน offset ของทุกอย่างหลังจากนั้นไปแล้ว)
  const photoInsertAt = findOwnSelfiePhotoEnd(out);
  out = out.slice(0, photoInsertAt) + wrap('hasGuardian', guardianPhotoSeg) + out.slice(photoInsertAt);

  return out;
}

// ---------- Master B: แผนวางดาวน์ (ใช้ xml1 เป็นฐาน ไม่มี guarantor/guardian เลย ต้อง copy เข้าไปทั้งคู่) ----------
function buildDownpaymentMaster() {
  let out = readDocxXml(DOCX1);

  // แทรกข้อความค้ำประกัน+ยินยอมผู้ปกครอง ไว้ "ก่อน" รูปถ่ายบัตร ปชช. ของลูกค้าเอง (ตำแหน่งเดียวกับแผนผ่อนด้านบน)
  const textInsertAt = findOwnIdPhotoStart(out);
  const textBlock = wrap('hasGuarantor', guarantorTextSeg) + wrap('hasGuardian', guardianTextSeg);
  out = out.slice(0, textInsertAt) + textBlock + out.slice(textInsertAt);

  // แทรกรูปแนบผู้ค้ำ/ผู้ปกครอง ไว้ "หลัง" รูปเซลฟี่คู่บัตรของลูกค้าเอง (คำนวณตำแหน่งใหม่จาก out หลังขั้นตอนบน)
  const photoInsertAt = findOwnSelfiePhotoEnd(out);
  const photoBlock = wrap('hasGuarantor', guarantorPhotoSeg) + wrap('hasGuardian', guardianPhotoSeg);
  out = out.slice(0, photoInsertAt) + photoBlock + out.slice(photoInsertAt);

  return out;
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
