// แถบเครื่องมือด้านบนของหน้ารายการ (เรียงลำดับ + (ไม่บังคับ) เลือกโหมดค้นหา + ช่องค้นหาทรงแคปซูล + แถวตัวกรอง)
// (2026-09-07 user ขอให้ทุกเมนูที่แสดงรายการ ("ข้อมูลลูกค้าทำสัญญา", "สำหรับ CS", "สำหรับสต๊อค") มีหน้าตา
// เหมือนตัวอย่างหน้า "Sale Order" ที่ส่งมา — ไม่รวมแถวการ์ดสถิติด้านบนสุด user บอกไม่ต้องทำ) แยกออกมาเป็นไฟล์
// กลางกันเขียน markup/CSS ซ้ำ 3 ที่ — ใช้ class เดิมจาก style.css (.so-search-pill ฯลฯ) ที่มีอยู่แล้วจากหน้า
// "ค้นหาคำสั่งขาย" เดิมใน contracts-tab.js ไม่ได้เพิ่ม CSS ใหม่
//
// ใช้: listToolbarHtml({
//   sortId, sortOptions: [{value,label}], sortValue,       // dropdown แรกเสมอ (เรียงลำดับ)
//   typeId, typeOptions, typeValue,                        // dropdown ที่ 2 (ไม่บังคับ — ใส่เมื่อมีโหมดค้นหาให้เลือก)
//   searchIconId, searchInputId, searchValue, searchPlaceholder, searchDisabled,
//   filterChipLabel, filterChipHint,                       // แถวตัวกรองด้านล่าง (ตอนนี้เป็นแค่ป้ายตกแต่ง ยังไม่มี
//                                                           // logic ตัวกรองเพิ่มเติมจริงตามที่ user ยืนยันว่ายังไม่ต้องทำ)
// })
var LIST_TOOLBAR_SEARCH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle>' +
  '<line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';

function listToolbarHtml(opts) {
  opts = opts || {};
  function optionsHtml(options, currentValue) {
    return options.map(function (o) {
      return '<option value="' + o.value + '"' + (o.value === currentValue ? ' selected' : '') + '>' + o.label + '</option>';
    }).join('');
  }
  var sortSelect = '<select id="' + opts.sortId + '" class="so-search-type">' + optionsHtml(opts.sortOptions, opts.sortValue) + '</select>';
  var typeSelect = opts.typeOptions
    ? '<select id="' + opts.typeId + '" class="so-search-type">' + optionsHtml(opts.typeOptions, opts.typeValue) + '</select>'
    : '';
  return '<div class="so-search-pill">' + sortSelect + typeSelect +
    '<div class="so-search-input-wrap">' +
    '<span class="so-search-icon" id="' + opts.searchIconId + '">' + LIST_TOOLBAR_SEARCH_ICON + '</span>' +
    '<input type="text" id="' + opts.searchInputId + '" value="' + (opts.searchValue || '').replace(/"/g, '&quot;') + '" placeholder="' +
    (opts.searchPlaceholder || 'พิมพ์เพื่อค้นหา') + '"' + (opts.searchDisabled ? ' disabled' : '') + ' />' +
    '</div></div>' +
    '<div class="so-search-filter-row"><span class="filter-chip">▽ ' + (opts.filterChipLabel || 'ตัวกรอง') + '</span>' +
    '<span class="filter-chip-hint">' + (opts.filterChipHint || 'ยังไม่ได้เลือกตัวกรอง') + '</span></div>';
}
