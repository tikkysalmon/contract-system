// เมนู "ข้อมูลลูกค้า" (2026-10-01 user ขอ) — รวบรวมข้อมูลลูกค้าที่ดำเนินการบนระบบนี้ไว้ที่เดียว ให้แผนกบริการ
// ตรวจสอบเบื้องต้นและแจ้งลูกค้าได้ 1 แถวต่อ 1 SO (หน้ารายการ) + หน้ารายละเอียดต่อ SO (2026-10-01) — ไม่มีข้อมูลส่วนตัวเกินความจำเป็น (ไม่มีเลขบัตร) ที่อยู่จัดส่ง/ชื่อผู้รับ/เบอร์ผู้รับอยู่ในหน้ารายละเอียดเท่านั้น
// ข้อมูลมาจาก /api/cs-session-list?view=customer-info (ดูหมายเหตุ handleCustomerInfo ที่นั่น):
//   - ช่องทางจัดส่ง/วัน-เวลานัดรับ: CS กรอกตอนสร้างลิงก์ (แก้ได้ที่เมนู "ข้อมูลลูกค้าทำสัญญา")
//   - สถานะการจัดส่ง: อัตโนมัติ — มีเลขพัสดุเมื่อไหร่ = "จัดส่งสินค้าแล้ว"
//   - เลขพัสดุ: นำเข้าจาก MyOrder ผ่านเมนู "สำหรับแพ็คกิ้ง"
// ใช้: initCustomerInfoTab('containerElementId', currentUser) — ต้องโหลด validation.js (isoToDDMMYYYY)
// และ list-toolbar.js (listToolbarHtml) ก่อนไฟล์นี้
function initCustomerInfoTab(containerId, currentUser) {
  'use strict';
  var state = { loading: true, error: null, rows: [], filter: '', detail: null };

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

  // ตารางรายการแสดงแค่ข้อมูลระบุตัวตน (SO/รหัส/ชื่อ/ประเภท) + ลิงก์ "ดูรายละเอียด" — ข้อมูลที่เหลือย้ายไปหน้า
  // รายละเอียด (2026-10-01 user ขอ ดู detailHtml)
  function rowsHtml() {
    // 2026-10-01 ยังไม่แสดงข้อมูลจนกว่าจะค้นหา (เหมือนเมนู "สำหรับ CS") — ไม่โชว์ลูกค้าทั้งระบบโดยไม่จำเป็น
    if (!state.filter.trim()) {
      return '<tr><td colspan="5" style="color:var(--muted);">พิมพ์เลขที่คำสั่งซื้อ SO / ชื่อลูกค้า / รหัสลูกค้า เพื่อค้นหาข้อมูล</td></tr>';
    }
    var visible = state.rows.filter(matches);
    if (!visible.length) return '<tr><td colspan="5" style="color:var(--muted);">ไม่พบรายการที่ตรงกับคำค้นหา</td></tr>';
    return visible.map(function (r) {
      return '<tr>' +
        '<td style="text-align:left;">' + esc(r.soNumber || '-') + '</td>' +
        '<td>' + esc(r.customerId || '-') + '</td>' +
        '<td style="text-align:left;">' + esc(r.customerName) + '</td>' +
        '<td>' + esc(r.customerType || planLabelOf(r.planType)) + '</td>' +
        '<td><a href="#" class="ciLinkDetail" data-token="' + esc(r.sessionToken) + '" data-so="' + esc(r.soNumber) + '" style="white-space:nowrap;text-decoration:underline;">ดูรายละเอียด</a></td>' +
        '</tr>';
    }).join('');
  }

  function currentDetailRow() {
    if (!state.detail) return null;
    return state.rows.filter(function (x) { return x.sessionToken === state.detail.token && x.soNumber === state.detail.so; })[0] || null;
  }

  // หน้ารายละเอียดต่อ SO — ย้ายฟิลด์จากตารางเดิมมาไว้ที่นี่ + เพิ่ม "ที่อยู่ในการจัดส่งสินค้า" (ชื่อผู้รับ/เบอร์โทรอยู่ในช่องเดียวกัน)
  function detailHtml(r) {
    function row(label, valueHtml) {
      return '<tr><th style="text-align:left;width:220px;vertical-align:top;white-space:nowrap;">' + label + '</th><td style="text-align:left;">' + valueHtml + '</td></tr>';
    }
    var addrHtml = r.shippingAddressText ? esc(r.shippingAddressText) : '<span style="color:var(--muted);">-</span>';
    var noteHtml = (r.shippingNote ? esc(r.shippingNote) : '<span style="color:var(--muted);">-</span>') +
      (r.hasSubmission ? ' <button type="button" class="btn btn-ghost btn-sm ciBtnEditNote">แก้ไข</button>' : '');
    var pickupHtml = pickupCellHtml(r) +
      (r.isPickup && !r.trackingNo && !r.pickedUpAt ? ' <button type="button" class="btn btn-ghost btn-sm ciBtnReschedule">เลื่อนนัดรับ</button>' : '');
    var shipHtml = shippingBadge(r.shippingStatus) +
      (r.isPickup && !r.trackingNo
        ? ' <button type="button" class="btn btn-ghost btn-sm ciBtnPickup" data-picked="' + (r.pickedUpAt ? '0' : '1') + '">' +
          (r.pickedUpAt ? 'ยกเลิกการรับสินค้า' : 'ลูกค้ารับสินค้าแล้ว') + '</button>'
        : '');
    var trackHtml = esc(r.trackingNo || '-') + (r.courier && r.trackingNo ? ' <small style="color:var(--muted);">(' + esc(r.courier) + ')</small>' : '');
    return '<div class="card"><p style="margin:0 0 8px;"><a href="#" id="ciLinkBack" style="text-decoration:underline;">← กลับไปรายการ</a></p>' +
      '<h2>รายละเอียดข้อมูลลูกค้า — ' + esc(r.soNumber) + '</h2>' +
      '<table class="installment-table"><tbody>' +
      row('เลขคำสั่งซื้อ SO', esc(r.soNumber || '-')) +
      row('รหัสลูกค้า', esc(r.customerId || '-')) +
      row('ชื่อลูกค้า', esc(r.customerName)) +
      row('ประเภทลูกค้า', esc(r.customerType || planLabelOf(r.planType))) +
      row('สถานะการทำสัญญา', contractBadge(r.contractStatus)) +
      row('ช่องทางการจัดส่ง', esc(r.deliveryChannel || '-') + (r.submissionId ? ' <button type="button" class="btn btn-ghost btn-sm ciBtnEditChannel">แก้ไข</button>' : '')) +
      row('วัน/เวลาที่นัดรับ', pickupHtml) +
      row('ชื่อผู้รับสินค้า', r.recipientName ? esc(r.recipientName) : '<span style="color:var(--muted);">-</span>') +
      row('เบอร์โทรศัพท์ผู้รับสินค้า', r.recipientPhone ? esc(r.recipientPhone) : '<span style="color:var(--muted);">-</span>') +
      row('ที่อยู่ในการจัดส่งสินค้า', addrHtml) +
      row('ของแถม', (r.giftItem ? esc(r.giftItem) : '<span style="color:var(--muted);">-</span>') + (r.submissionId ? ' <button type="button" class="btn btn-ghost btn-sm ciBtnEditGift">แก้ไข</button>' : '')) +
      row('หมายเหตุ', noteHtml) +
      row('สถานะการจัดส่ง', shipHtml) +
      row('เลขพัสดุ', trackHtml) +
      '</tbody></table></div>';
  }

  // หน้าแก้ไขเปิดเป็นแท็บใหม่ (2026-10-01 user ขอ) — mode: channel | gift | note | reschedule ดู customer-info-edit.js
  // ส่ง username ผ่าน query string ตรงๆ เหมือน contract-detail.html (login ยังเป็น mock) บันทึกเสร็จแท็บนั้นจะ postMessage
  // กลับมาให้หน้านี้รีเฟรชข้อมูลเอง (ดู listener ด้านล่าง)
  function openEditTab(mode, token, soNumber) {
    var url = 'customer-info-edit.html?mode=' + encodeURIComponent(mode) + '&token=' + encodeURIComponent(token) +
      '&so=' + encodeURIComponent(soNumber) + '&user=' + encodeURIComponent(currentUser.username);
    window.open(url, '_blank');
  }
  window.addEventListener('message', function (e) {
    if (e.origin === location.origin && e.data && e.data.type === 'customer-info-saved') load();
  });

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

    var detailRow = currentDetailRow();
    if (state.detail && !detailRow) state.detail = null; // รายการหายไปหลังโหลดใหม่ กลับไปหน้ารายการ

    if (detailRow) {
      app.innerHTML = detailHtml(detailRow);
      var tok = state.detail.token, so = state.detail.so;
      document.getElementById('ciLinkBack').addEventListener('click', function (e) {
        e.preventDefault();
        state.detail = null;
        render();
      });
      var q = function (sel) { return app.querySelector(sel); };
      if (q('.ciBtnEditChannel')) q('.ciBtnEditChannel').addEventListener('click', function () { openEditTab('channel', tok, so); });
      if (q('.ciBtnEditGift')) q('.ciBtnEditGift').addEventListener('click', function () { openEditTab('gift', tok, so); });
      if (q('.ciBtnEditNote')) q('.ciBtnEditNote').addEventListener('click', function () { openEditTab('note', tok, so); });
      if (q('.ciBtnReschedule')) q('.ciBtnReschedule').addEventListener('click', function () { openEditTab('reschedule', tok, so); });
      if (q('.ciBtnPickup')) q('.ciBtnPickup').addEventListener('click', function (e) {
        setPickedUp(tok, so, e.currentTarget.getAttribute('data-picked') === '1');
      });
      return;
    }

    app.innerHTML = '<div class="card"><h2>ข้อมูลลูกค้า</h2>' +
      '<p class="hint">ค้นหาด้วยเลขที่คำสั่งซื้อ SO / ชื่อลูกค้า / รหัสลูกค้า แล้วกด "ดูรายละเอียด" เพื่อดูสถานะสัญญา ช่องทางและสถานะการจัดส่ง ที่อยู่จัดส่ง เลขพัสดุ — ใช้ตรวจสอบและแจ้งลูกค้า</p>' +
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
      '<th>รายละเอียด</th>' +
      '</tr></thead>' +
      '<tbody id="customerInfoTbody">' + rowsHtml() + '</tbody></table></div></div>';

    // อัปเดตแค่ tbody ตอนพิมพ์ค้นหา (ไม่ re-render ทั้งการ์ด) กัน input หลุด focus — แพทเทิร์นเดียวกับเมนูอื่น
    document.getElementById('customerInfoFilterInput').addEventListener('input', function (e) {
      state.filter = e.target.value;
      document.getElementById('customerInfoTbody').innerHTML = rowsHtml();
    });
    // event delegation บน tbody — ช่องค้นหาแก้แค่ tbody.innerHTML ไม่ re-render การ์ด
    document.getElementById('customerInfoTbody').addEventListener('click', function (e) {
      var a = e.target.closest ? e.target.closest('.ciLinkDetail') : null;
      if (!a) return;
      e.preventDefault();
      state.detail = { token: a.getAttribute('data-token'), so: a.getAttribute('data-so') };
      render();
    });
  }

  load();
}
