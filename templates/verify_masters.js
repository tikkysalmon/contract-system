const fs = require('fs');
const PizZip = require('C:/Users/user/OneDrive/Desktop/AI/claude code/15_ระบบทำสัญญา/webapp/node_modules/pizzip');
const Docxtemplater = require('C:/Users/user/OneDrive/Desktop/AI/claude code/15_ระบบทำสัญญา/webapp/node_modules/docxtemplater');

const DOCX1 = 'C:/Users/user/OneDrive/Desktop/AI/claude code/15_ระบบทำสัญญา/สัญญาเช่าซื้อวางดาวน์ (Revise 26.05.2026).docx';
const DOCX2 = 'C:/Users/user/OneDrive/Desktop/AI/claude code/15_ระบบทำสัญญา/สัญญาเช่าซื้อ+หนังสือค้ำประกัน (Revise 26.05.2026).docx';
const DOCX3 = 'C:/Users/user/OneDrive/Desktop/AI/claude code/15_ระบบทำสัญญา/สัญญาเช่าซื้อ+หนังสือรับรอง (Revise 26.05.2026).docx';
const MASTER_INSTALLMENT = __dirname + '/master-installment.docx';
const MASTER_DOWNPAYMENT = __dirname + '/master-downpayment.docx';

const IMAGE_INNER = '} {#$isImage} {%src} {/} {#!$isImage} {$fileName} {/} {/';
function stripImg(x) { return x.split(IMAGE_INNER).join('} [IMAGE] {/'); }
function stripTags(t) { return t.replace(/<[^>]+>/g, ''); }

const BASE_DATA = {
  'วันที่ที่ออกสัญญา': 'x', 'เลขที่สัญญา': 'x', 'คำนำหน้า': 'x', 'ชื่อ_นามสกุลลูกค้า': 'x', 'อายุลูกค้า': 'x',
  'เลขบัตรประชาชน': 'x', 'เบอร์ติดต่อ': 'x', 'รายการสินค้า': 'x', 'สีสินค้า': 'x',
  'ราคาเครื่องเต็ม__ผ่อน_': 'x', '_ราคาเครื่องเต็ม_ภาษาไทย__ผ่อน_': 'x',
  'ยอดที่ชำระไว้ทั้งสิ้น__ผ่อน_': 'x', '_ยอดที่ชำระไว้ทั้งสิ้น_ภาษาไทย__ผ่อน_': 'x',
  'ยอดคงเหลือที่ต้องชำระ__ผ่อน_': 'x', 'ยอดคงเหลือที่ต้องชำระภาษาไทย__ผ่อน_': 'x',
  'ระยะเวลาผ่อน__ผ่อน_': 'x', 'วันที่เริ่มส่งยอด': 'x', 'วันสุดท้ายที่ส่งยอด': 'x', '_ชำระทุกวันที่': 'x',
  'ชื่อบุคคลที่ติดต่อได้คนที่หนึ่ง': 'x', 'เบอร์ติดต่อบุคคลอ้างอิงที่1': 'x', 'ความเกี่ยวข้อง1': 'x',
  // down payment เฉพาะ
  'ราคา__ดาวน์_': 'x', 'ราคา__ดาวน์__ภาษาไทย': 'x', 'ระยะเวลาผ่อน__ดาวน์_': 'x',
  'ราคาผ่อนต่องวด__ดาวน์_': 'x', 'ราคาผ่อนต่องวด__ดาวน์__ภาษาไทย': 'x', 'ราคาสุทธิ์__ดาวน์_': 'x',
  'ยอดคงเหลือที่ต้องชำระ__ดาวน์_': 'x',
  // guarantor / guardian
  'คำนำหน้าผู้ค้ำ': 'x', 'ชื่อ_นามสกุล_ผู้ค้ำประกัน': 'x', 'เบอร์ติดต่อ_ผู้ค้ำ': 'x',
  'คำนำหน้า_ผู้ปกครอง': 'x', 'ชื่อ_นามสกุล_ผู้ปกครอง': 'x', 'เบอร์ติดต่อ_ผู้ปกครอง': 'x',
  'รูปถ่ายบัตรประชาชน': true, 'รูปถ่ายคู่บัตรประชาชน': true,
  'ไฟล์_บัตรประชาชนผู้ค้ำ': true, 'รูปภาพสำเนาบัตรประชาชน_ผู้ปกครอง': true,
};
for (let i = 1; i <= 12; i++) { BASE_DATA['งวดที่_' + i] = 'x'; BASE_DATA['ยอดผ่อน_' + i] = 'x'; }

function render(docxPath, extra) {
  const zip = new PizZip(fs.readFileSync(docxPath, 'binary'));
  const cleaned = stripImg(zip.file('word/document.xml').asText());
  zip.file('word/document.xml', cleaned);
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
  doc.render(Object.assign({}, BASE_DATA, extra || {}));
  return stripTags(doc.getZip().file('word/document.xml').asText());
}

function check(label, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' - ' + label);
  return cond;
}

let allPass = true;

console.log('\n########## MASTER-INSTALLMENT (แผนผ่อน ไม่มีดาวน์) ##########');
const orig2 = render(DOCX2, {});
const orig3 = render(DOCX3, {});

const mi_general = render(MASTER_INSTALLMENT, { hasGuarantor: false, hasGuardian: false });
const mi_guarantor = render(MASTER_INSTALLMENT, { hasGuarantor: true, hasGuardian: false });
const mi_guardian = render(MASTER_INSTALLMENT, { hasGuarantor: false, hasGuardian: true });

allPass &= check('ทั่วไป: ไม่มีทั้งค้ำและปกครอง, มีข้อ 1-10', mi_general.includes('ข้อที่ 1') && mi_general.includes('ข้อที่ 10') && !mi_general.includes('หนังสือสัญญาค้ำประกัน') && !mi_general.includes('หนังสือยินยอมผู้แทนโดยชอบธรรม'));
allPass &= check('ทั่วไป: จำนวน [IMAGE] = 2 (บัตร+เซลฟี่ลูกค้าเท่านั้น)', (mi_general.match(/\[IMAGE\]/g) || []).length === 2);
allPass &= check('ผู้ค้ำ: มี "หนังสือสัญญาค้ำประกัน" ไม่มี guardian', mi_guarantor.includes('หนังสือสัญญาค้ำประกัน') && !mi_guarantor.includes('หนังสือยินยอมผู้แทนโดยชอบธรรม'));
allPass &= check('ผู้ค้ำ: ตรงกับ render ต้นฉบับ docx2 เป๊ะ (ยกเว้น marker เอง)', mi_guarantor.replace(/\{[#/^]has(Guarantor|Guardian)\}/g, '') === orig2);
allPass &= check('ผู้ค้ำ: จำนวน [IMAGE] = 3', (mi_guarantor.match(/\[IMAGE\]/g) || []).length === 3);
allPass &= check('ผู้ปกครอง: มี "หนังสือยินยอมผู้แทนโดยชอบธรรม" ไม่มี guarantor', mi_guardian.includes('หนังสือยินยอมผู้แทนโดยชอบธรรม') && !mi_guardian.includes('หนังสือสัญญาค้ำประกัน'));
allPass &= check('ผู้ปกครอง (ของใหม่ที่ copy เข้ามา): เนื้อหาตรงกับต้นฉบับ docx3 ส่วนที่เกี่ยวข้องหรือไม่ (เทียบเฉพาะ substring หนังสือยินยอม)', (function () {
  const extract = (t) => { const i = t.indexOf('หนังสือยินยอมผู้แทนโดยชอบธรรม'); return t.slice(i, i + 500); };
  return extract(mi_guardian) === extract(orig3);
})());
allPass &= check('ผู้ปกครอง: จำนวน [IMAGE] = 3', (mi_guardian.match(/\[IMAGE\]/g) || []).length === 3);

console.log('\n########## MASTER-DOWNPAYMENT (แผนวางดาวน์) ##########');
const orig1 = render(DOCX1, {});
const md_general = render(MASTER_DOWNPAYMENT, { hasGuarantor: false, hasGuardian: false });
const md_guarantor = render(MASTER_DOWNPAYMENT, { hasGuarantor: true, hasGuardian: false });
const md_guardian = render(MASTER_DOWNPAYMENT, { hasGuarantor: false, hasGuardian: true });

allPass &= check('ทั่วไป: ตรงกับ render ต้นฉบับ docx1 เป๊ะ', md_general.replace(/\{[#/^]has(Guarantor|Guardian)\}/g, '') === orig1);
allPass &= check('ทั่วไป: จำนวน [IMAGE] = 2', (md_general.match(/\[IMAGE\]/g) || []).length === 2);
allPass &= check('ผู้ค้ำ (combo ใหม่ที่ไม่เคยมีไฟล์เดิม): มี "หนังสือสัญญาค้ำประกัน" + เนื้อหาวางดาวน์ครบ (ข้อ 2.1 ดาวน์)', md_guarantor.includes('หนังสือสัญญาค้ำประกัน') && md_guarantor.includes('วางดาวน์'));
allPass &= check('ผู้ค้ำ: จำนวน [IMAGE] = 3', (md_guarantor.match(/\[IMAGE\]/g) || []).length === 3);
allPass &= check('ผู้ปกครอง (combo ใหม่): มี "หนังสือยินยอมผู้แทนโดยชอบธรรม" + เนื้อหาวางดาวน์ครบ', md_guardian.includes('หนังสือยินยอมผู้แทนโดยชอบธรรม') && md_guardian.includes('วางดาวน์'));
allPass &= check('ผู้ปกครอง: จำนวน [IMAGE] = 3', (md_guardian.match(/\[IMAGE\]/g) || []).length === 3);

console.log('\n=== สรุป: ' + (allPass ? 'PASS ทั้งหมด' : 'มีบางจุด FAIL — ต้องแก้ก่อนใช้จริง') + ' ===');
