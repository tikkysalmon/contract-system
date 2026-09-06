// "สำหรับสต๊อค" (2026-09-06) — แทนที่ระบบเดิมที่ดึงจาก Lark Base (ดู ระบบจัดการออเดอร์.tsx ที่ user ส่งมา
// อ้างอิง UI/PDF เดิม) ระบบใหม่ดึงข้อมูลสด 2 แหล่ง: เครดิตผ่าน/วางดาวน์ (จากเมนู "ข้อมูลลูกค้าทำสัญญา" สถานะ
// "สัญญาลูกค้าเรียบร้อย") + ซื้อสด/ปิดยอด (จาก CRM ตรงๆ — ยังไม่ได้ต่อจริง รอ endpoint list/กรองออเดอร์จาก CRM
// ดู TODO ใน api/stock-orders.js) ให้สต๊อคกำหนด "รอบการเบิก" แล้วพิมพ์ใบเบิกประจำวันเป็น PDF ก่อนพิมพ์จริง
// ใช้: initStockTab('containerElementId', currentUser)
function initStockTab(containerId, currentUser) {
  'use strict';

  var ROUND_OPTIONS = ['เช้ารอบ 1', 'เช้ารอบ 2', 'เช้ารอบ 3', 'บ่ายรอบ 1', 'บ่ายรอบ 2', 'บ่ายรอบ 3'];

  var state = {
    loading: true,
    error: null,
    orders: [],
    cashSourceReady: true,
    selected: {}, // { soNumber: true }
    filterCustomerType: 'all',
    filterQuery: '',
    filterRound: 'all',
    filterPrintStatus: 'all',
    showCancelled: false,
    assignRound: '',
    assigning: false,
    printing: false,
    cancelingSo: null, // SO ที่กำลังเปิดกล่องกรอกเหตุผลยกเลิกอยู่
    cancelReason: '',
  };

  function fmtDateTime(iso) {
    if (!iso) return '-';
    var d = new Date(iso);
    if (isNaN(d)) return '-';
    return (isoToDDMMYYYY(iso.slice(0, 10)) || '-') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  async function load() {
    state.loading = true;
    state.error = null;
    render();
    try {
      var params = new URLSearchParams({
        customerType: state.filterCustomerType,
        q: state.filterQuery,
        round: state.filterRound,
        printStatus: state.filterPrintStatus,
        showCancelled: String(state.showCancelled),
      });
      var res = await fetch('/api/stock-orders?' + params.toString());
      var body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || 'โหลดข้อมูลไม่สำเร็จ');
      state.orders = body.orders || [];
      state.cashSourceReady = !!body.cashSourceReady;
      // ล้าง selection ของ SO ที่หลุดจากรายการปัจจุบันไปแล้ว (เช่น กรองใหม่)
      var stillThere = {};
      state.orders.forEach(function (o) { if (state.selected[o.soNumber]) stillThere[o.soNumber] = true; });
      state.selected = stillThere;
    } catch (err) {
      state.error = 'โหลดข้อมูลไม่สำเร็จ: ' + err.message + ' (ถ้ายังไม่ได้รัน supabase-stock-orders.sql ต้องรันก่อน)';
    }
    state.loading = false;
    render();
  }

  function selectedOrders() {
    return state.orders.filter(function (o) { return state.selected[o.soNumber]; });
  }

  async function assignRoundToSelected() {
    var orders = selectedOrders();
    if (!orders.length) { window.alert('กรุณาติ๊กเลือกอย่างน้อย 1 รายการ'); return; }
    if (!state.assignRound) { window.alert('กรุณาเลือกรอบการเบิก'); return; }
    state.assigning = true;
    render();
    try {
      var res = await fetch('/api/stock-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'setRound',
          soNumbers: orders.map(function (o) { return o.soNumber; }),
          round: state.assignRound,
          staffName: currentUser.username,
        }),
      });
      var body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || 'บันทึกไม่สำเร็จ');
      await load();
    } catch (err) {
      window.alert('กำหนดรอบการเบิกไม่สำเร็จ: ' + err.message);
    }
    state.assigning = false;
    render();
  }

  async function markPrintedAndReload(soNumbers) {
    var res = await fetch('/api/stock-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'markPrinted', soNumbers: soNumbers, staffName: currentUser.username }),
    });
    var body = await res.json();
    if (!res.ok || body.error) throw new Error(body.error || 'อัปเดตสถานะพิมพ์ไม่สำเร็จ');
  }

  function openCancelBox(soNumber) {
    state.cancelingSo = soNumber;
    state.cancelReason = '';
    render();
  }
  function closeCancelBox() {
    state.cancelingSo = null;
    render();
  }
  async function confirmCancel() {
    var soNumber = state.cancelingSo;
    try {
      var res = await fetch('/api/stock-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', soNumber: soNumber, staffName: currentUser.username, reason: state.cancelReason }),
      });
      var body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || 'ยกเลิกไม่สำเร็จ');
      state.cancelingSo = null;
      await load();
    } catch (err) {
      window.alert('ยกเลิกไม่สำเร็จ: ' + err.message);
      render();
    }
  }

  // ---------- พิมพ์ใบเบิกประจำวัน (PDF) — เค้าโครงเดียวกับระบบเดิม (ระบบจัดการออเดอร์.tsx): หัวบริษัท/ชื่อฟอร์ม/
  // วันที่/ประเภทลูกค้า/รอบการเบิก + ตาราง ลำดับที่/รหัส SO/รหัสลูกค้า/ชื่อลูกค้า/ผู้รับสินค้า/รายการสินค้า/จำนวน
  // + ช่องเซ็น 3 จุด (ผู้ขอเบิก/ผู้ตรวจสอบสินค้า/ผู้รับสินค้า) — สร้างด้วย html2canvas+jsPDF เหมือนสัญญา
  // (contract-html-renderer.js) ไม่ใช้ jspdf-autotable ของระบบเดิม กันต้องโหลดไลบรารีเพิ่ม ----------
  function requisitionPageHtml(rows, roundLabel, pageNo, totalPages) {
    var td = 'border:1px solid #999;padding:5px;';
    var rowsHtml = rows.map(function (r, i) {
      return '<tr>' +
        '<td style="' + td + 'text-align:center;">' + (i + 1) + '</td>' +
        '<td style="' + td + '">' + r.soNumber + '</td>' +
        '<td style="' + td + '">' + (r.customerId || '-') + '</td>' +
        '<td style="' + td + '">' + r.customerName + '</td>' +
        '<td style="' + td + '">' + (r.recipientName || '-') + '</td>' +
        '<td style="' + td + '">' + r.product + (r.color ? ' (' + r.color + ')' : '') + '</td>' +
        '<td style="' + td + 'text-align:center;">1</td>' +
        '</tr>';
    }).join('');
    return '<div style="width:794px;min-height:1123px;box-sizing:border-box;padding:36px 32px;font-family:\'Sarabun\',\'Noto Sans Thai\',sans-serif;color:#1c1b19;">' +
      '<div style="text-align:center;font-weight:700;font-size:15px;">บริษัท แซลม่อน เอ็นเตอร์ไพรส์ จำกัด</div>' +
      '<div style="text-align:center;font-weight:700;font-size:14px;margin-top:2px;">ใบสรุปเบิกสินค้าประจำวัน</div>' +
      '<div style="text-align:center;font-size:12px;color:#555;margin-top:8px;">วันที่พิมพ์: ' + isoToDDMMYYYY(new Date().toISOString().slice(0, 10)) + ' &nbsp;|&nbsp; รอบการเบิก: ' + (roundLabel || '-') + ' &nbsp;|&nbsp; หน้า ' + pageNo + '/' + totalPages + '</div>' +
      '<table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:11px;">' +
      '<thead><tr style="background:#f2f2f2;">' +
      '<th style="' + td + '">ลำดับ</th>' +
      '<th style="' + td + '">เลขที่ SO</th>' +
      '<th style="' + td + '">รหัสลูกค้า</th>' +
      '<th style="' + td + '">ชื่อลูกค้า</th>' +
      '<th style="' + td + '">ผู้รับสินค้า</th>' +
      '<th style="' + td + '">รายการสินค้า</th>' +
      '<th style="' + td + '">จำนวน</th>' +
      '</tr></thead><tbody>' + rowsHtml + '</tbody></table>' +
      '<div style="display:flex;justify-content:space-around;margin-top:60px;">' +
      ['ผู้ขอเบิก / วันที่', 'ผู้ตรวจสอบสินค้า / วันที่', 'ผู้รับสินค้า / วันที่'].map(function (label) {
        return '<div style="text-align:center;font-size:11px;">' +
          '<div style="border-top:1px solid #333;width:160px;padding-top:4px;">' + label + '</div>' +
          '</div>';
      }).join('') +
      '</div>' +
      '</div>';
  }

  async function printRequisition() {
    var orders = selectedOrders().length ? selectedOrders() : filtered();
    if (!orders.length) { window.alert('ไม่มีรายการให้พิมพ์'); return; }
    if (!state.assignRound) { window.alert('กรุณาเลือกรอบการเบิกก่อนพิมพ์'); return; }
    state.printing = true;
    render();
    try {
      var ITEMS_PER_PAGE = 25;
      var totalPages = Math.ceil(orders.length / ITEMS_PER_PAGE);
      var pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
      for (var p = 0; p < totalPages; p++) {
        var chunk = orders.slice(p * ITEMS_PER_PAGE, (p + 1) * ITEMS_PER_PAGE);
        var wrap = document.createElement('div');
        wrap.style.cssText = 'position:fixed;left:-99999px;top:0;';
        wrap.innerHTML = requisitionPageHtml(chunk, state.assignRound, p + 1, totalPages);
        document.body.appendChild(wrap);
        var canvas = await window.html2canvas(wrap.firstChild, { scale: 2, backgroundColor: '#ffffff' });
        wrap.remove();
        if (p > 0) pdf.addPage();
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297);
      }
      pdf.save('ใบเบิกสินค้า_' + state.assignRound.replace(/\s+/g, '') + '_' + new Date().toISOString().slice(0, 10) + '.pdf');
      await markPrintedAndReload(orders.map(function (o) { return o.soNumber; }));
      await load();
    } catch (err) {
      window.alert('พิมพ์ใบเบิกไม่สำเร็จ: ' + err.message);
    }
    state.printing = false;
    render();
  }

  function filtered() { return state.orders; } // กรองฝั่ง server ผ่าน query params ไปแล้วตอน load()

  function sourceBadge(o) {
    return o.source === 'credit'
      ? '<span class="badge badge-info" style="background:#e0f2fe;color:#075985;">เครดิตผ่าน/วางดาวน์</span>'
      : '<span class="badge badge-info" style="background:#fef3c7;color:#92400e;">ซื้อสด/ปิดยอด</span>';
  }
  function printBadge(o) {
    if (o.cancelledAt) return '<span class="badge badge-info" style="background:#fee2e2;color:#b91c1c;">ยกเลิก</span>';
    return o.printedAt
      ? '<span class="badge badge-info" style="background:#dcfce7;color:#15803d;">พิมพ์ใบเบิกประจำวันแล้ว</span>'
      : '<span class="badge badge-info" style="background:#fff3e0;color:#b06a00;">รอพิมพ์</span>';
  }

  function render() {
    var app = document.getElementById(containerId);
    var html = '';

    html += '<div class="card"><h2>ตัวกรอง</h2>' +
      '<div class="row2">' +
      '<div class="field"><label>ประเภทลูกค้า</label><select id="stkFilterType">' +
      '<option value="all"' + (state.filterCustomerType === 'all' ? ' selected' : '') + '>ทั้งหมด</option>' +
      '<option value="credit"' + (state.filterCustomerType === 'credit' ? ' selected' : '') + '>เครดิตผ่าน/วางดาวน์</option>' +
      '<option value="cash"' + (state.filterCustomerType === 'cash' ? ' selected' : '') + '>ซื้อสด/ปิดยอด</option>' +
      '</select></div>' +
      '<div class="field"><label>ค้นหา (ชื่อ/เลข SO/รหัสลูกค้า)</label><input type="text" id="stkFilterQuery" value="' + state.filterQuery.replace(/"/g, '&quot;') + '" placeholder="พิมพ์เพื่อค้นหา" /></div>' +
      '</div>' +
      '<div class="row2">' +
      '<div class="field"><label>รอบการเบิก</label><select id="stkFilterRound">' +
      '<option value="all"' + (state.filterRound === 'all' ? ' selected' : '') + '>ทุกรอบ</option>' +
      ROUND_OPTIONS.map(function (r) { return '<option value="' + r + '"' + (state.filterRound === r ? ' selected' : '') + '>' + r + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="field"><label>สถานะการพิมพ์</label><select id="stkFilterPrintStatus">' +
      '<option value="all"' + (state.filterPrintStatus === 'all' ? ' selected' : '') + '>ทั้งหมด</option>' +
      '<option value="printed"' + (state.filterPrintStatus === 'printed' ? ' selected' : '') + '>พิมพ์ใบเบิกแล้ว</option>' +
      '<option value="unprinted"' + (state.filterPrintStatus === 'unprinted' ? ' selected' : '') + '>รอพิมพ์</option>' +
      '</select></div>' +
      '</div>' +
      '<label style="display:flex;align-items:center;gap:8px;margin-top:8px;"><input type="checkbox" id="stkShowCancelled"' + (state.showCancelled ? ' checked' : '') + ' /> แสดงรายการที่ยกเลิกแล้วด้วย</label>' +
      '</div>';

    if (!state.cashSourceReady) {
      html += '<div class="notice">ฝั่ง "ซื้อสด/ปิดยอด" ยังไม่ได้เชื่อมกับ CRM จริง (รอ endpoint list/กรองออเดอร์จาก CRM) — ตอนนี้แสดงได้เฉพาะฝั่งเครดิตผ่าน/วางดาวน์เท่านั้น</div>';
    }

    if (state.loading) {
      html += '<div class="card">กำลังโหลดข้อมูล...</div>';
    } else if (state.error) {
      html += '<div class="card"><p style="color:var(--danger);">' + state.error + '</p></div>';
    } else {
      var orders = filtered();
      html += '<div class="card"><h2>รายการออเดอร์ (' + orders.length + ' รายการ)</h2>' +
        '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:14px;">' +
        '<select id="stkAssignRound" style="padding:8px 12px;border:1px solid var(--border);border-radius:8px;">' +
        '<option value="">เลือกรอบการเบิก...</option>' +
        ROUND_OPTIONS.map(function (r) { return '<option value="' + r + '"' + (state.assignRound === r ? ' selected' : '') + '>' + r + '</option>'; }).join('') +
        '</select>' +
        '<button class="btn btn-secondary" id="stkBtnAssignRound"' + (state.assigning ? ' disabled' : '') + '>' + (state.assigning ? 'กำลังบันทึก...' : 'กำหนดรอบการเบิกให้ที่เลือก') + '</button>' +
        '<button class="btn btn-primary" id="stkBtnPrint"' + (state.printing ? ' disabled' : '') + '>' + (state.printing ? 'กำลังสร้าง PDF...' : '📄 พิมพ์ใบเบิกประจำวัน (PDF)') + '</button>' +
        '<span style="color:var(--muted);font-size:13px;">' + (selectedOrders().length > 0 ? 'เลือกไว้ ' + selectedOrders().length + ' รายการ' : 'ไม่ได้เลือก = ใช้ทุกรายการที่กรองอยู่') + '</span>' +
        '</div>' +
        '<div style="overflow-x:auto;"><table class="installment-table">' +
        '<thead><tr><th></th><th>ประเภท</th><th style="text-align:left;">เลขที่ SO</th><th>รหัสลูกค้า</th><th style="text-align:left;">ชื่อลูกค้า</th><th style="text-align:left;">สินค้า</th><th>สถานะพิมพ์</th><th>รอบการเบิก</th><th></th></tr></thead>' +
        '<tbody>' + orders.map(function (o) {
          var checked = !!state.selected[o.soNumber];
          return '<tr' + (o.cancelledAt ? ' style="opacity:0.55;"' : '') + '>' +
            '<td><input type="checkbox" class="stkRowCheck" data-so="' + o.soNumber + '"' + (checked ? ' checked' : '') + (o.cancelledAt ? ' disabled' : '') + ' /></td>' +
            '<td>' + sourceBadge(o) + '</td>' +
            '<td style="text-align:left;">' + o.soNumber + '</td>' +
            '<td>' + (o.customerId || '-') + '</td>' +
            '<td style="text-align:left;">' + o.customerName + '</td>' +
            '<td style="text-align:left;">' + o.product + (o.color ? ' (' + o.color + ')' : '') + '</td>' +
            '<td>' + printBadge(o) + '</td>' +
            '<td>' + (o.withdrawalRound || '-') + '</td>' +
            '<td>' + (o.source === 'cash' && !o.cancelledAt ? '<button type="button" class="btn btn-ghost stkBtnCancel" data-so="' + o.soNumber + '" style="color:var(--danger);">ยกเลิกออเดอร์</button>' : '') + '</td>' +
            '</tr>';
        }).join('') + (orders.length === 0 ? '<tr><td colspan="9" style="color:var(--muted);">ไม่พบรายการ</td></tr>' : '') +
        '</tbody></table></div>' +
        '</div>';
    }

    if (state.cancelingSo) {
      html += '<div class="card"><h2>ยกเลิกออเดอร์ ' + state.cancelingSo + '</h2>' +
        '<p class="hint">ใช้เฉพาะกรณี CRM ยกเลิกออเดอร์นี้เองไม่ได้ (ลูกค้ายกเลิก/เปิดบิลผิด) — ยกเลิกที่นี่จะไม่กระทบสถานะใน CRM จริง</p>' +
        '<div class="field"><label>เหตุผล</label><input type="text" id="stkCancelReason" value="' + state.cancelReason.replace(/"/g, '&quot;') + '" /></div>' +
        '<button class="btn btn-primary" id="stkBtnConfirmCancel">ยืนยันยกเลิก</button> ' +
        '<button class="btn btn-ghost" id="stkBtnCancelCancel">ปิด</button>' +
        '</div>';
    }

    app.innerHTML = html;

    document.getElementById('stkFilterType').addEventListener('change', function (e) { state.filterCustomerType = e.target.value; load(); });
    document.getElementById('stkFilterQuery').addEventListener('input', function (e) { state.filterQuery = e.target.value; });
    document.getElementById('stkFilterQuery').addEventListener('keydown', function (e) { if (e.key === 'Enter') load(); });
    document.getElementById('stkFilterRound').addEventListener('change', function (e) { state.filterRound = e.target.value; load(); });
    document.getElementById('stkFilterPrintStatus').addEventListener('change', function (e) { state.filterPrintStatus = e.target.value; load(); });
    document.getElementById('stkShowCancelled').addEventListener('change', function (e) { state.showCancelled = e.target.checked; load(); });

    if (!state.loading && !state.error) {
      Array.prototype.forEach.call(document.querySelectorAll('.stkRowCheck'), function (cb) {
        cb.addEventListener('change', function () {
          if (cb.checked) state.selected[cb.getAttribute('data-so')] = true; else delete state.selected[cb.getAttribute('data-so')];
          render();
        });
      });
      Array.prototype.forEach.call(document.querySelectorAll('.stkBtnCancel'), function (btn) {
        btn.addEventListener('click', function () { openCancelBox(btn.getAttribute('data-so')); });
      });
      var assignRoundSel = document.getElementById('stkAssignRound');
      if (assignRoundSel) assignRoundSel.addEventListener('change', function (e) { state.assignRound = e.target.value; });
      var btnAssign = document.getElementById('stkBtnAssignRound');
      if (btnAssign) btnAssign.addEventListener('click', assignRoundToSelected);
      var btnPrint = document.getElementById('stkBtnPrint');
      if (btnPrint) btnPrint.addEventListener('click', printRequisition);
    }

    if (state.cancelingSo) {
      document.getElementById('stkCancelReason').addEventListener('input', function (e) { state.cancelReason = e.target.value; });
      document.getElementById('stkBtnConfirmCancel').addEventListener('click', confirmCancel);
      document.getElementById('stkBtnCancelCancel').addEventListener('click', closeCancelBox);
    }
  }

  load();
}
