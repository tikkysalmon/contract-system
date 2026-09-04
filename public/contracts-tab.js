// "ข้อมูลลูกค้าทำสัญญา" — โมดูลกลาง ให้ทั้ง cs-review.html (หน้าเดี่ยว) และ app.html (แท็บในระบบ sidebar
// ใหม่) เรียกใช้ร่วมกัน แยกออกมาจาก cs-review.js เดิม (2026-09-03) เพื่อไม่ต้องเขียนซ้ำ 2 ที่
// ใช้: initContractsTab('containerElementId')
function initContractsTab(containerId) {
  'use strict';

  // TODO: ระบบล็อกอินพนักงานจริง (แผนก/สิทธิ์) อยู่ที่ app.js — เป็นแค่ mock ยังไม่เช็ค credential จริง
  // TODO: "สร้างลิงก์" ตอนนี้ใช้ localStorage เป็นสะพานทดสอบในเครื่องเท่านั้น เมื่อมี Supabase จริงแล้ว
  //       ต้องเปลี่ยนไปเรียก POST /api/create-session เพื่อสร้าง token จริงแทน

  var LETTERHEAD_KEY = 'contractLetterheadDataUrl';

  // ไอคอนแว่นขยาย โทนสีเทาเข้ม (var(--icon-gray)) แทนที่ปุ่ม "ค้นหา" เดิม ให้ตรงกับดีไซน์กล่องค้นหาแบบแคปซูล
  // ที่ user ส่งภาพตัวอย่างมา (2026-09-03)
  var SEARCH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle>' +
    '<line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';

  var state = {
    soNumber: '',
    loading: false,
    error: null,
    result: null,
    installmentCount: null,
    firstDueDate: '',
    linkCreated: false,
    letterheadDataUrl: localStorage.getItem(LETTERHEAD_KEY) || null,
  };

  function fmtMoney(n) { return Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  function paymentHistoryHtml(history) {
    if (!history || history.length === 0) return '';
    var rows = history.map(function (h) {
      var amountStyle = Number(h.amount) < 0 ? ' style="color:var(--danger)"' : '';
      return '<tr><td>' + (isoToDDMMYYYY(h.date) || '-') + '</td><td>' + (h.type || '-') + '</td><td>' + (h.no || '-') + '</td><td' + amountStyle + '>' + fmtMoney(h.amount) + '</td></tr>';
    }).join('');
    return '<h3 style="margin:16px 0 6px;font-size:14px;">ประวัติการชำระ (จาก CRM)</h3>' +
      '<table class="installment-table"><thead><tr><th>วันที่ชำระ</th><th>ประเภท</th><th>งวดที่</th><th>จำนวนเงิน</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  async function doLookup() {
    state.error = null;
    state.result = null;
    state.linkCreated = false;
    if (!state.soNumber.trim()) { state.error = 'กรุณากรอกเลขที่คำสั่งขาย'; render(); return; }
    state.loading = true;
    render();
    try {
      var res = await fetch('/api/crm-lookup?so=' + encodeURIComponent(state.soNumber.trim()));
      var body = await res.json();
      if (!res.ok || body.error) {
        state.error = body.error || 'เกิดข้อผิดพลาด';
      } else {
        state.result = body.data;
        state.installmentCount = body.data.installmentCountFromCrm || 12;
        if (body.data.nextDueDateFromCrm) {
          state.firstDueDate = body.data.nextDueDateFromCrm;
        } else {
          var d = new Date(); d.setMonth(d.getMonth() + 1);
          state.firstDueDate = d.toISOString().slice(0, 10);
        }
      }
    } catch (err) {
      state.error = 'เรียก API ไม่สำเร็จ: ' + err.message + ' (ถ้ารันไฟล์นี้ตรงๆ ผ่าน file:// ต้องรันผ่าน dev-server.js ก่อน — ดู README)';
    }
    state.loading = false;
    render();
  }

  function computeInstallmentAmount() {
    if (!state.result || !state.installmentCount) return 0;
    return state.result.remainingBalance / state.installmentCount;
  }

  // ให้ CS/ผู้ทดสอบดูเอกสารจริงได้ทันทีหลังสร้างลิงก์ ไม่ต้องเดินฟอร์มลูกค้าทั้งชุดก่อน (2026-09-03 user ขอ
  // "ในหน้าเว็บทดสอบต้องการเห็นตัวอย่างเอกสารจริงทั้งหมด") ใช้ข้อมูลลูกค้า placeholder ("-") ไปก่อนเพราะ
  // ตอนนี้ลูกค้ายังไม่ได้กรอกฟอร์ม — ตัวเลขราคา/ตารางผ่อนเป็นของจริงจาก CRM ครบ
  function previewContract() {
    var btn = document.getElementById('btnPreviewContract');
    var errEl = document.getElementById('previewContractErr');
    errEl.textContent = '';
    btn.disabled = true;
    btn.textContent = 'กำลังสร้างไฟล์...';
    var placeholderCustomer = {
      title: '-', firstLastName: '-', age: '-', citizenId: '-', phone: '-', nationality: 'ไทย',
      reference: { firstLastName: '-', phone: '-', relation: '-' },
    };
    fetch('/api/preview-contract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: state.lastSession, customer: placeholderCustomer }),
    })
      .then(function (res) { return res.json().then(function (body) { return { ok: res.ok, body: body }; }); })
      .then(function (result) {
        if (!result.ok) throw new Error(result.body.error || 'สร้างไฟล์ไม่สำเร็จ');
        var byteChars = atob(result.body.pdfBase64);
        var bytes = new Uint8Array(byteChars.length);
        for (var i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
        var blob = new Blob([bytes], { type: 'application/pdf' });
        window.open(URL.createObjectURL(blob), '_blank');
      })
      .catch(function (err) {
        errEl.textContent = 'สร้างไฟล์ไม่สำเร็จ: ' + err.message + ' (ถ้าเปิดหน้านี้ตรงๆ ผ่าน file:// ต้องรันผ่าน dev-server.js ก่อน)';
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = '📄 ดูตัวอย่างสัญญา (PDF)';
      });
  }

  function createLink() {
    var r = state.result;
    var contractDate = new Date().toISOString().slice(0, 10);
    var session = {
      token: 'demo-' + Date.now(),
      soNumber: r.soNumber,
      contractNo: buildContractNo(contractDate, r.soNumber), // SALMONyyyymmdd-xxxxx (2026-09-03 user ขอ)
      contractDate: contractDate,
      product: r.product,
      color: r.color,
      planType: r.planType,
      productPrice: r.productPrice,
      totalDiscount: r.totalDiscount,
      netPrice: r.netPrice,
      downPayment: r.downPayment,
      installmentsPaidSoFar: r.installmentsPaidSoFar,
      installmentsPaidCount: r.installmentsPaidCount,
      remainingBalance: r.remainingBalance,
      installmentCount: state.installmentCount,
      firstDueDate: state.firstDueDate,
      customer: r.customer,
      letterheadDataUrl: state.letterheadDataUrl || null,
    };
    localStorage.setItem('demoSession', JSON.stringify(session));
    state.linkCreated = true;
    state.lastSession = session;
    render();
  }

  function render() {
    var app = document.getElementById(containerId);
    var html = '';

    html += '<div class="card"><h2>ค้นหาคำสั่งขาย</h2>' +
      '<div class="so-search-pill">' +
      '<select id="soSearchType" class="so-search-type"><option value="so">เลขที่สั่งซื้อ SO</option></select>' +
      '<div class="so-search-input-wrap">' +
      '<span class="so-search-icon" id="btnSearch">' + SEARCH_ICON + '</span>' +
      '<input type="text" id="soInput" value="' + state.soNumber.replace(/"/g, '&quot;') + '" placeholder="' + (state.loading ? 'กำลังค้นหา...' : 'พิมพ์เพื่อค้นหา') + '"' + (state.loading ? ' disabled' : '') + ' />' +
      '</div>' +
      '</div>' +
      (state.error ? '<p style="color:var(--danger);margin-top:10px;">' + state.error + '</p>' : '') +
      '</div>';

    if (state.result) {
      var r = state.result;
      var planLabel = r.planType === 'downpayment' ? 'วางดาวน์' : 'เครดิตผ่าน (ผ่อนไปใช้ไป)';
      var accumulatedLabel = r.planType === 'downpayment' ? 'ยอดวางดาวน์' : 'ยอดผ่อนสะสม';

      html += '<div class="card"><h2>ข้อมูลจาก CRM</h2><span class="badge badge-info">' + planLabel + '</span>' +
        '<table class="installment-table" style="margin-top:10px;">' +
        row('วิธีการผ่อน', planLabel) +
        row('สินค้า', r.product + (r.color ? ' (' + r.color + ')' : '')) +
        row('ราคาสินค้า', fmtMoney(r.productPrice) + ' บาท') +
        row('ส่วนลดรวม', fmtMoney(r.totalDiscount) + ' บาท') +
        row(accumulatedLabel, fmtMoney(r.downPayment) + ' บาท') +
        (r.installmentsPaidCount > 0 ? row('งวดที่ผ่อนไปแล้ว', r.installmentsPaidCount + ' งวด (' + fmtMoney(r.installmentsPaidSoFar) + ' บาท)') : '') +
        row('ยอดคงเหลือสุทธิ', fmtMoney(r.remainingBalance) + ' บาท', true) +
        row('ชื่อลูกค้า (จาก CRM)', r.customer.firstLastName || '-') +
        '</table>' +
        paymentHistoryHtml(r.paymentHistory) +
        '</div>';

      html += '<div class="card"><h2>CS กรอกยืนยันก่อนสร้างลิงก์</h2>' +
        '<p class="hint">ตัวเลขจาก CRM เป็นแค่ค่าเริ่มต้น กรุณาตรวจสอบ/แก้ไขให้ตรงกับที่ตกลงกับลูกค้าจริงก่อนกดสร้างลิงก์</p>' +
        '<div class="row2">' +
        '<div class="field"><label>จำนวนงวดที่ผ่อน</label><input type="text" id="installmentCountInput" value="' + state.installmentCount + '" /></div>' +
        '<div class="field"><label>วันเริ่มผ่อนงวดแรก</label>' +
        '<div class="date-field-wrap" id="firstDueDateWrap">' +
        '<div class="date-display">' + (isoToDDMMYYYY(state.firstDueDate) || 'เลือกวันที่') + '</div>' +
        '</div></div>' +
        '</div>' +
        '<p>ยอดผ่อนต่องวดที่คำนวณได้: <b id="computedInstallmentAmount">' + fmtMoney(computeInstallmentAmount()) + ' บาท</b></p>' +
        '<button class="btn btn-primary" id="btnCreateLink">สร้างลิงก์ให้ลูกค้า</button>' +
        '</div>';

      if (state.linkCreated) {
        html += '<div class="card"><h2>สร้างลิงก์แล้ว</h2>' +
          '<p class="hint">เวอร์ชันทดสอบในเครื่อง — บันทึกไว้ใน localStorage ของเบราว์เซอร์นี้เท่านั้น ยังไม่ใช่ token จริงที่ส่งให้ลูกค้าได้ (รอ Supabase เชื่อมจริง)</p>' +
          '<a href="sign.html?demo=1" target="_blank" class="btn btn-secondary">เปิดฟอร์มลูกค้า (โหมดทดสอบ)</a> ' +
          '<button class="btn btn-ghost" id="btnPreviewContract" style="margin-left:8px;">📄 ดูตัวอย่างสัญญา (PDF)</button>' +
          '<div class="err" id="previewContractErr"></div>' +
          '</div>';
      }
    }

    app.innerHTML = html;

    function row(label, value, bold) {
      return '<tr><td style="text-align:left">' + label + '</td><td' + (bold ? ' style="font-weight:700"' : '') + '>' + value + '</td></tr>';
    }

    document.getElementById('soInput').addEventListener('input', function (e) { state.soNumber = e.target.value; });
    document.getElementById('soInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLookup(); });
    document.getElementById('btnSearch').addEventListener('click', doLookup);
    if (state.result) {
      document.getElementById('installmentCountInput').addEventListener('input', function (e) {
        state.installmentCount = Number(e.target.value) || 0;
        document.getElementById('computedInstallmentAmount').textContent = fmtMoney(computeInstallmentAmount()) + ' บาท';
      });
      attachThaiDatePicker(document.getElementById('firstDueDateWrap'), {
        value: state.firstDueDate,
        onChange: function (iso) { state.firstDueDate = iso; },
      });
      document.getElementById('btnCreateLink').addEventListener('click', createLink);
    }
    if (state.linkCreated) {
      document.getElementById('btnPreviewContract').addEventListener('click', previewContract);
    }
  }

  render();
}
