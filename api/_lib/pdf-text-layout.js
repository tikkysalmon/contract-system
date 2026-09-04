// จัดหน้า PDF จากข้อความล้วน (ไม่มี layout engine อย่าง Word) ด้วย pdf-lib โดยตรง
// เหตุผลที่ทำแบบนี้แทนการแปลง docx->PDF จริง: เครื่องนี้ไม่มี LibreOffice/Word และยังไม่ได้ตั้งค่า
// CloudConvert API key — วิธีนี้ใช้ pdf-lib (มีอยู่แล้ว) render ข้อความสัญญาจริง (จาก docxtemplater)
// เป็น PDF อ่านได้ทันที ไม่ใช่ layout ที่ตรงกับ Word เป๊ะ แต่เนื้อหาถูกต้องครบถ้วนคำต่อคำ
//
// ภาษาไทยไม่มีช่องว่างระหว่างคำ (ต่างจากอังกฤษ) ทำให้ word-wrap แบบมาตรฐาน (ตัดที่ space) ใช้ไม่ได้ตรงๆ
// เพราะข้อความไทยยาวๆ จะกลายเป็น "คำ" เดียวที่ยาวเกินหน้ากระดาษ — ฟังก์ชันนี้เลยลอง wrap ที่ space ก่อน
// (ให้คำอังกฤษ/ตัวเลขที่มี space จริงๆ อย่าง "iPhone 15" ตัดสวยงาม) แล้ว fallback ไปตัดทีละตัวอักษรสำหรับ
// ส่วนที่เป็นไทยล้วนไม่มี space ยาวเกินบรรทัด

function wrapParagraph(text, font, fontSize, maxWidth) {
  const lines = [];
  const words = String(text).split(' ');
  let currentLine = '';

  function widthOf(s) { return font.widthOfTextAtSize(s, fontSize); }

  for (const word of words) {
    const candidate = currentLine ? currentLine + ' ' + word : word;
    if (widthOf(candidate) <= maxWidth) {
      currentLine = candidate;
      continue;
    }
    // candidate ยาวเกิน — เก็บบรรทัดปัจจุบันก่อน (ถ้ามี) แล้วค่อยจัดการ word ใหม่
    if (currentLine) { lines.push(currentLine); currentLine = ''; }
    if (widthOf(word) <= maxWidth) {
      currentLine = word;
      continue;
    }
    // word เดี่ยวๆ ก็ยังยาวเกินบรรทัด (กรณีไทยไม่มี space) — ตัดทีละตัวอักษร
    let chunk = '';
    for (const ch of word) {
      const next = chunk + ch;
      if (widthOf(next) <= maxWidth) {
        chunk = next;
      } else {
        if (chunk) lines.push(chunk);
        chunk = ch;
      }
    }
    currentLine = chunk;
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

// วาดตาราง (เช่น ตารางแสดงการผ่อนชำระ) เป็นกริดจริงด้วย pdf-lib แทนการปล่อยให้ปนไปกับข้อความล้วน — ใช้ page/y
// ที่ส่งมาจาก closure ของ renderTextToPdf โดยตรง (ผ่าน ctx) เพราะต้องขึ้นหน้าใหม่กลางตารางได้ถ้าตารางยาวเกินหน้า
function drawTable(ctx, table) {
  const { pdfDoc, font, rgb, PAGE_W, MARGIN, maxWidth } = ctx;
  const cellPad = 6;
  const rowH = 22;
  const headerH = 22;
  const fontSize = 10;
  const colCount = table.header.length;
  // คอลัมน์ "งวดที่" แคบ ที่เหลือแบ่งเท่ากัน (ตรงกับ 3 คอลัมน์จริงของตาราง: งวดที่/ชำระภายในวันที่/จำนวนเงิน)
  const firstColW = Math.min(60, maxWidth * 0.15);
  const restColW = (maxWidth - firstColW) / (colCount - 1);
  const colWidths = table.header.map(function (_, i) { return i === 0 ? firstColW : restColW; });

  function colX(i) {
    let x = MARGIN;
    for (let k = 0; k < i; k++) x += colWidths[k];
    return x;
  }

  function drawRow(cells, y, height, isHeader) {
    const x0 = MARGIN;
    if (isHeader) {
      ctx.page.drawRectangle({ x: x0, y: y - height, width: maxWidth, height, color: rgb(0.93, 0.93, 0.93) });
    }
    ctx.page.drawRectangle({ x: x0, y: y - height, width: maxWidth, height, borderColor: rgb(0.75, 0.75, 0.75), borderWidth: 0.75 });
    for (let i = 1; i < colCount; i++) {
      const x = colX(i);
      ctx.page.drawLine({ start: { x, y }, end: { x, y: y - height }, thickness: 0.75, color: rgb(0.75, 0.75, 0.75) });
    }
    cells.forEach(function (text, i) {
      const x = colX(i) + cellPad;
      const textY = y - height / 2 - fontSize * 0.35;
      ctx.page.drawText(String(text == null ? '' : text), { x, y: textY, size: fontSize, font, color: rgb(0, 0, 0) });
    });
  }

  ctx.newPageIfNeeded(headerH + rowH);
  drawRow(table.header, ctx.y, headerH, true);
  ctx.y -= headerH;

  table.rows.forEach(function (row) {
    ctx.newPageIfNeeded(rowH);
    drawRow(row, ctx.y, rowH, false);
    ctx.y -= rowH;
  });
  ctx.y -= 14; // เว้นช่องว่างหลังตารางก่อนย่อหน้าถัดไป
}

// blocks: ลิสต์ { type: 'paragraph', text } หรือ { type: 'table', header, rows } เรียงลำดับตามที่ปรากฏในเอกสารจริง
// (จาก api/_lib/docx-blocks.js) — คืน pdf-lib PDFDocument (bytes) พร้อมใช้
async function renderTextToPdf(opts) {
  const { PDFDocument, rgb } = require('pdf-lib');
  const fontkit = require('@pdf-lib/fontkit');
  const fs = require('fs');
  const path = require('path');

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const fontBytes = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'lib', 'NotoSansThai-Regular.ttf'));
  const font = await pdfDoc.embedFont(fontBytes, { subset: true });

  const PAGE_W = 595.28; // A4
  const PAGE_H = 841.89;
  const MARGIN = 50;
  const maxWidth = PAGE_W - MARGIN * 2;
  const bodySize = 11;
  const titleSize = 16;
  const lineHeight = bodySize * 1.6;

  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  function newPageIfNeeded(needed) {
    if (y - needed < MARGIN) {
      page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
  }

  // หัวจดหมาย/โลโก้บริษัท (อัปโหลดผ่านหน้า CS review, ดู cs-review.js's "ตั้งค่าหัวจดหมาย") — แปะแค่หน้าแรก
  // ตามธรรมเนียมเอกสารธุรกิจทั่วไป ไม่ใช่ทุกหน้า (2026-09-03, user ขอให้ตัวอย่าง PDF ใช้หัวจดหมายจริง)
  // มี timeout กันไว้: เจอจริงระหว่างทดสอบว่าไฟล์ PNG เพี้ยน (ไม่ใช่แค่ format ผิด) ทำให้ pdf-lib ค้างที่
  // embedPng แทนที่จะ throw error ปกติ — try/catch เฉยๆ ช่วยไม่ได้ถ้ามันค้างจริง ต้อง race กับ timeout ด้วย
  if (opts.letterheadBytes) {
    try {
      const isPng = opts.letterheadMime === 'image/png';
      const embedPromise = isPng ? pdfDoc.embedPng(opts.letterheadBytes) : pdfDoc.embedJpg(opts.letterheadBytes);
      const timeoutPromise = new Promise(function (_, reject) {
        setTimeout(function () { reject(new Error('letterhead embed timeout')); }, 5000);
      });
      const letterheadImage = await Promise.race([embedPromise, timeoutPromise]);
      const maxLetterheadHeight = 70;
      const scale = Math.min(maxWidth / letterheadImage.width, maxLetterheadHeight / letterheadImage.height, 1);
      const w = letterheadImage.width * scale;
      const h = letterheadImage.height * scale;
      page.drawImage(letterheadImage, { x: (PAGE_W - w) / 2, y: y - h, width: w, height: h });
      y -= h + 14;
    } catch (e) {
      // ไฟล์รูปเสีย/ฟอร์แมตไม่รองรับ (ไม่ใช่ PNG/JPG จริง) — ข้ามหัวจดหมายไปแทนที่จะทำให้สร้าง PDF ทั้งฉบับพัง
    }
  }

  // หัวเรื่อง
  const titleLines = wrapParagraph(opts.title || '', font, titleSize, maxWidth);
  for (const line of titleLines) {
    newPageIfNeeded(titleSize * 1.4);
    const w = font.widthOfTextAtSize(line, titleSize);
    page.drawText(line, { x: (PAGE_W - w) / 2, y, size: titleSize, font, color: rgb(0.1, 0.1, 0.1) });
    y -= titleSize * 1.4;
  }
  y -= 10;

  // รองรับทั้ง opts.blocks (ใหม่ — เรียงย่อหน้า/ตารางตามที่ปรากฏจริงในเอกสาร) และ opts.body string เดิม
  // (แตกเป็นย่อหน้าล้วน ไม่มีตาราง) เผื่อโค้ดอื่นยังเรียกแบบเดิมอยู่
  const blocks = opts.blocks || String(opts.body || '')
    .split('\n').map(function (p) { return p.trim(); }).filter(Boolean)
    .map(function (text) { return { type: 'paragraph', text: text }; });

  // ctx: ให้ drawTable() อ่าน/แก้ page และ y ตัวเดียวกับ loop นี้ผ่าน getter/setter (page ถูกสลับเป็นหน้าใหม่
  // ระหว่างวาดตารางยาวได้ ต้องเป็นตัวแปรเดียวกันจริงๆ ไม่ใช่สำเนา)
  const ctx = {
    pdfDoc, font, rgb, PAGE_W, MARGIN, maxWidth, newPageIfNeeded,
    get page() { return page; }, set page(p) { page = p; },
    get y() { return y; }, set y(v) { y = v; },
  };

  for (const block of blocks) {
    if (block.type === 'table') {
      drawTable(ctx, block);
      continue;
    }
    const lines = wrapParagraph(block.text, font, bodySize, maxWidth);
    for (const line of lines) {
      newPageIfNeeded(lineHeight);
      page.drawText(line, { x: MARGIN, y, size: bodySize, font, color: rgb(0, 0, 0) });
      y -= lineHeight;
    }
    y -= lineHeight * 0.4; // เว้นย่อหน้า
  }

  // เลขหน้า
  const pages = pdfDoc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const label = (i + 1) + ' / ' + pages.length;
    const w = font.widthOfTextAtSize(label, 9);
    pages[i].drawText(label, { x: PAGE_W - MARGIN - w, y: 24, size: 9, font, color: rgb(0.5, 0.5, 0.5) });
  }

  return pdfDoc.save();
}

module.exports = { wrapParagraph, renderTextToPdf };
