// แยกเนื้อหา document.xml (หลัง docxtemplater เติมข้อมูลแล้ว) ออกเป็นลิสต์ block เรียงลำดับตามที่ปรากฏจริง
// (ย่อหน้า / ตาราง) แทนที่จะตัด tag ทิ้งเหลือข้อความก้อนเดียวยาวๆ แบบเดิม — ทำให้ฝั่ง PDF วาด "ตารางผ่อนชำระ"
// เป็นตารางจริงได้ (2026-09-03 ตามที่ user ขอ "ตารางผ่อนให้ระบบออกแบบให้สอดคล้องกับสัญญา")
//
// รองรับเฉพาะโครงสร้างที่พบจริงในเทมเพลตนี้: มีตารางเดียวในเอกสารทั้งฉบับ (ตารางแสดงการผ่อนชำระ 3 คอลัมน์)
// ไม่ได้เขียนเป็น .docx table parser ทั่วไปสำหรับทุกโครงสร้างที่เป็นไปได้

function stripTags(xml) { return xml.replace(/<[^>]+>/g, ''); }

function paragraphsFromXml(xml) {
  return xml.split('</w:p>')
    .map(function (p) { return stripTags(p).trim(); })
    .filter(Boolean)
    .map(function (text) { return { type: 'paragraph', text: text }; });
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
