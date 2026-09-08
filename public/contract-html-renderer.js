// เรนเดอร์สัญญาเป็น PDF ฝั่ง browser — เทคนิคเดียวกับ debt-tracker's หนังสือบอกเลิกสัญญา: สร้าง HTML ของ
// สัญญาเอง (จาก block ย่อหน้า/ตารางที่ server แยกมาจาก docx จริง) แล้วถ่ายภาพด้วย html2canvas ฝังลง PDF
// ด้วย jsPDF (2026-09-04)
//
// รอบนี้ (2026-09-04) เปลี่ยนจาก "div สูงต่อเนื่อง 1 ก้อน สไลซ์ตามพิกเซล" เป็น "แบ่งหน้าจริงตั้งแต่ต้น" —
// แต่ละหน้าเป็น div ขนาด A4 ของตัวเอง มีหัวจดหมาย (letterhead) ซ้ำทุกหน้า, กั้นขอบกระดาษเป็นระยะที่อ่านง่าย,
// วัดความสูงเนื้อหาจริงด้วย DOM แล้วจัดเรียงลงหน้าอัตโนมัติ (ตัดหน้าใหม่เมื่อเนื้อหาจะล้น หรือ block ไหน
// ระบุ pageBreakBefore มา เช่น ตารางผ่อนชำระ) ถ่ายภาพทีละหน้าแล้วต่อเป็น PDF หลายหน้า (เดิมสไลซ์ภาพเดียวยาว
// ทำให้หัวจดหมายโผล่แค่หน้าแรกหน้าเดียว — user ขอให้มีทุกหน้าเหมือนระบบติดตามหนี้) — ยังคง "ไม่แปลง .docx ->
// PDF จริง" (ฟรี ไม่ต้องสมัคร/ขอ API key คุมหน้าตาได้เองทั้งหมด เป็นแพทเทิร์นเดียวกับ debt-tracker)
//
// ใช้: renderContractPdf(blocks, meta) -> Promise<Blob>
//   blocks: [{type:'paragraph', runs:[{text,bold,color,underline}], text} | {type:'table', header, rows, pageBreakBefore}]
//   meta: { title, letterheadDataUrl, customer, contractDate, hasGuardian, hasGuarantor }
//     customer (เหมือน sign.js's state.data): { title, firstLastName, files:{idCard,selfieWithId,guardianId,
//       guarantorId}, guardian:{title,firstLastName}, guarantor:{title,firstLastName} } — ไม่บังคับ (ถ้าไม่มี
//       ไฟล์แนบก็แค่ข้ามหน้ารูปนั้นไป เช่นตอน CS ดูตัวอย่างก่อนลูกค้ากรอกฟอร์ม)
// ต้องโหลด html2canvas + jsPDF (CDN, ดู sign.html/app.html) + validation.js (isoToDDMMYYYY) ก่อนไฟล์นี้

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---------- ค่าคงที่หน้ากระดาษ A4 (2026-09-04) ----------
var PAGE_W = 794;   // 210mm ที่ ~96dpi (สอดคล้องกับที่ใช้เดิมทั้งระบบ)
var PAGE_H = 1123;  // 297mm
var MARGIN_X = 72;  // ~19mm ซ้าย-ขวา
// 2026-09-08 user ขอ: หัวกระดาษ (letterhead) ขยับขึ้น + ขอบบน-ล่างให้เท่ากัน (เดิม 88/70 บนมากกว่าล่างจน
// ดูไม่สมดุล) — ลดเหลือ 50px (~13mm) เท่ากันทั้งสองด้าน
var MARGIN_TOP = 50;
var MARGIN_BOTTOM = 50;
var CONTENT_W = PAGE_W - MARGIN_X * 2;
var BODY_FONT = "'Sarabun','Noto Sans Thai','Leelawadee UI',sans-serif";

// หัวฟอร์มบริษัทไฟล์จริง (2026-09-06 user ส่งไฟล์ "หัวฟอร์มบริษัท (อัพเดท).jpg" มาให้ใช้แทนโลโก้ที่เคยวาดเอง
// ด้วย SVG) ใช้เป็นค่าเริ่มต้นเสมอถ้ายังไม่ได้อัปโหลดหัวจดหมายเอง (custom) ผ่านเมนู "อัพโหลดข้อมูล > ตั้งค่า
// หัวจดหมาย" — ถ้าอัปโหลดเองไว้ (meta.letterheadDataUrl) ให้ใช้ตัวนั้นแทน
var DEFAULT_LETTERHEAD_URL = 'assets/letterhead-default.jpg';

function headerHtml(meta) {
  var src = meta.letterheadDataUrl || DEFAULT_LETTERHEAD_URL;
  return '<img src="' + src + '" style="width:100%; display:block; margin-bottom:14px;" />';
}

// ---------- ย่อหน้า/ตาราง จาก docx blocks (รักษาตัวหนา/สีที่มีอยู่จริงในเทมเพลต — 2026-09-04) ----------
function runsHtml(runs, plainText) {
  if (!runs || !runs.length) return escHtml(plainText);
  return runs.map(function (r) {
    var style = '';
    if (r.bold) style += 'font-weight:700;';
    if (r.color) style += 'color:' + r.color + ';';
    if (r.underline) style += 'text-decoration:underline;';
    var text = escHtml(r.text).replace(/\t/g, '&emsp;');
    return style ? '<span style="' + style + '">' + text + '</span>' : text;
  }).join('');
}

// บรรทัด "field : value" สั้นๆ ในหน้าตารางผ่อน (เช่น "วันที่ทำสัญญา : ...") ให้ชิดซ้ายไม่ย่อหน้า/ไม่จัดขอบ —
// ต่างจากย่อหน้าเนื้อหาสัญญาปกติที่ย่อหน้าแรก+จัดขอบสองข้างแบบเอกสารทางการ
function isFieldLine(text) {
  return text.indexOf(' : ') !== -1 && text.length < 90;
}

// หัวข้อ "ตารางแสดงภาระหนี้ตามสัญญาเช่าซื้อ" — จัดกลางหน้ากระดาษ (2026-09-08 user ขอ)
function isDebtTableHeading(text) {
  return text.indexOf('ตารางแสดงภาระหนี้') === 0;
}

// หัวข้อประเภทสัญญา "สัญญาเช่าซื้อแบบผ่อนชำระ(วางดาวน์/เครดิตผ่าน)" — จัดกลางหน้ากระดาษเหมือนกัน (2026-09-08
// user ขอ) ส่วน "ทำสัญญาวันที่ ..." / "เลขที่สัญญา ..." ต่อจากหัวข้อนี้ ให้เยื้องไปทางขวาแทน
function isContractTitleHeading(text) {
  return text.indexOf('สัญญาเช่าซื้อแบบผ่อนชำระ') === 0;
}
function isContractMetaLine(text) {
  return text.indexOf('ทำสัญญาวันที่') === 0 || text.indexOf('เลขที่สัญญา') === 0;
}

// 2026-09-08 user ขอ "ปรับข้อความในตารางแสดงภาระหนี้ให้ดูสวยงาม" — ต้นฉบับ .docx ใช้ w:tab (คนละจำนวนต่อ
// บรรทัด) จัดตำแหน่งคอลัมน์แบบ tab-stop ของ Word ซึ่งพอมาเรนเดอร์บนความกว้างกระดาษของเราเองแล้วช่องว่างจะ
// เพี้ยนไม่เท่ากันแต่ละบรรทัด (ยิ่งข้อความสั้น/ยาวต่างกัน ยิ่งเห็นชัด) — ตัดปัญหานี้โดยแยกแต่ละคู่ "label :
// value" ที่คั่นด้วย tab ออกเป็นชิ้นๆ แล้วจัดเรียงด้วย flex gap คงที่แทน ระยะห่างจะสม่ำเสมอทุกบรรทัด
function fieldLineHtml(block) {
  var segments = block.text.split('\t').map(function (s) { return s.trim(); }).filter(Boolean);
  if (segments.length <= 1) {
    return '<p style="margin:0 0 8px; text-align:left;">' + runsHtml(block.runs, block.text) + '</p>';
  }
  return '<div style="display:flex; flex-wrap:wrap; gap:6px 32px; margin:0 0 8px;">' +
    segments.map(function (seg) { return '<span>' + escHtml(seg) + '</span>'; }).join('') +
    '</div>';
}

// ข้อย่อยแบบ "N.N" (เช่น "4.1 ... 4.2 ... 4.3 ... 4.4") ที่บางข้อในต้นฉบับ .docx ไม่ได้ขึ้นย่อหน้าใหม่จริง
// ระหว่างข้อย่อย (ต่างจากข้อ 5.1/5.2 ที่ขึ้นย่อหน้าใหม่มาให้แล้วปกติ) ทำให้เนื้อหาไหลติดกันเป็นพรืดอ่านยาก
// (2026-09-08 user ชี้ที่ "ข้อที่ 4 การดูแลรักษาทรัพย์สิน") — แยกเป็นย่อหน้าใหม่ต่อข้อย่อยให้อ่านง่ายขึ้น
// กัน false positive จากการอ้างอิงข้ามข้อกลางประโยค (เช่น "...ทราบทันทีเมื่อเกิดกรณีตามข้อ 4.3 และต้องชด...")
// ที่ไม่ใช่จุดเริ่มข้อย่อยจริง ด้วยการเช็คว่าก่อนเลขนั้นมีคำว่า "ข้อ" นำหน้าอยู่ไหม ถ้ามีให้ข้ามไปไม่ตัด — ทำงาน
// เฉพาะย่อหน้าที่เจอจุดเริ่มข้อย่อยแบบนี้ตั้งแต่ 2 จุดขึ้นไปเท่านั้น (ย่อหน้าปกติที่มีแค่ตัวเลขทศนิยม/ราคา
// ปนอยู่ 1 จุดไม่โดนผลกระทบ) — ⚠️ ตัดสูญเสียการจัดรูปแบบตัวหนา/สีของ runs เดิมไปหลัง split (ใช้ escHtml ข้อความ
// ล้วนแทน) ยอมรับได้เพราะเนื้อหาข้อย่อยกลุ่มนี้เป็นข้อความล้วนไม่มีตัวหนากลางประโยคอยู่แล้ว
function splitEmbeddedSubclauses(text) {
  var markerRe = /\s(\d{1,2}\.\d{1,2})\s+(?=\S)/g;
  var matches = [];
  var m;
  while ((m = markerRe.exec(text)) !== null) {
    var before = text.slice(Math.max(0, m.index - 8), m.index);
    if (before.indexOf('ข้อ') !== -1) continue; // "...ตามข้อ 4.3..." เป็นการอ้างอิง ไม่ใช่จุดเริ่มข้อย่อยจริง
    matches.push(m);
  }
  if (matches.length < 2) return null;
  var parts = [];
  var cursor = 0;
  matches.forEach(function (mm) {
    var seg = text.slice(cursor, mm.index).trim();
    if (seg) parts.push(seg);
    cursor = mm.index;
  });
  var tail = text.slice(cursor).trim();
  if (tail) parts.push(tail);
  return parts.length >= 2 ? parts : null;
}

function paragraphHtml(block) {
  if (isDebtTableHeading(block.text) || isContractTitleHeading(block.text)) {
    return '<p style="margin:0 0 10px; text-align:center; font-weight:700;">' + runsHtml(block.runs, block.text) + '</p>';
  }
  if (isContractMetaLine(block.text)) {
    return '<p style="margin:0 0 8px; text-align:right;">' + runsHtml(block.runs, block.text) + '</p>';
  }
  if (isFieldLine(block.text)) {
    return fieldLineHtml(block);
  }
  var subParts = splitEmbeddedSubclauses(block.text);
  if (subParts) {
    return subParts.map(function (p) {
      return '<p style="margin:0 0 10px; text-align:justify; text-indent:1.8em;">' + escHtml(p) + '</p>';
    }).join('');
  }
  return '<p style="margin:0 0 10px; text-align:justify; text-indent:1.8em;">' + runsHtml(block.runs, block.text) + '</p>';
}

function tableHtml(block) {
  var theadHtml = '<tr>' + block.header.map(function (h) {
    return '<th style="border:1px solid #999;padding:7px 8px;background:#f2f2f2;font-size:12px;">' + escHtml(h) + '</th>';
  }).join('') + '</tr>';
  var rowsHtml = block.rows.map(function (row) {
    return '<tr>' + row.map(function (cell) {
      return '<td style="border:1px solid #999;padding:6px 8px;font-size:12px;text-align:center;">' + escHtml(cell) + '</td>';
    }).join('') + '</tr>';
  }).join('');
  return '<table style="width:100%;border-collapse:collapse;margin:6px 0 16px;">' + theadHtml + rowsHtml + '</table>';
}

function blockHtml(block) {
  return block.type === 'table' ? tableHtml(block) : paragraphHtml(block);
}

// ---------- บล็อกลายเซ็น (สร้างเองจากข้อมูลลูกค้าจริง — ไม่พึ่งข้อความลายเซ็นลอยที่ดึงมาจาก docx เพราะ
// ตำแหน่งเพี้ยน ดูเหตุผลใน docx-blocks.js) ตอน "อ่านสัญญาก่อนเซ็น" (sign.js) / "ดูตัวอย่างก่อนลูกค้ากรอกฟอร์ม"
// (contracts-tab.js) ยังไม่มีรูปลายเซ็นจริงให้ใช้เลยเว้นช่องว่างเหมือนเดิม — แต่ถ้ามี signatureUrl ส่งมาจริง
// (2026-09-06, ตอนพนักงานกด "ดาวน์โหลดสัญญา" ตรวจเอกสารที่ลูกค้าเซ็นส่งกลับมาแล้ว) ให้ฝังรูปลายเซ็นจริงแทน
// ช่องว่าง เพื่อให้พนักงานตรวจสอบเอกสารฉบับจริงได้ครบ ไม่ใช่ฉบับร่างเปล่าๆ ----------
function signatureLineHtml(label, name, signatureUrl) {
  return '<div style="text-align:center; width:46%;">' +
    (signatureUrl
      ? '<img src="' + signatureUrl + '" style="height:44px;max-width:100%;object-fit:contain;display:block;margin:0 auto;" />'
      : '<div style="height:34px;"></div>') +
    '<div style="font-size:12.5px;">ลายเซ็น .............................................. ' + escHtml(label) + '</div>' +
    '<div style="font-size:12.5px;">(' + escHtml(name) + ')</div>' +
    '</div>';
}

function signatureBlockHtml(meta) {
  var c = meta.customer || {};
  var files = c.files || {};
  var staffSig = meta.staffSignature || {};
  // ชื่อกำกับฝั่งพนักงานใช้ป้ายแผนกคงที่เสมอ (2026-09-06 user ยืนยัน — ไม่ต้องขึ้นชื่อจริง/username ของคนเซ็น)
  var html = '<div style="display:flex; justify-content:space-between; margin-top:22px;">' +
    signatureLineHtml('ผู้เช่าซื้อ', ((c.title || '') + (c.firstLastName || '')) || '-', files.signature) +
    signatureLineHtml('ผู้แทนผู้ให้เช่าซื้อ', 'พนักงานฝ่ายบัญชีหนี้สิน บจก. แซลม่อน เอ็นเตอร์ไพรส์', staffSig.url) +
    '</div>';
  if (meta.hasGuardian && c.guardian && c.guardian.firstLastName) {
    html += '<div style="display:flex; justify-content:center; margin-top:16px;">' +
      signatureLineHtml('ผู้ให้ความยินยอม (ผู้ปกครอง)', (c.guardian.title || '') + c.guardian.firstLastName, files.guardianSignature) +
      '</div>';
  }
  if (meta.hasGuarantor && c.guarantor && c.guarantor.firstLastName) {
    html += '<div style="display:flex; justify-content:center; margin-top:16px;">' +
      signatureLineHtml('ผู้ค้ำประกัน', (c.guarantor.title || '') + c.guarantor.firstLastName, files.guarantorSignature) +
      '</div>';
  }
  return html;
}

// ---------- หน้ารูปแนบ (2026-09-04 user ขอ "แนบรูปทั้งหมด") — รูปบัตรประชาชนทุกใบ (ลูกค้า/ผู้ปกครอง/ผู้ค้ำ)
// มีตรา "สำเนาถูกต้อง" + ช่องเซ็นว่างกำกับ เหมือนไฟล์ตัวอย่างจริงที่ user ส่งมา ส่วนรูปคู่บัตรไม่มีตรานี้ ----------
function certBlockHtml(personLabel, name, contractDateText, signatureUrl) {
  return '<div style="text-align:center; margin-top:18px;">' +
    '<div style="font-weight:700; font-size:14px; margin-bottom:4px;">สำเนาถูกต้อง</div>' +
    '<div style="color:#dc2626; font-size:12px; text-decoration:underline; margin-bottom:16px;">เอกสารฉบับนี้ใช้สำหรับผ่อนสินค้ากับบจก.แซลม่อน เอ็นเตอร์ไพรส์เท่านั้น</div>' +
    (signatureUrl
      ? '<img src="' + signatureUrl + '" style="height:44px;max-width:220px;object-fit:contain;display:block;margin:0 auto;" />'
      : '<div style="height:34px;"></div>') +
    '<div style="font-size:12.5px;">ลายเซ็น .............................................. ' + escHtml(personLabel) + '</div>' +
    '<div style="font-size:12.5px;">(' + escHtml(name) + ')</div>' +
    '<div style="font-size:12.5px;">' + escHtml(contractDateText) + '</div>' +
    '</div>';
}

function photoPageHtml(meta, dataUrl, opts) {
  return headerHtml(meta) +
    '<div style="text-align:center; margin-top:16px;">' +
    '<img src="' + dataUrl + '" style="max-width:75%; max-height:440px; object-fit:contain; border:1px solid #ddd;" />' +
    '</div>' +
    (opts.withCert ? certBlockHtml(opts.personLabel, opts.personName, meta.contractDateText, opts.signatureUrl) : '');
}

// รูปที่ต้องแนบ เรียงตามลำดับ: บัตร ปชช. ลูกค้า(มีตรา+ลายเซ็นจุดที่ 2 ของลูกค้า) -> คู่บัตร ลูกค้า(ไม่มีตรา) ->
// บัตร ปชช. ผู้ปกครอง/ผู้ค้ำถ้ามี(มีตรา) — ข้ามรูปที่ยังไม่มี (เช่น CS ดูตัวอย่างก่อนลูกค้ากรอกฟอร์ม ยังไม่มีไฟล์
// เลยสักใบ) — ลายเซ็นใต้รูปสำเนาบัตรนี้เป็นจุดที่ 2 ของลูกค้า/ผู้ปกครอง/ผู้ค้ำแต่ละคน (จุดที่ 1 อยู่ท้าย
// ข้อมูลบุคคลอ้างอิง ดู signatureBlockHtml + paginateBodyBlocks — 2026-09-06 user ยืนยัน "ลายเซ็นลูกค้าต้องมี 2 จุด")
function buildPhotoPagesHtml(meta) {
  var c = meta.customer || {};
  var files = c.files || {};
  var pages = [];
  var customerName = ((c.title || '') + (c.firstLastName || '')) || '-';
  if (files.idCard) pages.push(photoPageHtml(meta, files.idCard, { withCert: true, personLabel: 'ผู้เช่าซื้อ', personName: customerName, signatureUrl: files.signature }));
  if (files.selfieWithId) pages.push(photoPageHtml(meta, files.selfieWithId, { withCert: false }));
  if (meta.hasGuardian && files.guardianId) {
    var guardianName = c.guardian ? ((c.guardian.title || '') + (c.guardian.firstLastName || '')) : '-';
    pages.push(photoPageHtml(meta, files.guardianId, { withCert: true, personLabel: 'ผู้ให้ความยินยอม (ผู้ปกครอง)', personName: guardianName, signatureUrl: files.guardianSignature }));
  }
  if (meta.hasGuarantor && files.guarantorId) {
    var guarantorName = c.guarantor ? ((c.guarantor.title || '') + (c.guarantor.firstLastName || '')) : '-';
    pages.push(photoPageHtml(meta, files.guarantorId, { withCert: true, personLabel: 'ผู้ค้ำประกัน', personName: guarantorName, signatureUrl: files.guarantorSignature }));
  }
  return pages;
}

// ---------- วัดความสูงเนื้อหาจริง แล้วจัดเรียงลงหน้า A4 (2026-09-04) ----------
// สร้าง div วัดผลนอกจอ ความกว้างเท่าเนื้อหาจริงเป๊ะ ใส่ item ทีละอันแล้วอ่าน getBoundingClientRect — เป็น
// ข้อความ/ตารางล้วน ไม่มีรูปภาพ (รูปภาพอยู่ในหน้าที่แยกไปแล้วข้างบน ไม่ต้องกังวลเรื่อง <img> โหลดไม่ทันตอนวัด)
// 2026-09-08 แก้บั๊กจริงที่ user เจอ (ข้อความล้นตกขอบล่าง โดน overflow:hidden ของ pageDivHtml ตัดหาย): เดิม
// ห่อแต่ละ block ด้วย <div> แยกกันแล้วอ่าน .getBoundingClientRect().height ของ wrap แต่ละอัน — margin-bottom
// ของ <p>/<div> ข้างในที่ไม่มีอะไรตามหลังภายใน wrap เดียวกัน "escape" ทะลุ wrap เปล่าๆ (ไม่มี border/padding
// กันไว้ ไม่ใช่ block formatting context) ทำให้ความสูงที่วัดได้ "ขาด" ไปเท่ากับ margin-bottom ของ block นั้น
// ทุกครั้ง สะสมหลายสิบ block เข้าก็คลาดเคลื่อนไปหลายร้อยพิกเซล ทำให้จัดหน้าแน่นเกินจริง เนื้อหาจึงล้นพ้นขอบล่าง
// จริงตอน render — แก้โดยแทรก marker (div สูง 0 ไม่มี margin) คั่นระหว่างแต่ละ block แทน แล้ววัดตำแหน่งจริงของ
// marker ในโครงสร้าง DOM เดียวกับที่จะ render จริง (block ทุกตัวในไฟล์นี้ไม่มี margin-top เลย มีแต่ margin-
// bottom จึงแทรก marker คั่นได้โดยไม่กระทบระยะห่างที่วัดได้แม้แต่พิกเซลเดียว — ดู CSS margin collapsing)
function measureHeights(htmls) {
  var measurer = document.createElement('div');
  measurer.style.cssText = 'position:fixed; left:-99999px; top:0; width:' + CONTENT_W + 'px; ' +
    'font-family:' + BODY_FONT + '; font-size:13.5px; line-height:1.55; color:#1c1b19;';
  measurer.innerHTML = htmls.map(function (html, i) {
    return html + '<div class="pgmk" data-i="' + i + '"></div>';
  }).join('');
  document.body.appendChild(measurer);
  var markers = measurer.querySelectorAll('.pgmk');
  var measurerTop = measurer.getBoundingClientRect().top;
  var heights = [];
  var prevBottom = 0;
  for (var i = 0; i < markers.length; i++) {
    var top = markers[i].getBoundingClientRect().top - measurerTop;
    heights.push(top - prevBottom);
    prevBottom = top;
  }
  measurer.remove();
  return heights;
}

function measureHeaderHeight(meta) {
  // ประมาณความสูงหัวจดหมายแบบไม่มีรูป (กรณีมี letterheadDataUrl จะวัดจริงหลังรูปโหลดแล้วอีกที ดู renderContractPdf)
  if (meta.letterheadDataUrl) return null; // คืน null แปลว่า "ยังไม่รู้ ต้องวัดหลังรูปโหลด"
  var heights = measureHeights([headerHtml(meta)]);
  return heights[0];
}

// จัดเนื้อหา (ย่อหน้า/ตาราง/บล็อกลายเซ็น) ลงหน้า A4 — ตัดหน้าใหม่เมื่อ pageBreakBefore หรือเนื้อหาจะล้น
function paginateBodyBlocks(blocks, meta, headerH) {
  var maxContentH = PAGE_H - MARGIN_TOP - MARGIN_BOTTOM - headerH;

  // แทรกบล็อกลายเซ็นต่อจากข้อมูลบุคคลอ้างอิง (2026-09-06 user ยืนยัน — ตรงตำแหน่งเดิมในต้นฉบับ .docx จริง ที่
  // เดิมเป็น textbox ลอยของ "ลายเซ็นผู้เช่าซื้อ"/"ลายเซ็นผู้แทนผู้ให้เช่าซื้อ" ต่อจากบรรทัด "ชื่อ/เบอร์/ความ
  // เกี่ยวข้อง" ของบุคคลอ้างอิงพอดี — docx-blocks.js ตัด textbox ลอยพวกนี้ทิ้งไปแล้ว (ตำแหน่งเพี้ยนตอนแยก block)
  // จึงต้องหาตำแหน่งจากหัวข้อ "บุคคลที่ร้านสามารถติดต่อได้เพื่อทวงถามหนี้" + บรรทัดข้อมูลถัดมาอีก 1 บรรทัดแทน)
  // ถ้าหาหัวข้อนี้ไม่เจอ (เทมเพลตเปลี่ยนไป) fallback กลับไปแทรกก่อนตารางผ่อนเหมือนเดิม
  var refHeadingIdx = blocks.findIndex(function (b) {
    return b.type === 'paragraph' && b.text.indexOf('บุคคลที่ร้านสามารถติดต่อได้เพื่อทวงถามหนี้') !== -1;
  });

  // จับกลุ่ม "หัวข้อตารางแสดงภาระหนี้ + บรรทัดข้อมูลกำกับ (วันที่ทำสัญญา/ชื่อลูกค้า/ราคา/จำนวนงวด ฯลฯ) + ตัวตาราง
  // เอง" ให้เป็นก้อนเดียวกันเสมอ ไม่ปล่อยไหลอิสระทีละ block (2026-09-06 เจอบั๊กจริง: ปล่อยไหลอิสระแล้วหัวข้อ+
  // บรรทัดข้อมูลติดอยู่ท้ายหน้าเดิม แต่ตัวตารางล้นไปหน้าใหม่ อ่านแล้วเหมือนหลุดคนละส่วนกัน) ถ้าก้อนรวมนี้ไม่พอที่
  // ในหน้าปัจจุบันจริงๆ ค่อยตัดทั้งก้อนไปหน้าใหม่ทั้งก้อน (ไม่ตัดครึ่งกลางก้อน)
  var tableIdx = blocks.findIndex(function (b) { return b.type === 'table'; });
  var tableHeadingIdx = blocks.findIndex(function (b) { return b.type === 'paragraph' && b.text.indexOf('ตารางแสดงภาระหนี้') === 0; });
  var groupStart = (tableHeadingIdx !== -1 && tableIdx !== -1 && tableHeadingIdx < tableIdx) ? tableHeadingIdx : -1;

  var items = [];
  for (var bi = 0; bi < blocks.length; bi++) {
    if (groupStart !== -1 && bi === groupStart) {
      var groupHtml = blocks.slice(tableHeadingIdx, tableIdx + 1).map(blockHtml).join('');
      items.push({ html: groupHtml, pageBreakBefore: false });
      bi = tableIdx; // for loop จะ ++ ต่ออีกทีให้เอง ข้ามบล็อกที่รวมเข้ากลุ่มไปแล้วทั้งหมด
      continue;
    }
    items.push({ html: blockHtml(blocks[bi]), pageBreakBefore: !!blocks[bi].pageBreakBefore });
  }

  // ตำแหน่งแทรกบล็อกลายเซ็นใน items (ไม่ใช่ blocks เดิม) — items[0..groupStart-1] ตรงกับ blocks 1:1 เสมอ
  // (การรวมกลุ่มข้างบนเกิดขึ้นที่ index groupStart เป็นต้นไปเท่านั้น) ดังนั้น index ใน blocks ก่อนหน้า groupStart
  // ยังใช้ตรงกับ items ได้เลยไม่ต้องแปลง
  var sigItem = { html: signatureBlockHtml(meta), pageBreakBefore: false };
  if (refHeadingIdx !== -1) {
    items.splice(refHeadingIdx + 2, 0, sigItem);
  } else if (groupStart !== -1) {
    items.splice(groupStart, 0, sigItem); // fallback (หาหัวข้อบุคคลอ้างอิงไม่เจอ) แทรกก่อนกลุ่มตารางผ่อนแทน
  } else {
    items.push(sigItem);
  }

  var heights = measureHeights(items.map(function (i) { return i.html; }));

  var pages = [];
  var current = [];
  var used = 0;
  items.forEach(function (item, i) {
    var h = heights[i];
    var needsBreak = item.pageBreakBefore || (current.length > 0 && used + h > maxContentH);
    if (needsBreak) {
      pages.push(current);
      current = [];
      used = 0;
    }
    current.push(item.html);
    used += h;
  });
  if (current.length) pages.push(current);
  return pages;
}

function pageDivHtml(meta, innerHtml, isFirstPage) {
  // 2026-09-08 user ขอเอาหัวข้อ "ตัวอย่างสัญญาเช่าซื้อ (ฉบับร่างก่อนลงลายมือชื่อ)" ออก (ซ้ำกับหัวข้อ "สัญญา
  // เช่าซื้อแบบผ่อนชำระ..." ที่เป็นย่อหน้าแรกของเนื้อหาสัญญาเองอยู่แล้ว) — meta.title ยังส่งมาเหมือนเดิม (ใช้
  // ตั้งชื่อไฟล์/browser tab ที่อื่น) แค่ไม่ต้องพิมพ์ซ้ำบนหน้ากระดาษอีกต่อไป
  return '<div style="width:' + PAGE_W + 'px; height:' + PAGE_H + 'px; box-sizing:border-box; ' +
    'padding:' + MARGIN_TOP + 'px ' + MARGIN_X + 'px ' + MARGIN_BOTTOM + 'px; background:#ffffff; ' +
    'font-family:' + BODY_FONT + '; color:#1c1b19; font-size:13.5px; line-height:1.55; overflow:hidden;">' +
    headerHtml(meta) +
    innerHtml +
    '</div>';
}

function buildPageDivs(blocks, meta, headerH) {
  var bodyPages = paginateBodyBlocks(blocks, meta, headerH);
  var divs = bodyPages.map(function (pageItems, i) {
    return pageDivHtml(meta, pageItems.join(''), i === 0);
  });
  buildPhotoPagesHtml(meta).forEach(function (photoInner) {
    // photoPageHtml สร้าง header ในตัวเองแล้ว (ไม่ผ่าน pageDivHtml) เพราะไม่มี meta.title ซ้ำ — ห่อด้วย wrapper
    // ขนาดหน้าเดียวกันเฉยๆ
    divs.push('<div style="width:' + PAGE_W + 'px; height:' + PAGE_H + 'px; box-sizing:border-box; ' +
      'padding:' + MARGIN_TOP + 'px ' + MARGIN_X + 'px ' + MARGIN_BOTTOM + 'px; background:#ffffff; ' +
      'font-family:' + BODY_FONT + '; color:#1c1b19; font-size:13.5px; line-height:1.55; overflow:hidden;">' +
      photoInner + '</div>');
  });
  return divs;
}

// ---------- ถ่ายภาพทีละหน้า (html2canvas) แล้วต่อเป็น PDF หลายหน้า (jsPDF) — ไม่สไลซ์ภาพเดียวยาวแบบเดิม
// เพราะแต่ละหน้าเป็น A4 เป๊ะอยู่แล้วตั้งแต่ต้น (2026-09-04) ----------
function renderPagesToPdfBlob(pageContainers) {
  var pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
  var pageWidthMm = 210, pageHeightMm = 297;
  var chain = Promise.resolve();
  pageContainers.forEach(function (container, i) {
    chain = chain.then(function () {
      return window.html2canvas(container, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
    }).then(function (canvas) {
      if (i > 0) pdf.addPage();
      var imgData = canvas.toDataURL('image/jpeg', 0.92);
      pdf.addImage(imgData, 'JPEG', 0, 0, pageWidthMm, pageHeightMm);
    });
  });
  return chain.then(function () { return pdf.output('blob'); });
}

function waitForImages(root) {
  var imgs = Array.prototype.slice.call(root.querySelectorAll('img'));
  return Promise.all(imgs.map(function (img) {
    if (img.complete) return Promise.resolve();
    return new Promise(function (resolve) { img.onload = resolve; img.onerror = resolve; });
  }));
}

function renderContractPdf(blocks, meta) {
  if (!window.html2canvas || !(window.jspdf && window.jspdf.jsPDF)) {
    return Promise.reject(new Error('ไม่พบไลบรารีสร้าง PDF (html2canvas/jsPDF) กรุณาลองรีเฟรชหน้าเว็บ'));
  }
  meta = meta || {};
  meta.contractDateText = (typeof isoToDDMMYYYY === 'function' && isoToDDMMYYYY(meta.contractDate)) || '';

  // วัด header ก่อน (ถ้ามีรูป letterhead ต้องโหลดรูปให้เสร็จก่อนวัดความสูงจริง) — overflow:hidden กันไม่ให้
  // margin-bottom ของ <img> (ดู headerHtml) escape ทะลุ container เปล่าๆ แล้วนับ headerH ขาดไป (บั๊กเดียวกับ
  // measureHeights ด้านบน — ดูเหตุผลที่นั่น)
  var headerMeasureContainer = document.createElement('div');
  headerMeasureContainer.style.cssText = 'position:fixed; left:-99999px; top:0; width:' + CONTENT_W + 'px; overflow:hidden;';
  headerMeasureContainer.innerHTML = headerHtml(meta);
  document.body.appendChild(headerMeasureContainer);

  return waitForImages(headerMeasureContainer).then(function () {
    var headerH = headerMeasureContainer.getBoundingClientRect().height;
    headerMeasureContainer.remove();

    var pageHtmls = buildPageDivs(blocks, meta, headerH);
    var offscreen = document.createElement('div');
    offscreen.style.cssText = 'position:fixed; left:-99999px; top:0; z-index:-1;';
    var pageContainers = pageHtmls.map(function (html) {
      var el = document.createElement('div');
      el.innerHTML = html;
      var pageEl = el.firstChild; // เก็บ reference ไว้ก่อน — เรียก .firstChild ซ้ำหลัง appendChild แล้วจะได้ null
      // เพราะ appendChild ย้าย node ออกจาก el ไปแล้ว (บั๊กจริงที่เจอ: html2canvas โยน "Invalid element" เพราะ
      // pageContainers ทุกตัวกลายเป็น null หมด)
      offscreen.appendChild(pageEl);
      return pageEl;
    });
    document.body.appendChild(offscreen);

    return waitForImages(offscreen)
      .then(function () { return renderPagesToPdfBlob(pageContainers); })
      .finally(function () { offscreen.remove(); });
  });
}
