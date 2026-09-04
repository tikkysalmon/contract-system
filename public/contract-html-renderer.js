// เรนเดอร์สัญญาเป็น PDF ฝั่ง browser (2026-09-04) — เทคนิคเดียวกับ debt-tracker's หนังสือบอกเลิกสัญญา/
// หนังสือทวงหนี้ (buildCancelLetterHtml + confirmIssueCancelLetter, index.html บรรทัด 5099/5190): สร้าง
// HTML ของสัญญาเอง (จาก block ย่อหน้า/ตารางที่ server แยกมาจาก docx จริง) วาดใส่ <div> ที่ซ่อนอยู่นอกจอ ->
// ถ่ายภาพด้วย html2canvas -> ฝังภาพนั้นลง PDF ด้วย jsPDF (แบ่งหน้าอัตโนมัติถ้ายาวเกิน A4 หน้าเดียว)
//
// ทำไมเลือกวิธีนี้แทนแปลง .docx -> PDF จริงผ่านบริการภายนอก (CloudConvert ฯลฯ): ฟรี ไม่ต้องสมัคร/ขอ API key
// เพิ่ม, คุมหน้าตาได้เองทั้งหมด (ตาราง/ฟอนต์/ระยะห่าง), และเป็นแพทเทิร์นที่ทดสอบแล้วใช้งานจริงอยู่แล้วใน
// debt-tracker — user ขอให้ทำแบบเดียวกันนี้ (2026-09-04)
//
// ใช้: renderContractPdf(blocks, meta) -> Promise<Blob>
//   blocks: [{type:'paragraph', text} | {type:'table', header, rows}] จาก /api/preview-contract
//   meta: { title, letterheadDataUrl }
// ต้องโหลด html2canvas + jsPDF (CDN, ดู sign.html/app.html) ก่อนไฟล์นี้

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function buildContractHtml(blocks, meta) {
  var headerHtml = meta.letterheadDataUrl
    ? '<img src="' + meta.letterheadDataUrl + '" style="width:100%; display:block; margin-bottom:16px;" />'
    : '<div style="font-weight:700; font-size:17px; margin-bottom:6px;">บริษัท แซลม่อน เอ็นเตอร์ไพรส์ จำกัด</div><div style="height:2px; background:#1f3a5f; margin-bottom:14px;"></div>';

  var bodyHtml = (blocks || []).map(function (block) {
    if (block.type === 'table') {
      var theadHtml = '<tr>' + block.header.map(function (h) {
        return '<th style="border:1px solid #ccc;padding:6px 8px;background:#f2f2f2;font-size:12px;">' + escHtml(h) + '</th>';
      }).join('') + '</tr>';
      var rowsHtml = block.rows.map(function (row) {
        return '<tr>' + row.map(function (cell) {
          return '<td style="border:1px solid #ccc;padding:5px 8px;font-size:12px;text-align:center;">' + escHtml(cell) + '</td>';
        }).join('') + '</tr>';
      }).join('');
      return '<table style="width:100%;border-collapse:collapse;margin:6px 0 16px;">' + theadHtml + rowsHtml + '</table>';
    }
    return '<p style="margin:0 0 10px;text-align:justify;text-indent:1.8em;">' + escHtml(block.text) + '</p>';
  }).join('');

  return '<div style="width:794px; box-sizing:border-box; padding:36px 50px; background:#ffffff; ' +
    'font-family:\'Sarabun\',\'Noto Sans Thai\',\'Leelawadee UI\',sans-serif; color:#1c1b19; font-size:13.5px; line-height:1.55;">' +
    headerHtml +
    '<div style="text-align:center; font-size:16px; font-weight:700; margin-bottom:14px;">' + escHtml(meta.title || '') + '</div>' +
    bodyHtml +
    '</div>';
}

// ถ่ายภาพ container (html2canvas) แล้วฝังลง PDF แบ่งหน้าอัตโนมัติ — ค่า/สูตรเดียวกับ debt-tracker เป๊ะ
// (scale:2 กันภาพแตก, A4 mm, JPEG quality 0.92)
function renderHtmlContainerToPdfBlob(container) {
  return window.html2canvas(container, { scale: 2, useCORS: true, backgroundColor: '#ffffff' })
    .then(function (canvas) {
      var pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
      var pageWidth = 210, pageHeight = 297;
      var imgData = canvas.toDataURL('image/jpeg', 0.92);
      var imgHeight = (canvas.height * pageWidth) / canvas.width;
      var heightLeft = imgHeight, position = 0;
      pdf.addImage(imgData, 'JPEG', 0, position, pageWidth, imgHeight);
      heightLeft -= pageHeight;
      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, position, pageWidth, imgHeight);
        heightLeft -= pageHeight;
      }
      return pdf.output('blob');
    });
}

function renderContractPdf(blocks, meta) {
  if (!window.html2canvas || !(window.jspdf && window.jspdf.jsPDF)) {
    return Promise.reject(new Error('ไม่พบไลบรารีสร้าง PDF (html2canvas/jsPDF) กรุณาลองรีเฟรชหน้าเว็บ'));
  }
  var container = document.createElement('div');
  container.style.cssText = 'position:fixed; left:-99999px; top:0; z-index:-1;';
  container.innerHTML = buildContractHtml(blocks, meta);
  document.body.appendChild(container);
  var imgEl = container.querySelector('img');
  var waitForImg = (imgEl && !imgEl.complete)
    ? new Promise(function (resolve) { imgEl.onload = resolve; imgEl.onerror = resolve; })
    : Promise.resolve();
  return waitForImg
    .then(function () { return renderHtmlContainerToPdfBlob(container); })
    .finally(function () { container.remove(); });
}
