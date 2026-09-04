// แยกเนื้อหา document.xml (หลัง docxtemplater เติมข้อมูลแล้ว) ออกเป็นลิสต์ block เรียงลำดับตามที่ปรากฏจริง
// (ย่อหน้า / ตาราง) แทนที่จะตัด tag ทิ้งเหลือข้อความก้อนเดียวยาวๆ แบบเดิม — ทำให้ฝั่ง PDF วาด "ตารางผ่อนชำระ"
// เป็นตารางจริงได้ (2026-09-03) และ (2026-09-04) แต่ละย่อหน้าเก็บ "runs" (ท่อนข้อความ+ฟอร์แมต) แทนสตริงเดียว
// เพื่อให้ตัวหนา/สีที่มีอยู่จริงในเทมเพลต (เช่น "ค่าปรับล่าช้า 500 บาท/ครั้ง" ตัวหนา, หัวข้อ "บุคคลที่ร้าน
// สามารถติดต่อได้เพื่อทวงถามหนี้" สีแดง) แสดงผลถูกต้องในตัวอย่าง PDF แทนที่จะเหลือแค่ข้อความสีดำล้วน
//
// รองรับเฉพาะโครงสร้างที่พบจริงในเทมเพลตนี้: มีตารางเดียวในเอกสารทั้งฉบับ (ตารางแสดงการผ่อนชำระ 3 คอลัมน์)
// ไม่ได้เขียนเป็น .docx table parser ทั่วไปสำหรับทุกโครงสร้างที่เป็นไปได้

function stripTags(xml) { return xml.replace(/<[^>]+>/g, ''); }

function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// แยก <w:r>...</w:r> รันแต่ละอันในย่อหน้า พร้อมอ่าน bold/color/underline จาก <w:rPr> — ยังไม่ครอบคลุมทุก
// property ของ OOXML (แค่ 3 อย่างที่ใช้จริงในเทมเพลตนี้) ใช้ regex ล้วน (สอดคล้องกับแนวทางเดิมของไฟล์นี้
// ที่ไม่พึ่ง XML parser เต็มรูปแบบ) — ถ้าเจอ <w:r> ที่ซ้อนอยู่ในกล่องข้อความลอย (floating textbox ของลายเซ็น/
// สำเนาถูกต้อง) ก็จะถูกดึงมาด้วยเหมือนเดิม (ยังไม่แยกกรณีนี้ ณ จุดนี้) แต่ parseDocxBodyToBlocks ด้านล่างจะ
// กรองย่อหน้าที่เป็นขยะจาก textbox ลอยพวกนี้ทิ้งอีกทีด้วยการเช็คเนื้อหา (ดู FLOATING_TEXTBOX_NOISE)
function runsFromParagraphXml(pXml) {
  var runChunks = pXml.split(/<w:r[ >]/).slice(1);
  var runs = [];
  runChunks.forEach(function (chunk) {
    var openTagEnd = chunk.indexOf('>');
    var rest = openTagEnd === -1 ? chunk : chunk.slice(openTagEnd + 1);
    var rPrMatch = rest.match(/^<w:rPr>([\s\S]*?)<\/w:rPr>/);
    var rPr = (rPrMatch && rPrMatch[1]) || '';
    var bold = /<w:b\/>|<w:b w:val="(?!false|0)[^"]*"\s*\/>/.test(rPr);
    var colorMatch = rPr.match(/<w:color w:val="([0-9A-Fa-f]{6})"/);
    var color = null;
    if (colorMatch) {
      var hex = colorMatch[1].toUpperCase();
      if (hex !== '000000' && hex !== 'AUTO') color = '#' + hex;
    }
    var underline = /<w:u w:val="(?!none)[^"]+"/.test(rPr);
    // ต้องระบุ "<w:t" ตามด้วย ">" หรือ whitespace เท่านั้น (ไม่ใช่ [^>]* เฉยๆ) กัน match พลาดไปโดน <w:tab/>
    // (ที่ก็ขึ้นต้นด้วย "<w:t" เหมือนกัน) ทำให้เนื้อหา tag หลุดปนเข้ามาในข้อความที่ดึงออกมา (บั๊กจริงที่เจอ)
    var text = Array.from(chunk.matchAll(/<w:t(?:>|\s[^>]*>)([\s\S]*?)<\/w:t>/g))
      .map(function (m) { return decodeXmlEntities(m[1]); })
      .join('');
    if (/<w:tab\s*\/>/.test(chunk)) text += '\t';
    if (text) runs.push({ text: text, bold: bold, color: color, underline: underline });
  });
  return runs;
}

// ย่อหน้าที่เป็น "ขยะ" จาก floating textbox ของ Word (ลายเซ็น/สำเนาถูกต้อง) — Word เก็บ paragraph ของ
// textbox เหล่านี้ปนอยู่ใน document.xml ตรงตำแหน่งที่ anchor ไว้ (มักอยู่ท้ายเอกสาร ก่อนตาราง) แต่ตำแหน่งที่
// "แสดงผลจริง" ลอยไปคนละที่ตามพิกัด absolute (wp:positionV/H) ซึ่งย้อนกลับมาคำนวณตำแหน่งที่ถูกต้องเป๊ะไม่ได้
// โดยไม่มี layout engine ของ Word จริง (พิจารณาแล้วว่าเกินความคุ้มค่า) — แทนที่จะพยายามแทรกข้อความตรงนี้ให้
// ถูกตำแหน่ง จึงกรองออกทั้งหมด แล้วให้ contract-html-renderer.js สร้างบล็อกลายเซ็น/รับรองสำเนาขึ้นเองแทน
// จากข้อมูลลูกค้าจริง (ชื่อ/รูปที่อัปโหลด) วางในตำแหน่งที่อ่านเข้าใจง่าย (ท้ายเนื้อหาสัญญา + หน้ารูปแนบ)
function isFloatingTextboxNoise(text) {
  return /ลายเซ็น/.test(text) || /สำเนาถูกต้อง/.test(text) ||
    text === 'เอกสารฉบับนี้ใช้สำหรับผ่อนสินค้ากับบจก.แซลม่อน เอ็นเตอร์ไพรส์เท่านั้น';
}

function paragraphsFromXml(xml) {
  return xml.split('</w:p>')
    .map(function (pXml) {
      var runs = runsFromParagraphXml(pXml);
      var text = runs.map(function (r) { return r.text; }).join('').trim();
      return { type: 'paragraph', runs: runs, text: text };
    })
    .filter(function (b) { return b.text && !isFloatingTextboxNoise(b.text); });
}

// แยกแถว/เซลล์ด้วย <w:tr /<w:tc — เช็คตัวอักษรถัดไปต้องเป็น space หรือ '>' กันไปแมตช์ <w:trPr>/<w:tcPr>
// (element คุณสมบัติของแถว/เซลล์ ไม่ใช่ตัวแถว/เซลล์เอง) โดยไม่ต้องพึ่ง XML parser เต็มรูปแบบ
function tableFromXml(tableXml) {
  var rowsXml = tableXml.split(/<w:tr[ >]/).slice(1);
  return rowsXml.map(function (rowXml) {
    var cellsXml = rowXml.split(/<w:tc[ >]/).slice(1);
    return cellsXml.map(function (cellXml) { return stripTags(cellXml).trim(); });
  });
}

function parseDocxBodyToBlocks(xml) {
  var tblStart = xml.indexOf('<w:tbl>');
  var tblEnd = xml.indexOf('</w:tbl>');
  if (tblStart === -1 || tblEnd === -1) return paragraphsFromXml(xml);

  var beforeXml = xml.slice(0, tblStart);
  var tableXml = xml.slice(tblStart, tblEnd + '</w:tbl>'.length);
  var afterXml = xml.slice(tblEnd + '</w:tbl>'.length);

  var blocks = paragraphsFromXml(beforeXml);
  var rows = tableFromXml(tableXml);
  if (rows.length > 0) {
    blocks.push({ type: 'table', header: rows[0], rows: rows.slice(1) });
  }
  return blocks.concat(paragraphsFromXml(afterXml));
}

module.exports = { parseDocxBodyToBlocks };
