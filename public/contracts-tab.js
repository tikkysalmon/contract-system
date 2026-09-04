// "ข้อมูลลูกค้าทำสัญญา" — โมดูลกลาง ให้ทั้ง cs-review.html (หน้าเดี่ยว) และ app.html (แท็บในระบบ sidebar
// ใหม่) เรียกใช้ร่วมกัน แยกออกมาจาก cs-review.js เดิม (2026-09-03) เพื่อไม่ต้องเขียนซ้ำ 2 ที่
// ใช้: initContractsTab('containerElementId')
function initContractsTab(containerId) {
  'use strict';

  // TODO: ระบบล็อกอินพนักงานจริง (แผนก/สิทธิ์) อยู่ที่ app.js — เป็นแค่ mock ยังไม่เช็ค credential จริง
  // "สร้างลิงก์" เรียก POST /api/create-session เขียนลง Supabase จริงแล้ว (2026-09-04 — เดิมใช้ localStorage
  // เป็นสะพานทดสอบในเครื่องเท่านั้น) ได้ token จริงกลับมา ใช้สร้างลิงก์ /sign.html?token=... ที่เปิดข้ามเครื่อง/
  // เบราว์เซอร์ได้แล้ว

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
    result: null,           // ข้อมูล SO หลักที่ค้นหา (body.data)
    otherItems: [],         // SO อื่นของลูกค้าคนเดียวกัน (body.otherItems) — เช่น อุปกรณ์เสริมที่ CRM บังคับแยก SO
    includedSoNumbers: {},  // { soNumber: true } — SO อื่นที่ CS ติ๊กเลือกรวมเข้าลิงก์เดียวกัน (SO หลักรวมเสมอ)
    itemInputs: {},         // { soNumber: { installmentCount, firstDueDate } } — ยืนยันแยกต่อ SO
    linkCreated: false,
    creatingLink: false,
    linkError: null,
    lastLinkUrl: null,
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

  // ตั้งค่าเริ่มต้นของ "จำนวนงวดที่ผ่อน"/"วันเริ่มผ่อนงวดแรก" ให้ item หนึ่ง (เรียกตอนโหลด SO หลัก และตอน CS
  // ติ๊กรวม SO อื่นเข้ามาใหม่) — ไม่ทับถ้ามีอยู่แล้ว กันค่าที่ CS แก้ไปแล้วหายตอน re-render
  function initItemInput(item) {
    if (state.itemInputs[item.soNumber]) return;
    var firstDueDate = item.nextDueDateFromCrm;
    if (!firstDueDate) {
      var d = new Date(); d.setMonth(d.getMonth() + 1);
      firstDueDate = d.toISOString().slice(0, 10);
    }
    state.itemInputs[item.soNumber] = {
      installmentCount: item.installmentCountFromCrm || 12,
      firstDueDate: firstDueDate,
    };
  }

  // SO ที่จะรวมเข้าลิงก์เดียวกันจริง — SO หลักเสมอ + SO อื่นที่ CS ติ๊กเลือก (2026-09-04 ตามข้อจำกัด CRM ที่
  // บังคับแยก SO เวลาซื้อวางดาวน์เครื่อง + อุปกรณ์เสริมพร้อมกัน แต่ user ต้องการให้ลูกค้ากรอกฟอร์มครั้งเดียว)
  function selectedItems() {
    if (!state.result) return [];
    var items = [state.result];
    state.otherItems.forEach(function (it) {
      if (state.includedSoNumbers[it.soNumber]) items.push(it);
    });
    return items;
  }

  function computeInstallmentAmountFor(item) {
    var cfg = state.itemInputs[item.soNumber];
    if (!item || !cfg || !cfg.installmentCount) return 0;
    return item.remainingBalance / cfg.installmentCount;
  }

  async function doLookup() {
    state.error = null;
    state.result = null;
    state.otherItems = [];
    state.includedSoNumbers = {};
    state.itemInputs = {};
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
        state.otherItems = body.otherItems || [];
        initItemInput(state.result);
      }
    } catch (err) {
      state.error = 'เรียก API ไม่สำเร็จ: ' + err.message + ' (ถ้ารันไฟล์นี้ตรงๆ ผ่าน file:// ต้องรันผ่าน dev-server.js ก่อน — ดู README)';
    }
    state.loading = false;
    render();
  }

  // ให้ CS/ผู้ทดสอบดูเอกสารจริงได้ทันทีหลังสร้างลิงก์ ไม่ต้องเดินฟอร์มลูกค้าทั้งชุดก่อน (2026-09-03 user ขอ
  // "ในหน้าเว็บทดสอบต้องการเห็นตัวอย่างเอกสารจริงทั้งหมด") ใช้ข้อมูลลูกค้า placeholder ("-") ไปก่อนเพราะ
  // ตอนนี้ลูกค้ายังไม่ได้กรอกฟอร์ม — ตัวเลขราคา/ตารางผ่อนเป็นของจริงจาก CRM ครบ — มีหลาย SO รวมกันได้ ปุ่มดู
  // ตัวอย่างสัญญาจึงแยกทีละฉบับต่อ SO (แต่ละฉบับก็เป็น session แบบเดิม เดี่ยว ไม่ต้องแก้ preview-contract.js)
  function previewContractFor(soNumber) {
    var item = state.lastSessionItems.filter(function (it) { return it.soNumber === soNumber; })[0];
    if (!item) return;
    var btn = document.getElementById('btnPreviewContract__' + soNumber);
    var errEl = document.getElementById('previewContractErr');
    errEl.textContent = '';
    btn.disabled = true;
    btn.textContent = 'กำลังสร้างไฟล์...';
    var placeholderCustomer = {
      title: '-', firstLastName: '-', age: '-', citizenId: '-', phone: '-', nationality: 'ไทย',
      reference: { firstLastName: '-', phone: '-', relation: '-' },
    };
    var flatSession = Object.assign({
      contractDate: state.lastContractDate,
      customer: state.lastCustomer,
      letterheadDataUrl: state.letterheadDataUrl || null,
    }, item);
    fetch('/api/preview-contract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: flatSession, customer: placeholderCustomer }),
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
        btn.textContent = '📄 ดูตัวอย่างสัญญา: ' + item.product + ' (PDF)';
      });
  }

  // สร้าง session เดียวที่รวมทุก SO ที่เลือกไว้ — ลูกค้ากรอกข้อมูล/เซ็นครั้งเดียว แต่ระบบจะออกสัญญาแยกฉบับ
  // ต่อ SO (แต่ละฉบับมีตารางผ่อนของตัวเอง ตามที่ user ยืนยัน 2026-09-04 ว่า "แยกตารางผ่อนตาม SO เดิม")
  async function createLink() {
    var items = selectedItems();
    var contractDate = new Date().toISOString().slice(0, 10);
    var sessionItems = items.map(function (r) {
      var cfg = state.itemInputs[r.soNumber];
      return {
        soNumber: r.soNumber,
        contractNo: buildContractNo(contractDate, r.soNumber), // SALMONyyyymmdd-xxxxx ต่อ SO (2026-09-03 user ขอ)
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
        installmentCount: cfg.installmentCount,
        firstDueDate: cfg.firstDueDate,
      };
    });
    var session = {
      contractDate: contractDate,
      customer: items[0].customer, // สมมติลูกค้าคนเดียวกันทุก SO ที่รวม (ตรงตามสเปก — ดึงมาจาก SO เดียวกัน)
      letterheadDataUrl: state.letterheadDataUrl || null,
      items: sessionItems,
    };
    state.creatingLink = true;
    state.linkError = null;
    render();
    try {
      var res = await fetch('/api/create-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: session }),
      });
      var body = await res.json();
      if (!res.ok || !body.token) throw new Error(body.error || 'สร้างลิงก์ไม่สำเร็จ');
      state.lastSessionItems = sessionItems;
      state.lastContractDate = contractDate;
      state.lastCustomer = session.customer;
      state.lastLinkUrl = location.origin + '/sign.html?token=' + body.token;
      state.linkCreated = true;
    } catch (err) {
      state.linkError = 'สร้างลิงก์ไม่สำเร็จ: ' + err.message + ' (ถ้ายังไม่ได้ตั้งค่า SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY บน server ต้องตั้งก่อน)';
    }
    state.creatingLink = false;
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

    function itemSummaryHtml(r, title) {
      var planLabel = r.planType === 'downpayment' ? 'วางดาวน์' : 'เครดิตผ่าน (ผ่อนไปใช้ไป)';
      var accumulatedLabel = r.planType === 'downpayment' ? 'ยอดวางดาวน์' : 'ยอดผ่อนสะสม';
      return '<div class="card"><h2>' + title + '</h2><span class="badge badge-info">' + planLabel + '</span>' +
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
    }

    function confirmBlockHtml(r) {
      var cfg = state.itemInputs[r.soNumber];
      var suffix = '__' + r.soNumber;
      return '<div class="card"><h2>CS กรอกยืนยันก่อนสร้างลิงก์ — ' + r.product + '</h2>' +
        '<p class="hint">ตัวเลขจาก CRM เป็นแค่ค่าเริ่มต้น กรุณาตรวจสอบ/แก้ไขให้ตรงกับที่ตกลงกับลูกค้าจริงก่อนกดสร้างลิงก์</p>' +
        '<div class="row2">' +
        '<div class="field"><label>จำนวนงวดที่ผ่อน</label><input type="text" id="installmentCountInput' + suffix + '" data-so="' + r.soNumber + '" value="' + cfg.installmentCount + '" /></div>' +
        '<div class="field"><label>วันเริ่มผ่อนงวดแรก</label>' +
        '<div class="date-field-wrap" id="firstDueDateWrap' + suffix + '">' +
        '<div class="date-display">' + (isoToDDMMYYYY(cfg.firstDueDate) || 'เลือกวันที่') + '</div>' +
        '</div></div>' +
        '</div>' +
        '<p>ยอดผ่อนต่องวดที่คำนวณได้: <b id="computedInstallmentAmount' + suffix + '">' + fmtMoney(computeInstallmentAmountFor(r)) + ' บาท</b></p>' +
        '</div>';
    }

    function row(label, value, bold) {
      return '<tr><td style="text-align:left">' + label + '</td><td' + (bold ? ' style="font-weight:700"' : '') + '>' + value + '</td></tr>';
    }

    if (state.result) {
      html += itemSummaryHtml(state.result, 'ข้อมูลจาก CRM');

      // SO อื่นของลูกค้าคนเดียวกัน (2026-09-04) — ข้อจำกัดของ CRM: วางดาวน์เครื่อง + อุปกรณ์เสริมพร้อมกันต้อง
      // เปิดแยก SO แต่ user ต้องการให้ลูกค้ากรอกฟอร์มครั้งเดียว จึงให้ CS ติ๊กรวม SO อื่นเข้าลิงก์เดียวกันได้ตรงนี้
      // — ไม่กรองด้วยเงื่อนไขเวลา/สถานะใดๆ (2026-09-04 user ยืนยันว่าไม่ต้อง กันเคสกรองผิดตกหล่น) แสดง SO อื่น
      // ทั้งหมดของลูกค้าคนเดียวกัน (ยึดตาม customerId เดียวกันจาก CRM เป็นตัวกรองเดียว) พร้อมชื่อลูกค้ากำกับไว้ให้
      // CS เห็นชัดๆ ว่าเป็นคนเดียวกันจริงก่อนตัดสินใจติ๊ก (ไม่ใช่แค่เชื่อระบบเฉยๆ)
      if (state.otherItems.length > 0) {
        html += '<div class="card"><h2>พบคำสั่งขายอื่นของลูกค้าคนนี้</h2>' +
          '<p class="hint">ลูกค้า "' + (state.result.customer.firstLastName || '-') + '" มี SO อื่นในระบบด้วย — ตรวจชื่อให้ตรงกันก่อนติ๊กเลือกรวมเข้าลิงก์เดียวกัน (เช่น อุปกรณ์เสริมที่ CRM บังคับแยกเป็นคนละ SO) ลูกค้าจะกรอกข้อมูล/เซ็นชื่อครั้งเดียว แต่ได้สัญญาแยกฉบับตาม SO — SO ที่ไม่เกี่ยวข้องกับรายการนี้อย่าติ๊ก</p>' +
          state.otherItems.map(function (it) {
            var checked = !!state.includedSoNumbers[it.soNumber];
            return '<label style="display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--border);">' +
              '<input type="checkbox" class="otherSoCheck" data-so="' + it.soNumber + '"' + (checked ? ' checked' : '') + ' />' +
              '<span style="flex:1;">' + it.product + (it.color ? ' (' + it.color + ')' : '') + ' — ' + it.soNumber +
              '<br><span style="color:var(--muted);font-size:12.5px;">ลูกค้า: ' + (it.customer.firstLastName || '-') + '</span></span>' +
              '<b>' + fmtMoney(it.remainingBalance) + ' บาท</b>' +
              '</label>';
          }).join('') +
          '</div>';
      }

      var items = selectedItems();
      items.forEach(function (r) { html += confirmBlockHtml(r); });

      html += '<div class="card">' +
        '<button class="btn btn-primary" id="btnCreateLink"' + (state.creatingLink ? ' disabled' : '') + '>' +
        (state.creatingLink ? 'กำลังสร้างลิงก์...' : 'สร้างลิงก์ให้ลูกค้า' + (items.length > 1 ? ' (' + items.length + ' รายการ)' : '')) + '</button>' +
        (state.linkError ? '<p style="color:var(--danger);margin-top:10px;">' + state.linkError + '</p>' : '') +
        '</div>';

      if (state.linkCreated) {
        html += '<div class="card"><h2>สร้างลิงก์แล้ว</h2>' +
          '<p class="hint">ลิงก์จริงจากฐานข้อมูล ใช้ได้จากเครื่อง/เบราว์เซอร์ไหนก็ได้ ส่งให้ลูกค้าทาง LINE/SMS ได้เลย (หมดอายุใน 7 วัน)</p>' +
          '<div class="so-search-pill" style="margin-bottom:10px;">' +
          '<div class="so-search-input-wrap"><input type="text" id="linkUrlOutput" value="' + state.lastLinkUrl.replace(/"/g, '&quot;') + '" readonly /></div>' +
          '<button type="button" class="so-search-type" id="btnCopyLink" style="cursor:pointer;">📋 คัดลอก</button>' +
          '</div>' +
          '<a href="' + state.lastLinkUrl + '" target="_blank" class="btn btn-secondary">เปิดฟอร์มลูกค้า</a>' +
          '<div style="margin-top:10px;">' +
          state.lastSessionItems.map(function (item) {
            return '<button class="btn btn-ghost" id="btnPreviewContract__' + item.soNumber + '" data-so="' + item.soNumber + '" style="margin:4px 8px 4px 0;">📄 ดูตัวอย่างสัญญา: ' + item.product + ' (PDF)</button>';
          }).join('') +
          '</div>' +
          '<div class="err" id="previewContractErr"></div>' +
          '</div>';
      }
    }

    app.innerHTML = html;

    document.getElementById('soInput').addEventListener('input', function (e) { state.soNumber = e.target.value; });
    document.getElementById('soInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLookup(); });
    document.getElementById('btnSearch').addEventListener('click', doLookup);

    if (state.result) {
      Array.prototype.forEach.call(document.querySelectorAll('.otherSoCheck'), function (cb) {
        cb.addEventListener('change', function () {
          var so = cb.getAttribute('data-so');
          state.includedSoNumbers[so] = cb.checked;
          if (cb.checked) {
            var item = state.otherItems.filter(function (it) { return it.soNumber === so; })[0];
            if (item) initItemInput(item);
          }
          render();
        });
      });

      selectedItems().forEach(function (r) {
        var suffix = '__' + r.soNumber;
        document.getElementById('installmentCountInput' + suffix).addEventListener('input', function (e) {
          state.itemInputs[r.soNumber].installmentCount = Number(e.target.value) || 0;
          document.getElementById('computedInstallmentAmount' + suffix).textContent = fmtMoney(computeInstallmentAmountFor(r)) + ' บาท';
        });
        attachThaiDatePicker(document.getElementById('firstDueDateWrap' + suffix), {
          value: state.itemInputs[r.soNumber].firstDueDate,
          onChange: function (iso) { state.itemInputs[r.soNumber].firstDueDate = iso; },
        });
      });

      document.getElementById('btnCreateLink').addEventListener('click', createLink);
    }
    if (state.linkCreated) {
      state.lastSessionItems.forEach(function (item) {
        document.getElementById('btnPreviewContract__' + item.soNumber).addEventListener('click', function () {
          previewContractFor(item.soNumber);
        });
      });
      document.getElementById('btnCopyLink').addEventListener('click', function () {
        var input = document.getElementById('linkUrlOutput');
        input.select();
        navigator.clipboard && navigator.clipboard.writeText(state.lastLinkUrl).catch(function () {
          document.execCommand('copy'); // fallback เบราว์เซอร์เก่า/ไม่ใช่ https ที่ clipboard API ใช้ไม่ได้
        });
      });
    }
  }

  render();
}
