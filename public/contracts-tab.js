// "ข้อมูลลูกค้าทำสัญญา" — โมดูลกลาง ให้ทั้ง cs-review.html (หน้าเดี่ยว) และ app.html (แท็บในระบบ sidebar
// ใหม่) เรียกใช้ร่วมกัน แยกออกมาจาก cs-review.js เดิม (2026-09-03) เพื่อไม่ต้องเขียนซ้ำ 2 ที่
// ใช้: initContractsTab('containerElementId', currentUser, options) — currentUser: { username, department } (2026-09-07
// เพิ่มมาเพื่อบันทึกชื่อพนักงานที่กดสร้างลิงก์ ให้เมนู "ข้อมูลลูกค้าทำสัญญา" แสดงได้ — ไม่บังคับใส่ เพราะ
// cs-review.js (หน้าเดี่ยวไม่มีล็อกอิน) ยังเรียกโดยไม่ส่ง currentUser มาเหมือนเดิม)
// options.initialSoNumber (2026-09-08 เพิ่มมาให้ crm-order-detail.js เรียกใช้) — ถ้าใส่มา หน้านี้จะข้ามช่อง
// ค้นหา/ตาราง "ลิงก์แบบฟอร์มที่สร้างไว้" แล้วค้นหา SO นั้นให้ทันทีตอนโหลด (ใช้เปิดดูข้อมูล CRM ของ SO เดียว
// เป็นแท็บใหม่จากลิงก์ในตารางค้นหาด้วยชื่อ/รหัสลูกค้า — โฟลว์ "ยืนยันก่อนสร้างลิงก์"/"สร้างลิงก์" เดิมทุกอย่าง
// ใช้ร่วมกันได้เลยไม่ต้องเขียนซ้ำ)
function initContractsTab(containerId, currentUser, options) {
  'use strict';
  options = options || {};
  var singleSoMode = !!options.initialSoNumber;

  // TODO: ระบบล็อกอินพนักงานจริง (แผนก/สิทธิ์) อยู่ที่ app.js — เป็นแค่ mock ยังไม่เช็ค credential จริง
  // "สร้างลิงก์" เรียก POST /api/create-session เขียนลง Supabase จริงแล้ว (2026-09-04 — เดิมใช้ localStorage
  // เป็นสะพานทดสอบในเครื่องเท่านั้น) ได้ token จริงกลับมา ใช้สร้างลิงก์ /sign.html?token=... ที่เปิดข้ามเครื่อง/
  // เบราว์เซอร์ได้แล้ว

  var LETTERHEAD_KEY = 'contractLetterheadDataUrl';

  var state = {
    searchMode: 'so',       // 'so' | 'name' (2026-09-04 เพิ่มโหมดค้นหาด้วยชื่อลูกค้า) | 'customerId' (2026-09-08)
    soNumber: options.initialSoNumber || '',
    loading: false,
    error: null,
    result: null,           // โหมด 'so': ข้อมูล SO หลักที่ค้นหา (body.data)
    otherItems: [],         // โหมด 'so': SO อื่นของลูกค้าคนเดียวกัน (body.otherItems) — เช่น อุปกรณ์เสริมที่ CRM บังคับแยก SO
    includedSoNumbers: {},  // { soNumber: true } — SO อื่นที่ CS ติ๊กเลือกรวมเข้าลิงก์เดียวกัน (SO หลักรวมเสมอ)
    // โหมด 'name': ค้นหาชื่อ -> อาจเจอหลายคน (ambiguousCustomers ให้เลือกก่อน) -> ได้ soListLight ของคนเดียว
    // (ตารางเบา ไม่มีราคา/ตารางผ่อนเต็ม) -> CS ติ๊กเลือก -> resolve เต็มเฉพาะที่ติ๊กเป็น nameItems
    ambiguousCustomers: null,
    soListCustomer: null,
    soListLight: null,
    soListChecked: {},
    resolvingNameItems: false,
    nameItems: [],
    itemInputs: {},         // { soNumber: { installmentCount, firstDueDate } } — ยืนยันแยกต่อ SO (ใช้ร่วมทั้ง 2 โหมด)
    linkCreated: false,
    creatingLink: false,
    linkError: null,
    lastLinkUrl: null,
    letterheadDataUrl: localStorage.getItem(LETTERHEAD_KEY) || null,
    // รายการลิงก์ที่เคยสร้างไว้ทั้งหมด (2026-09-04 user ขอ ให้ตรวจสอบได้ว่าลูกค้ารายไหนสร้างลิงก์แล้ว/ยัง
    // ไม่ส่งข้อมูลกลับมา คัดลอกลิงก์เดิมส่งซ้ำได้) — โหลดครั้งเดียวตอนเปิดแท็บ รีโหลดใหม่ทุกครั้งหลังสร้างลิงก์
    // ใหม่สำเร็จ กันรายการที่เพิ่งสร้างไม่ขึ้นทันที
    sessionList: [],
    sessionListLoading: true,
    sessionListError: null,
    sessionListFilter: '',
  };

  function fmtMoney(n) { return Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fmtDateShort(iso) { return isoToDDMMYYYY(String(iso || '').slice(0, 10)) || '-'; }

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

  // SO ที่จะรวมเข้าลิงก์เดียวกันจริง (2026-09-04 ตามข้อจำกัด CRM ที่บังคับแยก SO เวลาซื้อวางดาวน์เครื่อง +
  // อุปกรณ์เสริมพร้อมกัน แต่ user ต้องการให้ลูกค้ากรอกฟอร์มครั้งเดียว) — โหมด 'so': SO หลักเสมอ + SO อื่นที่ติ๊ก
  // โหมด 'name': ทุก SO ที่ CS ติ๊กแล้วกด "ดำเนินการต่อ" จากตารางเบา (resolve เต็มแล้วทั้งหมดคือรายการที่เลือก)
  function selectedItems() {
    if (state.searchMode === 'name' || state.searchMode === 'customerId') return state.nameItems;
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

  function resetSearchResults() {
    state.error = null;
    state.result = null;
    state.otherItems = [];
    state.includedSoNumbers = {};
    state.ambiguousCustomers = null;
    state.soListCustomer = null;
    state.soListLight = null;
    state.soListChecked = {};
    state.nameItems = [];
    state.itemInputs = {};
    state.linkCreated = false;
  }

  async function doLookupBySo() {
    resetSearchResults();
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

  // ค้นหาด้วยชื่อลูกค้า (2026-09-04) — เจอ endpoint จริงจาก Network tab ของ user เอง แสดงลิสต์ SO แบบตารางเบา
  // (เหมือนหน้า CRM จริงที่ user ส่งภาพมา) ให้ CS ติ๊กเลือกก่อน ไม่ resolve ราคา/ตารางผ่อนเต็มของทุก SO ล่วงหน้า
  async function doLookupByName() {
    resetSearchResults();
    if (!state.soNumber.trim()) { state.error = 'กรุณากรอกชื่อลูกค้า'; render(); return; }
    state.loading = true;
    render();
    try {
      var res = await fetch('/api/crm-lookup?name=' + encodeURIComponent(state.soNumber.trim()));
      var body = await res.json();
      if (!res.ok || body.error) {
        state.error = body.error || 'เกิดข้อผิดพลาด';
      } else if (body.customers) {
        state.ambiguousCustomers = body.customers; // เจอมากกว่า 1 คน ให้ CS เลือกก่อน
      } else {
        state.soListCustomer = body.customer;
        state.soListLight = body.soList || [];
      }
    } catch (err) {
      state.error = 'เรียก API ไม่สำเร็จ: ' + err.message + ' (ถ้ารันไฟล์นี้ตรงๆ ผ่าน file:// ต้องรันผ่าน dev-server.js ก่อน — ดู README)';
    }
    state.loading = false;
    render();
  }

  // ค้นหาด้วยรหัสลูกค้า (2026-09-08 user ขอ) — ต่างจากค้นหาด้วยชื่อตรงที่ไม่มีปัญหาลูกค้าซ้ำชื่อกันหลายคน จึง
  // ข้ามขั้นตอน "เจอลูกค้าหลายคน" ไปแสดงตารางเบาให้ CS ติ๊กเลือก SO ได้เลย (ใช้ endpoint เดิม ?customerId=
  // ที่เดิมเรียกจากตอนเลือกลูกค้าที่ซ้ำชื่อกันเท่านั้น — ตอนนี้เรียกตรงจากช่องค้นหาได้เลย)
  async function doLookupByCustomerId() {
    resetSearchResults();
    if (!state.soNumber.trim()) { state.error = 'กรุณากรอกรหัสลูกค้า'; render(); return; }
    state.loading = true;
    render();
    try {
      var res = await fetch('/api/crm-lookup?customerId=' + encodeURIComponent(state.soNumber.trim()));
      var body = await res.json();
      if (!res.ok || body.error) {
        state.error = body.error || 'เกิดข้อผิดพลาด';
      } else {
        state.soListCustomer = body.customer || { firstLastName: '-' };
        state.soListLight = body.soList || [];
      }
    } catch (err) {
      state.error = 'เรียก API ไม่สำเร็จ: ' + err.message;
    }
    state.loading = false;
    render();
  }

  async function doSearch() {
    if (state.searchMode === 'name') await doLookupByName();
    else if (state.searchMode === 'customerId') await doLookupByCustomerId();
    else await doLookupBySo();
  }

  async function pickAmbiguousCustomer(customer) {
    state.ambiguousCustomers = null;
    state.loading = true;
    render();
    try {
      var res = await fetch('/api/crm-lookup?customerId=' + encodeURIComponent(customer.customerId));
      var body = await res.json();
      if (!res.ok || body.error) {
        state.error = body.error || 'เกิดข้อผิดพลาด';
      } else {
        state.soListCustomer = customer;
        state.soListLight = body.soList || [];
      }
    } catch (err) {
      state.error = 'เรียก API ไม่สำเร็จ: ' + err.message;
    }
    state.loading = false;
    render();
  }

  // CS ติ๊กเลือกจากตารางเบาแล้วกด "ดำเนินการต่อ" — resolve ข้อมูลเต็ม (ราคา/ตารางผ่อน) เฉพาะ SO ที่เลือกจริง
  // ทีละใบผ่าน endpoint เดิม (?so=) ใช้ตรรกะเดียวกับโหมดค้นหาด้วยเลข SO เป๊ะๆ
  async function resolveNameSelection() {
    var soNumbers = Object.keys(state.soListChecked).filter(function (so) { return state.soListChecked[so]; });
    if (!soNumbers.length) { state.error = 'กรุณาติ๊กเลือกอย่างน้อย 1 รายการ'; render(); return; }
    state.error = null;
    state.resolvingNameItems = true;
    render();
    try {
      var results = await Promise.all(soNumbers.map(function (so) {
        return fetch('/api/crm-lookup?so=' + encodeURIComponent(so)).then(function (res) { return res.json().then(function (body) { return { ok: res.ok, so: so, body: body }; }); });
      }));
      var failed = results.filter(function (r) { return !r.ok || r.body.error; });
      if (failed.length) {
        state.error = 'ดึงข้อมูลไม่สำเร็จ: ' + failed.map(function (f) { return f.so + ' (' + (f.body.error || 'error') + ')'; }).join(', ');
      } else {
        state.nameItems = results.map(function (r) { return r.body.data; });
        state.nameItems.forEach(initItemInput);
      }
    } catch (err) {
      state.error = 'เรียก API ไม่สำเร็จ: ' + err.message;
    }
    state.resolvingNameItems = false;
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
        // สร้าง PDF จริงฝั่ง browser เอง (html2canvas + jsPDF) จาก block ย่อหน้า/ตารางที่ server ส่งมา —
        // แทนที่การ render ด้วย pdf-lib ฝั่ง server แบบเดิม (2026-09-04, ดู contract-html-renderer.js)
        // CS ดูตัวอย่างนี้ก่อนลูกค้ากรอกฟอร์มเลย จึงยังไม่มีรูปแนบ/ผู้ปกครอง-ผู้ค้ำใดๆ — renderer จะข้ามหน้า
        // รูปแนบไปเองถ้าไม่มีไฟล์ (ดู buildPhotoPagesHtml ใน contract-html-renderer.js)
        return renderContractPdf(result.body.blocks, {
          title: result.body.title,
          letterheadDataUrl: flatSession.letterheadDataUrl,
          customer: placeholderCustomer,
          contractDate: flatSession.contractDate,
          hasGuardian: false,
          hasGuarantor: false,
        });
      })
      .then(function (blob) {
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
        customerId: r.customerId, // รหัสลูกค้าจาก CRM (2026-09-06) — ใช้ค้นหา/แสดงในเมนู "สำหรับสต๊อค"
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
        body: JSON.stringify({ session: session, createdBy: (currentUser && currentUser.username) || null }),
      });
      var body = await res.json();
      if (!res.ok || !body.token) throw new Error(body.error || 'สร้างลิงก์ไม่สำเร็จ');
      state.lastSessionItems = sessionItems;
      state.lastContractDate = contractDate;
      state.lastCustomer = session.customer;
      state.lastLinkUrl = location.origin + '/sign.html?token=' + body.token;
      state.linkCreated = true;
      loadSessionList(); // รีโหลดรายการลิงก์ ให้ลิงก์ที่เพิ่งสร้างขึ้นในตาราง "ลิงก์แบบฟอร์มที่สร้างไว้" ทันที
    } catch (err) {
      state.linkError = 'สร้างลิงก์ไม่สำเร็จ: ' + err.message + ' (ถ้ายังไม่ได้ตั้งค่า SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY บน server ต้องตั้งก่อน)';
    }
    state.creatingLink = false;
    render();
  }

  // รายการลิงก์ที่สร้างไว้ทั้งหมด (2026-09-04) — ให้ CS ตรวจสอบว่าลูกค้ารายไหนสร้างลิงก์แล้ว/ยังไม่ส่งข้อมูล
  // กลับมา และคัดลอกลิงก์เดิมส่งซ้ำได้ถ้ายังไม่ส่ง — ถ้าส่งแล้วให้ไปดูข้อมูลเต็มที่เมนู "ข้อมูลลูกค้าทำสัญญา" แทน
  async function loadSessionList() {
    state.sessionListLoading = true;
    state.sessionListError = null;
    render();
    try {
      var res = await fetch('/api/cs-session-list');
      var body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || 'โหลดรายการลิงก์ไม่สำเร็จ');
      state.sessionList = body.sessions || [];
    } catch (err) {
      state.sessionListError = 'โหลดรายการลิงก์ไม่สำเร็จ: ' + err.message;
    }
    state.sessionListLoading = false;
    render();
  }

  function copyLinkToken(token) {
    var url = location.origin + '/sign.html?token=' + token;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).catch(function () { window.prompt('คัดลอกลิงก์นี้:', url); });
    } else {
      window.prompt('คัดลอกลิงก์นี้:', url);
    }
  }

  function planLabelOf(planType) {
    return planType === 'downpayment' ? 'วางดาวน์' : (planType === 'installment' ? 'เครดิตผ่าน (ผ่อนไปใช้ไป)' : '-');
  }

  function filteredSessionList() {
    return state.sessionList.filter(function (s) {
      var f = state.sessionListFilter.trim().toLowerCase();
      if (!f) return true;
      if ((s.customerName || '').toLowerCase().indexOf(f) !== -1) return true;
      if (s.soNumbers.some(function (so) { return (so || '').toLowerCase().indexOf(f) !== -1; })) return true;
      return (s.items || []).some(function (it) { return (it.customerId || '').toLowerCase().indexOf(f) !== -1; });
    });
  }

  // สถานะที่ถือว่า "ทึบ" ช่องคัดลอกลิงก์ (2026-09-08 user ขอ) — เปิดไว้ (คัดลอกได้) จนกว่าสถานะการทำสัญญาจะถึง
  // "สัญญาลูกค้าเรียบร้อย" (customer_ok) เป็นต้นไป (รวมขั้นตอนหลังจากนั้นด้วย คือ awaiting_staff_sign/complete)
  // ดู _lib/contract-status.js สำหรับความหมายสถานะทั้งหมด
  var COPY_LINK_CLOSED_STATUS_KEYS = { customer_ok: true, awaiting_staff_sign: true, complete: true };

  function copyLinkCellHtml(s) {
    var status = s.contractStatus || { key: 'awaiting_customer', label: 'รอลูกค้ากรอกข้อมูลสัญญา' };
    if (COPY_LINK_CLOSED_STATUS_KEYS[status.key]) {
      return '<span style="color:var(--muted);font-size:12.5px;">' + status.label + ' — ดูที่เมนู "ข้อมูลลูกค้าทำสัญญา"</span>';
    }
    return '<button type="button" class="btn btn-ghost btnCopySessionLink" data-token="' + s.token + '">📋 คัดลอกลิงก์</button>';
  }

  // ตาราง 1 แถวต่อ 1 SO (2026-09-08 user ขอปรับคอลัมน์ — เอา "สินค้า" ออก เหลือ รหัสลูกค้า/SO/วิธีการผ่อน/
  // วันที่สร้างลิงก์/พนักงานสร้างลิงก์ + ช่องคัดลอกลิงก์ที่ปิดทึบเองเมื่อสถานะถึง "สัญญาลูกค้าเรียบร้อย")
  function sessionListRowsHtml(filtered) {
    var rows = '';
    filtered.forEach(function (s) {
      var items = (s.items && s.items.length) ? s.items : [{ soNumber: (s.soNumbers[0] || '-'), customerId: null, planType: null }];
      items.forEach(function (it) {
        rows += '<tr>' +
          '<td style="text-align:left;">' + (it.customerId || '-') + '</td>' +
          '<td style="text-align:left;">' + (it.soNumber || '-') + '</td>' +
          '<td>' + planLabelOf(it.planType) + '</td>' +
          '<td>' + fmtDateShort(s.createdAt) + '</td>' +
          '<td>' + (s.createdByName || '-') + '</td>' +
          '<td>' + copyLinkCellHtml(s) + '</td>' +
          '</tr>';
      });
    });
    return rows || '<tr><td colspan="6" style="color:var(--muted);">ไม่พบลูกค้าที่ตรงกับคำค้นหา</td></tr>';
  }

  function wireCopySessionLinkButtons() {
    Array.prototype.forEach.call(document.querySelectorAll('.btnCopySessionLink'), function (btn) {
      btn.addEventListener('click', function () {
        copyLinkToken(btn.getAttribute('data-token'));
        var original = btn.textContent;
        btn.textContent = '✅ คัดลอกแล้ว';
        setTimeout(function () { btn.textContent = original; }, 1500);
      });
    });
  }

  function sessionListHtml() {
    var h = '<div class="card"><h2>ลิงก์แบบฟอร์มที่สร้างไว้' + (state.sessionList.length ? ' (' + state.sessionList.length + ' รายการล่าสุด)' : '') + '</h2>' +
      '<p class="hint">ตรวจสอบได้ว่าลูกค้ารายไหนสร้างลิงก์แล้ว/ยังไม่ได้กรอกข้อมูลส่งกลับมา — คัดลอกลิงก์เดิมส่งซ้ำได้ถ้ายังไม่ส่งข้อมูล ถ้าส่งข้อมูลแล้วดูรายละเอียดเต็มได้ที่เมนู "ข้อมูลลูกค้าทำสัญญา"</p>';
    if (state.sessionListLoading) {
      h += '<p class="hint">กำลังโหลด...</p></div>';
      return h;
    }
    if (state.sessionListError) {
      h += '<p style="color:var(--danger);">' + state.sessionListError + '</p></div>';
      return h;
    }
    if (!state.sessionList.length) {
      h += '<p class="hint">ยังไม่เคยสร้างลิงก์เลย — ค้นหาคำสั่งขายด้านล่างแล้วกด "สร้างลิงก์ให้ลูกค้า"</p></div>';
      return h;
    }
    // ช่องกรองนี้อัปเดตแค่ <tbody id="sessionListTbody"> เอง (ไม่เรียก render() เต็มก้อน) กัน input หลุด focus
    // ทุกครั้งที่พิมพ์ — ตามแพทเทิร์นเดียวกับช่อง soInput ด้านบนที่ก็ไม่ re-render ทั้งหน้าเช่นกัน
    h += listToolbarHtml({
      sortId: 'sessionListSort',
      sortOptions: [{ value: 'latest', label: 'เรียงลำดับ: ล่าสุด' }],
      sortValue: 'latest',
      searchIconId: 'sessionListSearchIcon',
      searchInputId: 'sessionListFilterInput',
      searchValue: state.sessionListFilter,
      searchPlaceholder: 'พิมพ์ชื่อ/รหัสลูกค้า/เลขที่คำสั่งซื้อ SO เพื่อกรอง',
    }) +
      '<div style="overflow-x:auto;"><table class="installment-table">' +
      '<thead><tr><th>รหัสลูกค้า</th><th>SO</th><th>วิธีการผ่อน</th><th>วันที่สร้างลิงก์</th><th>พนักงานสร้างลิงก์</th><th>คัดลอกลิงก์</th></tr></thead>' +
      '<tbody id="sessionListTbody">' + sessionListRowsHtml(filteredSessionList()) + '</tbody>' +
      '</table></div>' +
      '</div>';
    return h;
  }

  function render() {
    var app = document.getElementById(containerId);
    var html = '';

    // ค้นหาคำสั่งขายอยู่บนสุดของหน้า (2026-09-06 user ขอ) — ก่อนหน้านี้ "ลิงก์แบบฟอร์มที่สร้างไว้" อยู่บนสุด
    // แต่ CS ใช้ช่องค้นหาเป็นงานแรกทุกครั้งที่เปิดหน้านี้ จึงย้ายมาไว้บนสุดแทน (2026-09-08 ซ่อนทั้งช่องค้นหา
    // และตาราง "ลิงก์แบบฟอร์มที่สร้างไว้" ถ้าเปิดมาจากลิงก์ "ดูข้อมูล CRM" ของ SO เดียว — ดู singleSoMode)
    if (!singleSoMode) {
      html += '<div class="card"><h2>ค้นหาคำสั่งขาย</h2>' +
        listToolbarHtml({
          sortId: 'soSortOrder',
          sortOptions: [{ value: 'latest', label: 'เรียงลำดับ: ล่าสุด' }],
          sortValue: 'latest',
          typeId: 'soSearchType',
          typeOptions: [
            { value: 'so', label: 'เลขที่สั่งซื้อ SO' },
            { value: 'name', label: 'ชื่อลูกค้า' },
            { value: 'customerId', label: 'รหัสลูกค้า' },
          ],
          typeValue: state.searchMode,
          searchIconId: 'btnSearch',
          searchInputId: 'soInput',
          searchValue: state.soNumber,
          searchPlaceholder: state.loading ? 'กำลังค้นหา...' : (state.searchMode === 'name' ? 'พิมพ์ชื่อลูกค้า' : (state.searchMode === 'customerId' ? 'พิมพ์รหัสลูกค้า' : 'พิมพ์เพื่อค้นหา')),
          searchDisabled: state.loading,
        }) +
        (state.error ? '<p style="color:var(--danger);margin-top:10px;">' + state.error + '</p>' : '') +
        '</div>';

      html += sessionListHtml();
    }

    function row(label, value, bold) {
      return '<tr><td style="text-align:left">' + label + '</td><td' + (bold ? ' style="font-weight:700"' : '') + '>' + value + '</td></tr>';
    }

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

    function createLinkAndResultHtml(items) {
      var h = '<div class="card">' +
        '<button class="btn btn-primary" id="btnCreateLink"' + (state.creatingLink ? ' disabled' : '') + '>' +
        (state.creatingLink ? 'กำลังสร้างลิงก์...' : 'สร้างลิงก์ให้ลูกค้า' + (items.length > 1 ? ' (' + items.length + ' รายการ)' : '')) + '</button>' +
        (state.linkError ? '<p style="color:var(--danger);margin-top:10px;">' + state.linkError + '</p>' : '') +
        '</div>';
      if (state.linkCreated) {
        h += '<div class="card"><h2>สร้างลิงก์แล้ว</h2>' +
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
      return h;
    }

    if (state.searchMode === 'so' && state.result) {
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

      var soItems = selectedItems();
      soItems.forEach(function (r) { html += confirmBlockHtml(r); });
      html += createLinkAndResultHtml(soItems);
    }

    if (state.searchMode === 'name' || state.searchMode === 'customerId') {
      if (state.ambiguousCustomers) {
        html += '<div class="card"><h2>เจอลูกค้าหลายคนที่ชื่อตรงกัน</h2>' +
          '<p class="hint">เลือกลูกค้าที่ต้องการ</p>' +
          state.ambiguousCustomers.map(function (c, i) {
            return '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--border);">' +
              '<span style="flex:1;">' + c.firstLastName + ' — ' + (c.telNo || '-') + ' <span style="color:var(--muted);">(' + c.productAmount + ' รายการ)</span></span>' +
              '<button type="button" class="btn btn-secondary btnPickCustomer" data-idx="' + i + '">เลือก</button>' +
              '</div>';
          }).join('') +
          '</div>';
      } else if (state.soListLight) {
        html += '<div class="card"><h2>รายการสั่งซื้อของ ' + (state.soListCustomer.firstLastName || '-') + '</h2>' +
          '<p class="hint">ติ๊กเลือก SO ที่ต้องการรวมเข้าลิงก์เดียวกัน (กรอกฟอร์ม/เซ็นชื่อครั้งเดียว ได้สัญญาแยกฉบับตาม SO) — หรือกด "ดูข้อมูล CRM" เพื่อดูรายละเอียดเต็มของ SO นั้นในแท็บใหม่</p>' +
          '<div style="overflow-x:auto;"><table class="installment-table">' +
          '<thead><tr><th></th><th style="text-align:left;">เลขที่สั่งซื้อ SO</th><th>สถานะการสั่งซื้อ</th><th>วิธีการผ่อน</th><th style="text-align:left;">ลูกค้า</th><th>เครดิตปัจจุบัน</th><th>สถานะการชำระ</th><th>เลท (วัน)</th><th>หมายเหตุ</th><th></th></tr></thead>' +
          '<tbody>' + state.soListLight.map(function (so) {
            var checked = !!state.soListChecked[so.soNumber];
            var lateStyle = Number(so.overDueDateCount) > 0 ? ' style="color:var(--danger);font-weight:700;"' : '';
            var planLabel = so.planType === 'downpayment' ? 'วางดาวน์' : (so.planType === 'installment' ? 'ผ่อนไปใช้ไป' : '-');
            return '<tr>' +
              '<td><input type="checkbox" class="soListCheck" data-so="' + so.soNumber + '"' + (checked ? ' checked' : '') + ' /></td>' +
              '<td style="text-align:left;">' + so.soNumber + '</td>' +
              '<td><span class="badge badge-warn">' + so.statusLabel + '</span></td>' +
              '<td>' + planLabel + '</td>' +
              '<td style="text-align:left;">' + (state.soListCustomer.firstLastName || '-') + '</td>' +
              '<td>' + (so.percentCredit != null ? so.percentCredit + '%' : '-') + '</td>' +
              '<td>' + (so.paymentStatus ? '<span class="badge badge-warn">' + so.paymentStatusLabel + '</span>' : '-') + '</td>' +
              '<td' + lateStyle + '>' + (so.overDueDateCount || '-') + '</td>' +
              '<td>-</td>' +
              '<td><a class="btn btn-ghost btn-sm" href="crm-order-detail.html?so=' + encodeURIComponent(so.soNumber) + '" target="_blank" style="white-space:nowrap;">ดูข้อมูล CRM</a></td>' +
              '</tr>';
          }).join('') + '</tbody></table></div>' +
          '<button class="btn btn-primary" id="btnResolveNameSelection" style="margin-top:14px;"' + (state.resolvingNameItems ? ' disabled' : '') + '>' +
          (state.resolvingNameItems ? 'กำลังดึงข้อมูล...' : 'ดำเนินการต่อ') + '</button>' +
          '</div>';
      }

      if (state.nameItems.length > 0) {
        state.nameItems.forEach(function (r) { html += itemSummaryHtml(r, r.product); });
        state.nameItems.forEach(function (r) { html += confirmBlockHtml(r); });
        html += createLinkAndResultHtml(state.nameItems);
      }
    }

    app.innerHTML = html;

    if (!singleSoMode) {
      document.getElementById('soInput').addEventListener('input', function (e) { state.soNumber = e.target.value; });
      document.getElementById('soInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') doSearch(); });
      document.getElementById('btnSearch').addEventListener('click', doSearch);
      document.getElementById('soSearchType').addEventListener('change', function (e) {
        state.searchMode = e.target.value;
        state.soNumber = '';
        resetSearchResults();
        render();
      });
    }

    if (state.searchMode === 'so' && state.result) {
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
    }

    if (state.searchMode === 'name' || state.searchMode === 'customerId') {
      if (state.ambiguousCustomers) {
        Array.prototype.forEach.call(document.querySelectorAll('.btnPickCustomer'), function (btn) {
          btn.addEventListener('click', function () {
            pickAmbiguousCustomer(state.ambiguousCustomers[Number(btn.getAttribute('data-idx'))]);
          });
        });
      }
      if (state.soListLight) {
        Array.prototype.forEach.call(document.querySelectorAll('.soListCheck'), function (cb) {
          cb.addEventListener('change', function () {
            state.soListChecked[cb.getAttribute('data-so')] = cb.checked;
          });
        });
        var btnResolve = document.getElementById('btnResolveNameSelection');
        if (btnResolve) btnResolve.addEventListener('click', resolveNameSelection);
      }
    }

    var currentItems = selectedItems();
    if (currentItems.length > 0) {
      currentItems.forEach(function (r) {
        var suffix = '__' + r.soNumber;
        var countInput = document.getElementById('installmentCountInput' + suffix);
        if (!countInput) return;
        countInput.addEventListener('input', function (e) {
          state.itemInputs[r.soNumber].installmentCount = Number(e.target.value) || 0;
          document.getElementById('computedInstallmentAmount' + suffix).textContent = fmtMoney(computeInstallmentAmountFor(r)) + ' บาท';
        });
        attachThaiDatePicker(document.getElementById('firstDueDateWrap' + suffix), {
          value: state.itemInputs[r.soNumber].firstDueDate,
          onChange: function (iso) { state.itemInputs[r.soNumber].firstDueDate = iso; },
        });
      });
      var btnCreateLink = document.getElementById('btnCreateLink');
      if (btnCreateLink) btnCreateLink.addEventListener('click', createLink);
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

    var sessionListFilterInput = document.getElementById('sessionListFilterInput');
    if (sessionListFilterInput) {
      sessionListFilterInput.addEventListener('input', function (e) {
        state.sessionListFilter = e.target.value;
        document.getElementById('sessionListTbody').innerHTML = sessionListRowsHtml(filteredSessionList());
        wireCopySessionLinkButtons();
      });
    }
    wireCopySessionLinkButtons();
  }

  render();
  if (singleSoMode) {
    doLookupBySo();
  } else {
    loadSessionList();
  }
}
