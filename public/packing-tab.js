// "สำหรับแพ็คกิ้ง" — ทีมแพ็คกิ้งกรอก IMEI/Serial Number ของเครื่องที่แพ็คเสร็จแล้ว ผูกกับเลข SO เพื่อให้
// ระบบเติมลงสัญญาอัตโนมัติตอนสร้างเอกสาร (แทนที่การกรอกด้วยมือ) — ดู api/packing.js (รวม packing-lookup.js +
// packing-submit.js เดิมไว้ไฟล์เดียว 2026-09-07 กันเกินโควต้า 12 ฟังก์ชัน/deployment ของ Vercel),
// api/preview-contract.js (จุดที่ดึงไปเติม tag {หมายเลขเครื่องIMEI}/{หมายเลขประจำเครื่องSerial} ใน
// master-*.docx), supabase-packing.sql (ตาราง packing_records), supabase-packing-tracking.sql (คอลัมน์ tracking)
//
// TODO (2026-09-06): วิธีที่ทีมแพ็คกิ้งจะ "หาออเดอร์ที่จะลง" ยังไม่กำหนด (user บอกจะอยู่ใน process ต่อไป)
// ตอนนี้ใช้วิธีพิมพ์เลข SO เองไปก่อน (เหมือน contracts-tab.js) — ผูกกับ so_number เฉยๆ ไม่ขึ้นกับ UI ค้นหา
// นี้ เปลี่ยนเป็นวิธีอื่น (เช่น สแกนบาร์โค้ด/คิวรอแพ็ค) ทีหลังได้โดยไม่กระทบ schema/API
//
// 2026-09-07 เพิ่มส่วน "รายการที่แพ็คแล้ว" (ตารางแบบเดียวกับ "สำหรับสต๊อค") — ย้ายปุ่ม "Export ไฟล์นำเข้า
// MyOrder" มาไว้ที่นี่ (เดิมอยู่ที่เมนู "สำหรับสต๊อค" user ขอย้ายมาที่แพ็คกิ้งแทน เพราะที่อยู่จัดส่งควรออกตอน
// แพ็คเสร็จพร้อมส่งจริงแล้ว) + เพิ่มปุ่ม "นำเข้าเลข Tracking จาก MyOrder" — parse ไฟล์ export ของ MyOrder
// (คอลัมน์ "หมายเหตุ" มีเลข SO/เลขที่สัญญาที่เราฝังไว้ตอน export, คอลัมน์ "TRACKING NO." มีเลข tracking) ด้วย
// SheetJS ฝั่ง browser จับคู่กับ SO แล้วส่งเข้า /api/packing (action: 'importTracking')
// ใช้: initPackingTab('containerElementId', user)
function initPackingTab(containerId, user) {
  'use strict';

  var state = {
    soNumber: '',
    loading: false,
    error: null,
    soInfo: null,      // { product, color, customerName } จาก crm-lookup ให้ยืนยันว่าเจอ SO ถูกตัวก่อนกรอก
    existingRecord: null, // { imei, serial_number, packed_by, updated_at } ถ้าเคยมีคนลงไว้แล้ว
    imei: '',
    serialNumber: '',
    saving: false,
    saveError: null,
    saved: false,
    // รายการที่แพ็คแล้วทั้งหมด (2026-09-07)
    packedList: [],
    packedListLoading: true,
    packedListError: null,
    packedFilter: '',
    selected: {}, // { soNumber: true }
    importingTracking: false,
    importTrackingError: null,
    importTrackingResult: null, // { imported, unmatched: [soNumber ที่หาไม่เจอในไฟล์] }
    sendingSmsFor: null, // soNumber ที่กำลังส่ง SMS อยู่ (null = ไม่มี) — 2026-09-07
    sendSmsError: null,
  };

  function resetAfterSearch() {
    state.error = null;
    state.soInfo = null;
    state.existingRecord = null;
    state.imei = '';
    state.serialNumber = '';
    state.saved = false;
    state.saveError = null;
  }

  async function doSearch() {
    resetAfterSearch();
    var so = state.soNumber.trim();
    if (!so) { state.error = 'กรุณากรอกเลขที่คำสั่งขาย (SO)'; render(); return; }
    state.loading = true;
    render();
    try {
      var crmRes = await fetch('/api/crm-lookup?so=' + encodeURIComponent(so));
      var crmBody = await crmRes.json();
      if (!crmRes.ok || crmBody.error) {
        state.error = crmBody.error || 'ไม่พบคำสั่งขายนี้';
      } else {
        state.soInfo = {
          product: crmBody.data.product,
          color: crmBody.data.color,
          customerName: crmBody.data.customer && crmBody.data.customer.firstLastName,
        };
        var packRes = await fetch('/api/packing?so=' + encodeURIComponent(so));
        var packBody = await packRes.json();
        if (packRes.ok && packBody.record) {
          state.existingRecord = packBody.record;
          state.imei = packBody.record.imei || '';
          state.serialNumber = packBody.record.serial_number || '';
        }
      }
    } catch (err) {
      state.error = 'เรียก API ไม่สำเร็จ: ' + err.message + ' (ถ้าเปิดหน้านี้ตรงๆ ผ่าน file:// ต้องรันผ่าน dev-server.js ก่อน)';
    }
    state.loading = false;
    render();
  }

  async function doSave() {
    if (!state.imei.trim() && !state.serialNumber.trim()) {
      state.saveError = 'กรุณากรอก IMEI หรือ Serial Number อย่างน้อย 1 ช่อง';
      render();
      return;
    }
    state.saving = true;
    state.saveError = null;
    state.saved = false;
    render();
    try {
      var res = await fetch('/api/packing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'submit',
          soNumber: state.soNumber.trim(),
          imei: state.imei.trim(),
          serialNumber: state.serialNumber.trim(),
          packedBy: user && user.username,
        }),
      });
      var body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || 'บันทึกไม่สำเร็จ');
      state.saved = true;
      state.existingRecord = { imei: state.imei.trim(), serial_number: state.serialNumber.trim() };
    } catch (err) {
      state.saveError = 'บันทึกไม่สำเร็จ: ' + err.message;
    }
    state.saving = false;
    render();
    loadPackedList(); // รีโหลดรายการที่แพ็คแล้ว ให้ SO ที่เพิ่งกรอกเสร็จขึ้นในตารางทันที
  }

  function fmtDateTime(iso) {
    if (!iso) return '-';
    var d = new Date(iso);
    if (isNaN(d)) return '-';
    return (isoToDDMMYYYY(iso.slice(0, 10)) || '-') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function formatAddressShort(addr) {
    if (!addr) return '-';
    var parts = [];
    if (addr.subdistrictName) parts.push('ต.' + addr.subdistrictName);
    if (addr.districtName) parts.push('อ.' + addr.districtName);
    if (addr.provinceName) parts.push('จ.' + addr.provinceName);
    return parts.length ? parts.join(' ') : '-';
  }

  async function loadPackedList() {
    state.packedListLoading = true;
    state.packedListError = null;
    render();
    try {
      var res = await fetch('/api/packing');
      var body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || 'โหลดรายการไม่สำเร็จ');
      state.packedList = body.items || [];
      var stillThere = {};
      state.packedList.forEach(function (it) { if (state.selected[it.soNumber]) stillThere[it.soNumber] = true; });
      state.selected = stillThere;
    } catch (err) {
      state.packedListError = 'โหลดรายการไม่สำเร็จ: ' + err.message + ' (ถ้ายังไม่ได้รัน supabase-packing-tracking.sql ต้องรันก่อน)';
    }
    state.packedListLoading = false;
    render();
  }

  function filteredPackedList() {
    var f = state.packedFilter.trim().toLowerCase();
    if (!f) return state.packedList;
    return state.packedList.filter(function (it) {
      return (it.customerName || '').toLowerCase().indexOf(f) !== -1 ||
        (it.soNumber || '').toLowerCase().indexOf(f) !== -1 ||
        (it.customerId || '').toLowerCase().indexOf(f) !== -1;
    });
  }

  function selectedPackedItems() {
    return state.packedList.filter(function (it) { return state.selected[it.soNumber]; });
  }

  function exportMyOrderForSelection() {
    var items = selectedPackedItems().length ? selectedPackedItems() : filteredPackedList();
    if (!items.length) { window.alert('ไม่มีรายการให้ export'); return; }
    exportMyOrderExcel(items);
  }

  // นำเข้าเลข tracking จากไฟล์ export ของ MyOrder (2026-09-07) — parse ด้วย SheetJS ฝั่ง browser หา 2 คอลัมน์
  // ด้วยชื่อ header ("หมายเหตุ" มี SO ที่เราฝังไว้ตอน export, "TRACKING NO." รูปแบบ "เลข (ขนส่ง)") ไม่ยึด
  // ตำแหน่งคอลัมน์ตายตัว กัน MyOrder สลับลำดับคอลัมน์ในอนาคต
  function parseTrackingFile(workbook) {
    var ws = workbook.Sheets[workbook.SheetNames[0]];
    var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (!rows.length) return { matched: [], unmatched: [] };
    var header = rows[0];
    var noteCol = header.indexOf('หมายเหตุ');
    var trackingCol = header.indexOf('TRACKING NO.');
    if (noteCol === -1 || trackingCol === -1) {
      throw new Error('ไม่พบคอลัมน์ "หมายเหตุ" หรือ "TRACKING NO." ในไฟล์ — ตรวจว่าเป็นไฟล์ export จาก MyOrder จริง');
    }
    var matched = [];
    var unmatched = [];
    for (var i = 1; i < rows.length; i++) {
      var row = rows[i];
      var note = String(row[noteCol] || '');
      var trackingCell = String(row[trackingCol] || '').trim();
      if (!trackingCell) continue;
      var soMatch = note.match(/SO:\s*(\S+)/);
      if (!soMatch) { unmatched.push(trackingCell); continue; }
      var courierMatch = trackingCell.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
      matched.push({
        soNumber: soMatch[1],
        trackingNo: courierMatch ? courierMatch[1].trim() : trackingCell,
        courier: courierMatch ? courierMatch[2].trim() : null,
      });
    }
    return { matched: matched, unmatched: unmatched };
  }

  async function handleTrackingFile(file) {
    state.importingTracking = true;
    state.importTrackingError = null;
    state.importTrackingResult = null;
    render();
    try {
      var buf = await file.arrayBuffer();
      var wb = XLSX.read(buf, { type: 'array' });
      var parsed = parseTrackingFile(wb);
      if (!parsed.matched.length) {
        throw new Error('ไม่พบแถวที่จับคู่เลข SO ได้เลย (ต้องเป็นไฟล์ export ของออเดอร์ที่ export มาจากระบบนี้ ที่คอลัมน์ "หมายเหตุ" มี "SO: ..." ฝังอยู่)');
      }
      var res = await fetch('/api/packing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'importTracking', rows: parsed.matched }),
      });
      var body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || 'บันทึกเลข tracking ไม่สำเร็จ');
      state.importTrackingResult = { imported: body.imported, unmatchedCount: parsed.unmatched.length };
      await loadPackedList();
    } catch (err) {
      state.importTrackingError = 'นำเข้าเลข tracking ไม่สำเร็จ: ' + err.message;
    }
    state.importingTracking = false;
    render();
  }

  // ส่ง SMS แจ้งเลข tracking หาลูกค้า (2026-09-07) — ผ่าน ThaiBulkSMS (แพทเทิร์นเดียวกับระบบส่ง SMS ติดตามหนี้
  // ของ debt-tracker) ต้องตั้งค่า THAIBULKSMS_API_KEY/API_SECRET/SENDER ใน Vercel project settings ก่อน
  function buildTrackingSmsMessage(it) {
    return 'เรียนคุณ' + (it.customerName || 'ลูกค้า') + ' พัสดุของท่าน (' + it.product + ') ถูกจัดส่งแล้ว เลขพัสดุ: ' +
      it.trackingNo + (it.courier ? ' (' + it.courier + ')' : '') + ' ขอบคุณที่ใช้บริการ Salmon Phone';
  }

  async function sendTrackingSmsFor(soNumber) {
    var it = state.packedList.filter(function (x) { return x.soNumber === soNumber; })[0];
    if (!it || !it.trackingNo) return;
    if (!it.recipientPhone) { state.sendSmsError = 'ไม่มีเบอร์โทรลูกค้าของ SO ' + soNumber; render(); return; }
    state.sendingSmsFor = soNumber;
    state.sendSmsError = null;
    render();
    try {
      var res = await fetch('/api/packing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sendTrackingSms', phone: it.recipientPhone, message: buildTrackingSmsMessage(it) }),
      });
      var body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || 'ส่ง SMS ไม่สำเร็จ');
      window.alert('ส่ง SMS แจ้งเลข tracking ให้ ' + it.customerName + ' สำเร็จแล้ว');
    } catch (err) {
      state.sendSmsError = 'ส่ง SMS ไม่สำเร็จ (SO ' + soNumber + '): ' + err.message;
    }
    state.sendingSmsFor = null;
    render();
  }

  function packedListSectionHtml() {
    var h = '<div class="card"><h2>รายการที่แพ็คแล้ว' + (state.packedList.length ? ' (' + state.packedList.length + ' รายการ)' : '') + '</h2>' +
      '<p class="hint">เลือกรายการที่ต้องการ (หรือไม่เลือกเพื่อเอาทุกรายการที่กรองอยู่) แล้วกด "Export ไฟล์นำเข้า MyOrder" เพื่อได้ไฟล์ Excel สำหรับอัปโหลดเข้า MyOrder — พอส่งของแล้ว MyOrder export เลข tracking ออกมา กด "นำเข้าเลข Tracking" เพื่อดึงกลับเข้าระบบนี้</p>';
    if (state.packedListLoading) { h += '<p class="hint">กำลังโหลด...</p></div>'; return h; }
    if (state.packedListError) { h += '<p style="color:var(--danger);">' + state.packedListError + '</p></div>'; return h; }
    h += listToolbarHtml({
      sortId: 'packSortOrder',
      sortOptions: [{ value: 'latest', label: 'เรียงลำดับ: ล่าสุด' }],
      sortValue: 'latest',
      searchIconId: 'packFilterIcon',
      searchInputId: 'packFilterInput',
      searchValue: state.packedFilter,
      searchPlaceholder: 'ค้นหาชื่อลูกค้า / รหัสลูกค้า / เลขที่คำสั่งซื้อ SO',
    });
    h += '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:12px 0;">' +
      '<button class="btn btn-secondary" id="packBtnExportMyOrder" type="button">📤 Export ไฟล์นำเข้า MyOrder (Excel)</button>' +
      '<button class="btn btn-secondary" id="packBtnImportTracking" type="button"' + (state.importingTracking ? ' disabled' : '') + '>' +
      (state.importingTracking ? 'กำลังนำเข้า...' : '📥 นำเข้าเลข Tracking จาก MyOrder (Excel)') + '</button>' +
      '<input type="file" id="packTrackingFileInput" accept=".xlsx,.xls" style="display:none;" />' +
      '<span style="color:var(--muted);font-size:13px;">' + (selectedPackedItems().length > 0 ? 'เลือกไว้ ' + selectedPackedItems().length + ' รายการ' : 'ไม่ได้เลือก = ใช้ทุกรายการที่กรองอยู่') + '</span>' +
      '</div>' +
      '<p class="hint" style="margin-top:-4px;">ไฟล์ Excel ที่ export ตรงตามเทมเพลตของ MyOrder — ก่อนอัปโหลดเข้า MyOrder ต้องตรวจ/แก้คอลัมน์ "ชื่อสินค้า (สำหรับขนส่ง)" และ "สีสินค้า" ให้เป็นภาษาไทยเองก่อนเสมอ (ตามสคบ.) เพราะข้อมูลจาก CRM เป็นภาษาอังกฤษ</p>' +
      (state.importTrackingError ? '<p style="color:var(--danger);">' + state.importTrackingError + '</p>' : '') +
      (state.importTrackingResult ? '<p style="color:#1f7a4d;">นำเข้าเลข tracking สำเร็จ ' + state.importTrackingResult.imported + ' รายการ' +
        (state.importTrackingResult.unmatchedCount ? ' (มี ' + state.importTrackingResult.unmatchedCount + ' แถวในไฟล์ที่จับคู่เลข SO ไม่ได้ — อาจเป็นออเดอร์นอกระบบนี้)' : '') + '</p>' : '');

    var rows = filteredPackedList();
    h += '<div style="overflow-x:auto;"><table class="installment-table">' +
      '<thead><tr><th></th><th style="text-align:left;">เลขที่ SO</th><th style="text-align:left;">ชื่อลูกค้า</th><th style="text-align:left;">สินค้า</th><th style="text-align:left;">ที่อยู่จัดส่ง</th><th>Tracking</th><th>วันที่แพ็ค</th><th>การดำเนินการ</th></tr></thead>' +
      '<tbody>' + rows.map(function (it) {
        var checked = !!state.selected[it.soNumber];
        var trackingCell = it.trackingNo
          ? it.trackingNo + (it.courier ? ' (' + it.courier + ')' : '')
          : '<span style="color:var(--muted);">ยังไม่มี</span>';
        var smsCell = it.trackingNo
          ? '<button type="button" class="btn btn-ghost btnSendTrackingSms" data-so="' + it.soNumber + '"' + (state.sendingSmsFor === it.soNumber ? ' disabled' : '') + '>' +
            (state.sendingSmsFor === it.soNumber ? 'กำลังส่ง...' : '📱 ส่ง SMS') + '</button>'
          : '';
        return '<tr>' +
          '<td><input type="checkbox" class="packRowCheck" data-so="' + it.soNumber + '"' + (checked ? ' checked' : '') + ' /></td>' +
          '<td style="text-align:left;">' + it.soNumber + '</td>' +
          '<td style="text-align:left;">' + it.customerName + '</td>' +
          '<td style="text-align:left;">' + it.product + (it.color ? ' (' + it.color + ')' : '') + '</td>' +
          '<td style="text-align:left;">' + formatAddressShort(it.shippingAddress) + '</td>' +
          '<td>' + trackingCell + '</td>' +
          '<td>' + fmtDateTime(it.packedAt) + '</td>' +
          '<td>' + smsCell + '</td>' +
          '</tr>';
      }).join('') + (rows.length === 0 ? '<tr><td colspan="8" style="color:var(--muted);">ไม่พบรายการที่ตรงกับคำค้นหา</td></tr>' : '') +
      '</tbody></table></div>' +
      (state.sendSmsError ? '<p style="color:var(--danger);margin-top:10px;">' + state.sendSmsError + '</p>' : '') +
      '</div>';
    return h;
  }

  function render() {
    var app = document.getElementById(containerId);
    var html = '<div class="card"><h2>สำหรับแพ็คกิ้ง — ลง IMEI / Serial Number</h2>' +
      '<p class="hint">ค้นหาด้วยเลขที่คำสั่งขาย (SO) แล้วกรอก IMEI/Serial ของเครื่องที่แพ็คเสร็จแล้ว ระบบจะเติมลงในสัญญาให้อัตโนมัติ (ถ้าเคยลงไว้แล้วจะขึ้นค่าเดิมให้แก้ไขได้)</p>' +
      '<div class="so-search-pill">' +
      '<div class="so-search-input-wrap">' +
      '<input type="text" id="packSoInput" value="' + state.soNumber.replace(/"/g, '&quot;') + '" placeholder="' +
      (state.loading ? 'กำลังค้นหา...' : 'พิมพ์เลขที่คำสั่งขาย (SO)') + '"' + (state.loading ? ' disabled' : '') + ' />' +
      '</div>' +
      '<button type="button" class="so-search-type" id="packBtnSearch" style="cursor:pointer;">ค้นหา</button>' +
      '</div>' +
      (state.error ? '<p style="color:var(--danger);margin-top:10px;">' + state.error + '</p>' : '') +
      '</div>';

    if (state.soInfo) {
      html += '<div class="card"><h2>ข้อมูลจาก CRM</h2>' +
        '<table class="installment-table">' +
        '<tr><td style="text-align:left">สินค้า</td><td>' + state.soInfo.product + (state.soInfo.color ? ' (' + state.soInfo.color + ')' : '') + '</td></tr>' +
        '<tr><td style="text-align:left">ลูกค้า</td><td>' + (state.soInfo.customerName || '-') + '</td></tr>' +
        '</table>' +
        (state.existingRecord
          ? '<p class="hint" style="margin-top:10px;">เคยลงข้อมูลไว้แล้ว — แก้ไขด้านล่างแล้วกด "บันทึก" จะเขียนทับของเดิม</p>'
          : '') +
        '</div>';

      html += '<div class="card"><h2>กรอก IMEI / Serial Number</h2>' +
        '<div class="row2">' +
        '<div class="field"><label>IMEI</label><input type="text" id="packImeiInput" value="' + state.imei.replace(/"/g, '&quot;') + '" placeholder="กรอกหมายเลข IMEI" /></div>' +
        '<div class="field"><label>Serial Number</label><input type="text" id="packSerialInput" value="' + state.serialNumber.replace(/"/g, '&quot;') + '" placeholder="กรอกหมายเลข Serial" /></div>' +
        '</div>' +
        (state.saveError ? '<p style="color:var(--danger);margin-top:10px;">' + state.saveError + '</p>' : '') +
        (state.saved ? '<p style="color:var(--success,#1f7a4d);margin-top:10px;">บันทึกแล้ว ✅</p>' : '') +
        '<button class="btn btn-primary" id="packBtnSave" style="margin-top:10px;"' + (state.saving ? ' disabled' : '') + '>' +
        (state.saving ? 'กำลังบันทึก...' : 'บันทึก') + '</button>' +
        '</div>';
    }

    html += packedListSectionHtml();

    app.innerHTML = html;

    document.getElementById('packSoInput').addEventListener('input', function (e) { state.soNumber = e.target.value; });
    document.getElementById('packSoInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') doSearch(); });
    document.getElementById('packBtnSearch').addEventListener('click', doSearch);

    if (state.soInfo) {
      document.getElementById('packImeiInput').addEventListener('input', function (e) { state.imei = e.target.value; });
      document.getElementById('packSerialInput').addEventListener('input', function (e) { state.serialNumber = e.target.value; });
      document.getElementById('packBtnSave').addEventListener('click', doSave);
    }

    var packFilterInput = document.getElementById('packFilterInput');
    if (packFilterInput) {
      packFilterInput.addEventListener('input', function (e) { state.packedFilter = e.target.value; render(); });
    }
    Array.prototype.forEach.call(document.querySelectorAll('.packRowCheck'), function (cb) {
      cb.addEventListener('change', function () {
        if (cb.checked) state.selected[cb.getAttribute('data-so')] = true; else delete state.selected[cb.getAttribute('data-so')];
        render();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.btnSendTrackingSms'), function (btn) {
      btn.addEventListener('click', function () { sendTrackingSmsFor(btn.getAttribute('data-so')); });
    });
    var btnExportMyOrder = document.getElementById('packBtnExportMyOrder');
    if (btnExportMyOrder) btnExportMyOrder.addEventListener('click', exportMyOrderForSelection);
    var trackingFileInput = document.getElementById('packTrackingFileInput');
    var btnImportTracking = document.getElementById('packBtnImportTracking');
    if (btnImportTracking && trackingFileInput) {
      btnImportTracking.addEventListener('click', function () { trackingFileInput.click(); });
      trackingFileInput.addEventListener('change', function (e) {
        var file = e.target.files && e.target.files[0];
        if (file) handleTrackingFile(file);
      });
    }
  }

  render();
  loadPackedList();
}
