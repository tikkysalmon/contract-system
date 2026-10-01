// เมนู "ข้อมูลลูกค้า" (2026-10-01 user ขอ) — รวบรวมข้อมูลลูกค้าที่ดำเนินการบนระบบนี้ไว้ที่เดียว ให้แผนกบริการ
// ตรวจสอบเบื้องต้นและแจ้งลูกค้าได้ อ่านอย่างเดียว 1 แถวต่อ 1 SO — ไม่มีข้อมูลส่วนตัว (เลขบัตร/เบอร์/ที่อยู่) ปนเลย
// ข้อมูลมาจาก /api/cs-session-list?view=customer-info (ดูหมายเหตุ handleCustomerInfo ที่นั่น):
//   - ช่องทางจัดส่ง/วัน-เวลานัดรับ: CS กรอกตอนสร้างลิงก์ (แก้ได้ที่เมนู "ข้อมูลลูกค้าทำสัญญา")
//   - สถานะการจัดส่ง: อัตโนมัติ — มีเลขพัสดุเมื่อไหร่ = "จัดส่งสินค้าแล้ว"
//   - เลขพัสดุ: นำเข้าจาก MyOrder ผ่านเมนู "สำหรับแพ็คกิ้ง"
// ใช้: initCustomerInfoTab('containerElementId', currentUser) — ต้องโหลด validation.js (isoToDDMMYYYY)
// และ list-toolbar.js (listToolbarHtml) ก่อนไฟล์นี้
function initCustomerInfoTab(containerId, currentUser) {
  'use strict';
  var state = { loading: true, error: null, rows: [], filter: '', rescheduling: null, savingReschedule: false };

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function planLabelOf(planType) {
    if (planType === 'downpayment') return 'วางดาวน์';
    if (planType === 'installment') return 'เครดิตผ่าน (ผ่อนไปใช้ไป)';
    if (planType === 'cash') return 'ซื้อสด/ปิดยอด';
    return '-';
  }

  function fmtPickup(date, time) {
    var d = date ? (isoToDDMMYYYY(date) || date) : '';
    return (d + ' ' + (time ? time + ' น.' : '')).trim() || '-';
  }

  // วัน/เวลานัดรับล่าสุด + จำนวนครั้งที่เลื่อนนัด และนัดเดิมของครั้งแรก (แผนกบริการใช้แจ้งลูกค้า)
  function pickupCellHtml(r) {
    var html = esc(fmtPickup(r.pickupDate, r.pickupTime));
    var h = r.pickupHistory || [];
    if (h.length) {
      html += '<br><small style="color:#b06a00;">เลื่อนนัดแล้ว ' + h.length + ' ครั้ง (นัดเดิม ' + esc(fmtPickup(h[0].fromDate, h[0].fromTime)) + ')</small>';
    }
    return html;
  }

  var CONTRACT_BADGE_STYLE = {
    awaiting_customer: 'background:#fff3e0;color:#b06a00;',
    pending_review: 'background:#e0f2fe;color:#075985;',
    needs_correction: 'background:#fee2e2;color:#b91c1c;',
    customer_ok: 'background:#e3f5ec;color:#1f7a4d;',
    awaiting_staff_sign: 'background:#ede9fe;color:#6d28d9;',
    complete: 'background:#dcfce7;color:#15803d;',
  };
  function contractBadge(s) {
    s = s || { key: '', label: '-' };
    return '<span class="badge badge-info" style="' + (CONTRACT_BADGE_STYLE[s.key] || 'background:#f3f4f6;color:#374151;') + '">' + esc(s.label) + '</span>';
  }

  function shippingBadge(status) {
    var style = (status === 'จัดส่งสินค้าแล้ว' || status === 'ลูกค้ารับสินค้าแล้ว') ? 'background:#dcfce7;color:#15803d;' : 'background:#fff3e0;color:#b06a00;';
    return '<span class="badge badge-info" style="' + style + '">' + esc(status) + '</span>';
  }

  function matches(r) {
    var f = state.filter.trim().toLowerCase();
    if (!f) return true;
    return (r.customerName || '').toLowerCase().indexOf(f) !== -1 ||
      (r.customerId || '').toLowerCase().indexOf(f) !== -1 ||
      (r.soNumber || '').toLowerCase().indexOf(f) !== -1;
  }

  function rowsHtml() {
    // 2026-10-01 ยังไม่แสดงข้อมูลจนกว่าจะค้นหา (เหมือนเมนู "สำหรับ CS") — ไม่โชว์ลูกค้าทั้งระบบโดยไม่จำเป็น
    if (!state.filter.trim()) {
      return '<tr><td colspan="9" style="color:var(--muted);">พิมพ์เลขที่คำสั่งซื้อ SO / ชื่อลูกค้า / รหัสลูกค้า เพื่อค้นหาข้อมูล</td></tr>';
    }
    var visible = state.rows.filter(matches);
    if (!visible.length) return '<tr><td colspan="9" style="color:var(--muted);">ไม่พบรายการที่ตรงกับคำค้นหา</td></tr>';
    return visible.map(function (r) {
      var channel = r.deliveryChannel || '-';
      return '<tr>' +
        '<td style="text-align:left;">' + esc(r.soNumber || '-') + '</td>' +
        '<td>' + esc(r.customerId || '-') + '</td>' +
        '<td style="text-align:left;">' + esc(r.customerName) + '</td>' +
        '<td>' + esc(r.customerType || planLabelOf(r.planType)) + '</td>' +
        '<td>' + contractBadge(r.contractStatus) + '</td>' +
        '<td>' + esc(channel) + '</td>' +
        '<td>' + pickupCellHtml(r) + '</td>' +
        '<td>' + shippingBadge(r.shippingStatus) +
        (r.isPickup && !r.trackingNo
          ? '<br><button type="button" class="btn btn-ghost btn-sm ciBtnReschedule" data-token="' + esc(r.sessionToken) + '" data-so="' + esc(r.soNumber) + '"' + (r.pickedUpAt ? ' style="display:none;"' : '') + '>เลื่อนนัดรับ</button> ' +
            '<button type="button" class="btn btn-ghost btn-sm ciBtnPickup" data-token="' + esc(r.sessionToken) + '" data-so="' + esc(r.soNumber) + '" data-picked="' + (r.pickedUpAt ? '0' : '1') + '">' +
            (r.pickedUpAt ? 'ยกเลิกการรับสินค้า' : 'ลูกค้ารับสินค้าแล้ว') + '</button>'
          : '') + '</td>' +
        '<td>' + esc(r.trackingNo || '-') + (r.courier && r.trackingNo ? '<br><small style="color:var(--muted);">' + esc(r.courier) + '</small>' : '') + '</td>' +
        '</tr>';
    }).join('');
  }

  async function setPickedUp(token, soNumber, picked) {
    if (!window.confirm(picked ? 'ยืนยันว่าลูกค้ารับสินค้าที่สาขาแล้ว?' : 'ยกเลิกสถานะ "ลูกค้ารับสินค้าแล้ว"?')) return;
    try {
      var res = await fetch('/api/staff-actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'markPickedUp', staffName: currentUser.username, sessionToken: token, soNumber: soNumber, pickedUp: picked }),
      });
      var body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || 'บันทึกไม่สำเร็จ');
      await load();
    } catch (err) {
      window.alert('บันทึกไม่สำเร็จ: ' + err.message);
    }
  }

  function openReschedule(token, soNumber) {
    var r = state.rows.filter(function (x) { return x.sessionToken === token && x.soNumber === soNumber; })[0];
    if (!r) return;
    state.rescheduling = { token: token, soNumber: soNumber, customerName: r.customerName, currentText: fmtPickup(r.pickupDate, r.pickupTime), pickupDate: '', pickupTime: '', reason: '' };
    render();
  }

  async function saveReschedule() {
    var t = state.rescheduling;
    if (!t) return;
    if (!t.pickupDate || !t.pickupTime) { window.alert('กรุณาระบุวันที่และเวลานัดรับใหม่ให้ครบ'); return; }
    state.savingReschedule = true;
    render();
    try {
      var res = await fetch('/api/staff-actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reschedulePickup', staffName: currentUser.username, sessionToken: t.token, soNumber: t.soNumber, pickupDate: t.pickupDate, pickupTime: t.pickupTime, reason: t.reason }),
      });
      var body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || 'บันทึกไม่สำเร็จ');
      state.rescheduling = null;
      state.savingReschedule = false;
      window.alert('บันทึกการเลื่อนนัดรับสำเร็จ');
      await load();
      return;
    } catch (err) {
      window.alert('บันทึกไม่สำเร็จ: ' + err.message);
    }
    state.savingReschedule = false;
    render();
  }

  function reschedulePanelHtml() {
    var t = state.rescheduling;
    if (!t) return '';
    return '<div class="card"><h2>เลื่อนนัดรับสินค้า — ' + esc(t.soNumber) + ' (' + esc(t.customerName) + ')</h2>' +
      '<p class="hint">นัดรับเดิม: ' + esc(t.currentText) + ' — กรอกวัน/เวลานัดรับใหม่ตามที่ลูกค้าแจ้ง ระบบจะบันทึกประวัติการเลื่อนนัดไว้ และข้อมูลนี้จะไปแสดงที่ใบเบิกสินค้าของเมนู "สำหรับสต๊อค" ด้วย</p>' +
      '<div class="row2">' +
      '<div class="field"><label>วันที่นัดรับใหม่</label><div class="date-field-wrap" id="ciReschedDateWrap"><div class="date-display">' + (isoToDDMMYYYY(t.pickupDate) || 'เลือกวันที่') + '</div></div></div>' +
      '<div class="field"><label>เวลานัดรับใหม่</label><input type="time" id="ciReschedTime" value="' + esc(t.pickupTime) + '" /></div>' +
      '</div>' +
      '<div class="field"><label>เหตุผลที่เลื่อน (ไม่บังคับ)</label><input type="text" id="ciReschedReason" value="' + esc(t.reason) + '" /></div>' +
      '<button class="btn btn-primary" id="ciBtnSaveResched"' + (state.savingReschedule ? ' disabled' : '') + '>' + (state.savingReschedule ? 'กำลังบันทึก...' : 'บันทึกการเลื่อนนัด') + '</button> ' +
      '<button class="btn btn-ghost" id="ciBtnCancelResched">ยกเลิก</button></div>';
  }

  async function load() {
    state.loading = true;
    state.error = null;
    render();
    try {
      var res = await fetch('/api/cs-session-list?view=customer-info');
      var body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || 'โหลดข้อมูลไม่สำเร็จ');
      state.rows = body.rows || [];
    } catch (err) {
      state.error = 'โหลดข้อมูลไม่สำเร็จ: ' + err.message;
    }
    state.loading = false;
    render();
  }

  function render() {
    var app = document.getElementById(containerId);
    if (state.loading) { app.innerHTML = '<div class="card">กำลังโหลดข้อมูล...</div>'; return; }
    if (state.error) { app.innerHTML = '<div class="card"><p style="color:var(--danger);">' + esc(state.error) + '</p></div>'; return; }

    app.innerHTML = '<div class="card"><h2>ข้อมูลลูกค้า</h2>' +
      '<p class="hint">ข้อมูลเบื้องต้นสำหรับแผนกบริการใช้ตรวจสอบและแจ้งลูกค้า — สถานะการจัดส่งจะเปลี่ยนเป็น "จัดส่งสินค้าแล้ว" อัตโนมัติเมื่อมีเลขพัสดุนำเข้าระบบ (เมนู "สำหรับแพ็คกิ้ง") ส่วนนัดรับสาขากดปุ่ม "ลูกค้ารับสินค้าแล้ว" ได้เอง</p>' +
      listToolbarHtml({
        sortId: 'customerInfoSortOrder',
        sortOptions: [{ value: 'latest', label: 'เรียงลำดับ: ล่าสุด' }],
        sortValue: 'latest',
        searchIconId: 'customerInfoFilterIcon',
        searchInputId: 'customerInfoFilterInput',
        searchValue: state.filter,
        searchPlaceholder: 'ค้นหาชื่อลูกค้า / รหัสลูกค้า / เลขที่คำสั่งซื้อ SO',
      }) +
      '<div style="overflow-x:auto;margin-top:12px;"><table class="installment-table">' +
      '<thead><tr>' +
      '<th style="text-align:left;">เลขคำสั่งซื้อ SO</th>' +
      '<th>รหัสลูกค้า</th>' +
      '<th style="text-align:left;">ชื่อลูกค้า</th>' +
      '<th>ประเภทลูกค้า</th>' +
      '<th>สถานะการทำสัญญา</th>' +
      '<th>ช่องทางการจัดส่ง</th>' +
      '<th>วัน/เวลาที่นัดรับ</th>' +
      '<th>สถานะการจัดส่ง</th>' +
      '<th>เลขพัสดุ</th>' +
      '</tr></thead>' +
      '<tbody id="customerInfoTbody">' + rowsHtml() + '</tbody></table></div></div>' +
      reschedulePanelHtml();

    // อัปเดตแค่ tbody ตอนพิมพ์ค้นหา (ไม่ re-render ทั้งการ์ด) กัน input หลุด focus — แพทเทิร์นเดียวกับเมนูอื่น
    document.getElementById('customerInfoFilterInput').addEventListener('input', function (e) {
      state.filter = e.target.value;
      document.getElementById('customerInfoTbody').innerHTML = rowsHtml();
    });
    if (state.rescheduling) {
      var t = state.rescheduling;
      attachThaiDatePicker(document.getElementById('ciReschedDateWrap'), { value: t.pickupDate, onChange: function (iso) { t.pickupDate = iso; } });
      document.getElementById('ciReschedTime').addEventListener('input', function (e) { t.pickupTime = e.target.value; });
      document.getElementById('ciReschedReason').addEventListener('input', function (e) { t.reason = e.target.value; });
      document.getElementById('ciBtnSaveResched').addEventListener('click', saveReschedule);
      document.getElementById('ciBtnCancelResched').addEventListener('click', function () { state.rescheduling = null; render(); });
    }
    // event delegation บน tbody — ช่องค้นหาแก้แค่ tbody.innerHTML ไม่ re-render การ์ด
    document.getElementById('customerInfoTbody').addEventListener('click', function (e) {
      var rb = e.target.closest ? e.target.closest('.ciBtnReschedule') : null;
      if (rb) { openReschedule(rb.getAttribute('data-token'), rb.getAttribute('data-so')); return; }
      var b = e.target.closest ? e.target.closest('.ciBtnPickup') : null;
      if (b) setPickedUp(b.getAttribute('data-token'), b.getAttribute('data-so'), b.getAttribute('data-picked') === '1');
    });
  }

  load();
}
