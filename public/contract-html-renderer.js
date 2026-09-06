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
var MARGIN_TOP = 88; // ~23mm บน (เผื่อที่ให้หัวจดหมาย)
var MARGIN_BOTTOM = 70; // ~18.5mm ล่าง
var CONTENT_W = PAGE_W - MARGIN_X * 2;
var BODY_FONT = "'Sarabun','Noto Sans Thai','Leelawadee UI',sans-serif";

function headerHtml(meta) {
  return meta.letterheadDataUrl
    ? '<img src="' + meta.letterheadDataUrl + '" style="width:100%; display:block; margin-bottom:14px;" />'
    : '<div style="display:flex; justify-content:space-between; align-items:flex-end; border-bottom:3px solid #f2914f; padding-bottom:8px; margin-bottom:18px;">' +
      '<div style="font-weight:700; font-size:15px; color:#1c1b19;">บริษัท แซลม่อน เอ็นเตอร์ไพรส์ จำกัด (สำนักงานใหญ่)</div>' +
      '<div style="text-align:right; font-size:10.5px; color:#6b7280;">Salmon Enterprise Company Limited (Head Office)</div>' +
      '</div>';
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

function paragraphHtml(block) {
  var inner = runsHtml(block.runs, block.text);
  if (isFieldLine(block.text)) {
    return '<p style="margin:0 0 8px; text-align:left;">' + inner + '</p>';
  }
  return '<p style="margin:0 0 10px; text-align:justify; text-indent:1.8em;">' + inner + '</p>';
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
  var html = '<div style="display:flex; justify-content:space-between; margin-top:22px;">' +
    signatureLineHtml('ผู้เช่าซื้อ', ((c.title || '') + (c.firstLastName || '')) || '-', files.signature) +
    signatureLineHtml('ผู้แทนผู้ให้เช่าซื้อ', staffSig.name || 'พนักงานฝ่ายบัญชีหนี้สิน บจก. แซลม่อน เอ็นเตอร์ไพรส์', staffSig.url) +
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
function certBlockHtml(personLabel, name, contractDateText) {
  return '<div style="text-align:center; margin-top:18px;">' +
    '<div style="font-weight:700; font-size:14px; margin-bottom:4px;">สำเนาถูกต้อง</div>' +
    '<div style="color:#dc2626; font-size:12px; text-decoration:underline; margin-bottom:16px;">เอกสารฉบับนี้ใช้สำหรับผ่อนสินค้ากับบจก.แซลม่อน เอ็นเตอร์ไพรส์เท่านั้น</div>' +
    '<div style="height:34px;"></div>' +
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
    (opts.withCert ? certBlockHtml(opts.personLabel, opts.personName, meta.contractDateText) : '');
}

// รูปที่ต้องแนบ เรียงตามลำดับ: บัตร ปชช. ลูกค้า(มีตรา) -> คู่บัตร ลูกค้า(ไม่มีตรา) -> บัตร ปชช. ผู้ปกครอง/
// ผู้ค้ำถ้ามี(มีตรา) — ข้ามรูปที่ยังไม่มี (เช่น CS ดูตัวอย่างก่อนลูกค้ากรอกฟอร์ม ยังไม่มีไฟล์เลยสักใบ)
function buildPhotoPagesHtml(meta) {
  var c = meta.customer || {};
  var files = c.files || {};
  var pages = [];
  var customerName = ((c.title || '') + (c.firstLastName || '')) || '-';
  if (files.idCard) pages.push(photoPageHtml(meta, files.idCard, { withCert: true, personLabel: 'ผู้เช่าซื้อ', personName: customerName }));
  if (files.selfieWithId) pages.push(photoPageHtml(meta, files.selfieWithId, { withCert: false }));
  if (meta.hasGuardian && files.guardianId) {
    var guardianName = c.guardian ? ((c.guardian.title || '') + (c.guardian.firstLastName || '')) : '-';
    pages.push(photoPageHtml(meta, files.guardianId, { withCert: true, personLabel: 'ผู้ให้ความยินยอม (ผู้ปกครอง)', personName: guardianName }));
  }
  if (meta.hasGuarantor && files.guarantorId) {
    var guarantorName = c.guarantor ? ((c.guarantor.title || '') + (c.guarantor.firstLastName || '')) : '-';
    pages.push(photoPageHtml(meta, files.guarantorId, { withCert: true, personLabel: 'ผู้ค้ำประกัน', personName: guarantorName }));
  }
  return pages;
}

// ---------- วัดความสูงเนื้อหาจริง แล้วจัดเรียงลงหน้า A4 (2026-09-04) ----------
// สร้าง div วัดผลนอกจอ ความกว้างเท่าเนื้อหาจริงเป๊ะ ใส่ item ทีละอันแล้วอ่าน getBoundingClientRect — เป็น
// ข้อความ/ตารางล้วน ไม่มีรูปภาพ (รูปภาพอยู่ในหน้าที่แยกไปแล้วข้างบน ไม่ต้องกังวลเรื่อง <img> โหลดไม่ทันตอนวัด)
function measureHeights(htmls) {
  var measurer = document.createElement('div');
  measurer.style.cssText = 'position:fixed; left:-99999px; top:0; width:' + CONTENT_W + 'px; ' +
    'font-family:' + BODY_FONT + '; font-size:13.5px; line-height:1.55; color:#1c1b19;';
  document.body.appendChild(measurer);
  var heights = htmls.map(function (html) {
    var wrap = document.createElement('div');
    wrap.innerHTML = html;
    measurer.appendChild(wrap);
    return wrap.getBoundingClientRect().height;
  });
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

  // แทรกบล็อกลายเซ็นก่อนตาราง (หรือท้ายสุดถ้าไม่มีตาราง) — วางไว้ท้ายเนื้อหาสัญญาปกติ ก่อนหน้าตารางผ่อน
  var tableIdx = blocks.findIndex(function (b) { return b.type === 'table'; });
  var items = blocks.map(function (b) { return { html: blockHtml(b), pageBreakBefore: !!b.pageBreakBefore }; });
  var sigItem = { html: signatureBlockHtml(meta), pageBreakBefore: false };
  if (tableIdx !== -1) items.splice(tableIdx, 0, sigItem); else items.push(sigItem);

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
  return '<div style="width:' + PAGE_W + 'px; height:' + PAGE_H + 'px; box-sizing:border-box; ' +
    'padding:' + MARGIN_TOP + 'px ' + MARGIN_X + 'px ' + MARGIN_BOTTOM + 'px; background:#ffffff; ' +
    'font-family:' + BODY_FONT + '; color:#1c1b19; font-size:13.5px; line-height:1.55; overflow:hidden;">' +
    headerHtml(meta) +
    (isFirstPage ? '<div style="text-align:center; font-size:16px; font-weight:700; margin-bottom:14px;">' + escHtml(meta.title || '') + '</div>' : '') +
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

  // วัด header ก่อน (ถ้ามีรูป letterhead ต้องโหลดรูปให้เสร็จก่อนวัดความสูงจริง)
  var headerMeasureContainer = document.createElement('div');
  headerMeasureContainer.style.cssText = 'position:fixed; left:-99999px; top:0; width:' + CONTENT_W + 'px;';
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
