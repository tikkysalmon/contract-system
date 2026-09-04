(async function () {
  'use strict';

  // ลำดับความสำคัญของแหล่งข้อมูล session (2026-09-04):
  // 1. ?token=... จริงจากลิงก์ที่ CS สร้างให้ลูกค้า -> ดึงจริงจาก Supabase ผ่าน /api/get-session
  // 2. ?demo=1 -> session ที่ CS เพิ่งสร้างในหน้าเดียวกัน (ทดสอบในเครื่องผ่าน localStorage เร็วๆ)
  // 3. ไม่มีทั้งคู่ -> window.MOCK_SESSION (เปิด sign.html ตรงๆ ทดสอบ UI เฉยๆ)
  var session = window.MOCK_SESSION;
  var realToken = new URLSearchParams(location.search).get('token');
  if (realToken) {
    try {
      var tokenRes = await fetch('/api/get-session?token=' + encodeURIComponent(realToken));
      var tokenBody = await tokenRes.json();
      if (!tokenRes.ok || !tokenBody.session) throw new Error(tokenBody.error || 'ไม่พบข้อมูลลิงก์นี้');
      session = tokenBody.session;
    } catch (err) {
      document.getElementById('app').innerHTML =
        '<div class="card"><h2>เปิดลิงก์ไม่สำเร็จ</h2><p style="color:var(--danger);">' + err.message + '</p></div>';
      return; // ไม่มีข้อมูลจริงให้แสดง หยุดตั้งแต่ตรงนี้ ไม่ render ฟอร์มต่อ
    }
  } else if (location.search.indexOf('demo=1') !== -1) {
    try {
      var stored = localStorage.getItem('demoSession');
      if (stored) session = JSON.parse(stored);
    } catch (e) { /* ใช้ MOCK_SESSION ต่อไปถ้าอ่านไม่ได้ */ }
  }

  var state = {
    stepIndex: 0,
    data: {
      giftItem: '',
      title: '', firstLastName: '', age: '', citizenId: '', phone: '',
      nationality: session.customer.nationality || 'ไทย',
      address: { detail: '', provinceId: '', provinceName: '', districtId: '', districtName: '', subdistrictId: '', subdistrictName: '', zip: '' },
      shippingAddress: { sameAsCurrent: true, detail: '', provinceId: '', provinceName: '', districtId: '', districtName: '', subdistrictId: '', subdistrictName: '', zip: '' },
      reference: { firstLastName: '', phone: '', relation: '' },
      guardian: { title: '', firstLastName: '', phone: '', citizenId: '' },
      guarantor: { title: '', firstLastName: '', age: '', phone: '', citizenId: '' },
      files: { idCard: null, selfieWithId: null, guardianId: null, guarantorId: null },
      signature: null,
      guardianSignature: null,
      guarantorSignature: null,
      agreeContract: false,
    },
    errors: {},
  };

  // เก็บแค่ "อายุ" จากลูกค้า (ไม่เก็บวันเกิด/เดือนเกิดเลย — user ตัดสินใจ 2026-09-03 ว่าไม่ต้องเพิ่มช่องเดือนเกิด
  // เพราะถ้าจะเช็คแม่นจริงควรใช้ OCR อ่านวันเกิดจากบัตร ปชช. ตอนอัปโหลด ผ่าน API key แทน ไม่ใช่ให้ลูกค้าพิมพ์เอง)
  // เกณฑ์ตอนนี้จึงเป็นแบบง่าย อายุ < 19 ปี — กฎอนุโลม 3 เดือนก่อนครบ 19 ปี (ตามสเปกเดิม) จะกลับมาใช้แบบแม่นยำ
  // อีกครั้งเมื่อมี OCR วันเกิดจริงจากบัตร (ดู TODO ที่ renderUploads และ README ข้อ 6)
  function requiresGuardianNow() {
    var age = Number(state.data.age);
    if (!age) return false;
    return age < 19;
  }
  function requiresGuarantorNow() {
    return state.data.nationality && state.data.nationality !== 'ไทย';
  }

  // ---------- step definitions ----------
  // 'order' (สรุปรายการที่ผ่อน) อยู่ก่อนข้อมูลส่วนตัวเสมอ — ให้ลูกค้าเห็นว่ากำลังทำสัญญาอะไรก่อนเริ่มกรอกข้อมูล
  var STEP_DEFS = [
    { key: 'order', title: 'รายการที่ทำสัญญา', visible: function () { return true; }, render: renderOrderSummary, validate: function () { return {}; } },
    { key: 'gift', title: 'เลือกของแถม', visible: function () { return true; }, render: renderGiftSelection, validate: validateGiftSelection },
    { key: 'personal', title: 'ข้อมูลส่วนตัว', visible: function () { return true; }, render: renderPersonal, validate: validatePersonal },
    { key: 'address', title: 'ที่อยู่และบุคคลอ้างอิง', visible: function () { return true; }, render: renderAddressStep, validate: validateAddressStep },
    { key: 'guardian', title: 'ข้อมูลผู้ปกครอง', visible: requiresGuardianNow, render: renderGuardian, validate: validateGuardian },
    { key: 'guarantor', title: 'ข้อมูลผู้ค้ำประกัน', visible: requiresGuarantorNow, render: renderGuarantor, validate: validateGuarantor },
    { key: 'uploads', title: 'อัปโหลดเอกสาร', visible: function () { return true; }, render: renderUploads, validate: validateUploads },
    { key: 'review', title: 'ตารางผ่อนชำระ', visible: function () { return true; }, render: renderReview, validate: function () { return {}; } },
    { key: 'sign', title: 'อ่านสัญญาและลงลายมือชื่อ', visible: function () { return true; }, render: renderSign, validate: validateSign },
  ];

  function visibleSteps() { return STEP_DEFS.filter(function (s) { return s.visible(); }); }
  function currentDef() { return visibleSteps()[state.stepIndex]; }

  // ---------- generic field helpers ----------
  function fieldHtml(opts) {
    // opts: {id, label, required, type, value, placeholder, hint}
    var type = opts.type || 'text';
    var inputEl = type === 'select'
      ? '<select id="' + opts.id + '">' + opts.options.map(function (o) {
          return '<option value="' + o.value + '"' + (o.value === opts.value ? ' selected' : '') + '>' + o.label + '</option>';
        }).join('') + '</select>'
      : '<input type="' + type + '" id="' + opts.id + '" value="' + (opts.value || '').replace(/"/g, '&quot;') + '" placeholder="' + (opts.placeholder || '') + '" autocomplete="off" />';
    return (
      '<div class="field" id="' + opts.id + '_field">' +
      '<label for="' + opts.id + '">' + opts.label + (opts.required ? ' <span class="req">*</span>' : '') + '</label>' +
      inputEl +
      '<div class="err">' + (opts.errText || '') + '</div>' +
      '</div>'
    );
  }

  // input[type=date] เนทีฟแสดงผลตาม locale เครื่อง ไม่ใช่ dd/mm/yyyy เสมอไป (สร้างความสับสนมาแล้ว) —
  // ซ้อน input จริง (โปร่งใส ใช้แค่เปิด picker) ไว้บนกล่องข้อความที่เราคุมฟอร์แมต dd/mm/yyyy เอง ค่า state
  // ยังเก็บเป็น ISO (yyyy-mm-dd) เหมือนเดิม ไม่กระทบโค้ดส่วนอื่น — ใช้แพทเทิร์นเดียวกับ cs-review.js
  function dateFieldHtml(opts) {
    return (
      '<div class="field" id="' + opts.id + '_field">' +
      '<label for="' + opts.id + '">' + opts.label + (opts.required ? ' <span class="req">*</span>' : '') + '</label>' +
      '<div class="date-field-wrap">' +
      '<div class="date-display" id="' + opts.id + '_display">' + (isoToDDMMYYYY(opts.value) || 'เลือกวันที่') + '</div>' +
      '<input type="date" id="' + opts.id + '" value="' + (opts.value || '') + '" />' +
      '</div>' +
      '<div class="err">' + (opts.errText || '') + '</div>' +
      '</div>'
    );
  }

  function markField(id, ok, msg) {
    var el = document.getElementById(id + '_field');
    if (!el) return;
    el.classList.remove('valid', 'invalid');
    var errEl = el.querySelector('.err');
    if (ok === null) return; // untouched, no verdict yet
    if (ok) { el.classList.add('valid'); }
    else { el.classList.add('invalid'); if (errEl && msg) errEl.textContent = msg; }
  }

  // ---------- Step: order summary (9 รายการตามที่ยืนยันกับ user) ----------
  // session.items[] อาจมีมากกว่า 1 รายการ (2026-09-04 — ข้อจำกัด CRM: วางดาวน์เครื่อง + อุปกรณ์เสริมพร้อมกัน
  // ต้องเปิดแยกเป็นคนละ SO แต่ user ต้องการให้ลูกค้ากรอกฟอร์ม/เซ็นครั้งเดียว) แสดงเป็นตารางแยกทีละ SO
  function renderOrderSummary(container) {
    var html = '<div class="card">' +
      '<h2>รายการที่ทำสัญญา</h2>' +
      '<p class="hint">กรุณาตรวจสอบยอดให้ถูกต้องก่อนเริ่มกรอกข้อมูล หากพบว่าไม่ตรงกับที่ตกลงไว้ กรุณาติดต่อพนักงานก่อนดำเนินการต่อ' +
      (session.items.length > 1 ? ' (สัญญาชุดนี้มี ' + session.items.length + ' รายการ กรอกข้อมูล/เซ็นชื่อครั้งเดียวใช้ได้กับทุกรายการ)' : '') + '</p>' +
      '</div>';

    session.items.forEach(function (s) {
      var planLabel = s.planType === 'downpayment' ? 'วางดาวน์' : 'เครดิตผ่าน (ผ่อนไปใช้ไป)'; // ป้ายที่ user ยืนยันแล้ว 2026-09-03
      var accumulatedLabel = s.planType === 'downpayment' ? 'ยอดวางดาวน์' : 'ยอดผ่อนสะสม';
      var installmentAmount = s.installmentCount ? s.remainingBalance / s.installmentCount : 0;
      var firstDue = new Date(s.firstDueDate);
      var dueDay = firstDue.getDate();

      html += '<div class="card">' +
        '<h2>' + s.product + (s.color ? ' (' + s.color + ')' : '') + '</h2>' +
        '<p><span class="badge badge-info">' + planLabel + '</span></p>' +
        '<table class="installment-table">' +
        row('วิธีการผ่อน', planLabel) +
        row('ราคาสินค้า', fmtMoney(s.productPrice) + ' บาท') +
        row('ส่วนลดรวม', fmtMoney(s.totalDiscount) + ' บาท') +
        row(accumulatedLabel, fmtMoney(s.downPayment) + ' บาท') +
        (s.installmentsPaidCount > 0 ? row('งวดที่ผ่อนไปแล้ว', s.installmentsPaidCount + ' งวด (' + fmtMoney(s.installmentsPaidSoFar) + ' บาท)') : '') +
        row('ยอดคงเหลือสุทธิ', fmtMoney(s.remainingBalance) + ' บาท', true) +
        row('จำนวนงวดที่ต้องผ่อน', s.installmentCount + ' งวด') +
        row('ยอดผ่อนต่องวด', fmtMoney(installmentAmount) + ' บาท') +
        row('วันที่ครบกำหนดชำระ (ทุกวันที่)', 'วันที่ ' + dueDay + ' ของทุกเดือน') +
        row('เริ่มผ่อนงวดแรกวันที่', fmtDate(firstDue)) +
        '</table>' +
        '</div>';
    });

    container.innerHTML = html;

    function row(label, value, bold) {
      return '<tr><td style="text-align:left">' + label + '</td><td' + (bold ? ' style="font-weight:700"' : '') + '>' + value + '</td></tr>';
    }
  }

  // ---------- Step: gift selection ----------
  // รายการของแถม อิงจากโปสเตอร์จริง 2 ใบที่ user ส่งมา (2026-09-03) แทนที่ลิสต์ Lark Single Select เดิม
  // ที่ใช้ก่อนหน้า (รายละเอียดของแถมในโปสเตอร์ไม่ตรงกับลิสต์เดิมทั้งหมด เช่น "Set iPhone 1"/"Set iPhone 2"
  // มีของข้างในต่างกันคนละชุด) — user ยืนยันการจับคู่แผน: เครดิตผ่าน (ผ่อนไปใช้ไป) = โปสเตอร์ "ของแถม 10 Set"
  // (Set iPhone/iPad/Android แบบเทค 3 ชุด + Set น่ารักๆ 7 สี), วางดาวน์ = โปสเตอร์ "สำหรับลูกค้าซื้อสด และวางดาวน์"
  // (Set น่ารักๆ 7 สีเดียวกัน + Set iPhone1/iPhone2/iPad/Android1/Android2 แบบเทค 5 ชุด)
  // planTag: 'installment' = ใช้ได้เฉพาะแผนเครดิตผ่าน, 'downpayment' = ใช้ได้เฉพาะแผนวางดาวน์, 'both' = ใช้ได้ทั้งคู่
  // TODO: ยังไม่มีรูปตัวอย่างของแถมแนบในนี้ — รอไฟล์รูปจาก user (ดูรายละเอียดใน memory/README) แล้วค่อยใส่ asset จริง
  var GIFT_OPTIONS = [
    // แผนเครดิตผ่าน (ผ่อนไปใช้ไป) เท่านั้น — จากโปสเตอร์ "ของแถม 10 Set"
    { value: 'Set iPhone (พาวเวอร์แบงค์, หูฟัง, เคส, ฟิล์ม, ที่ตั้งโทรศัพท์)', planTag: 'installment' },
    { value: 'Set iPad (เมาส์ไร้สาย, แป้นพิมพ์, กระเป๋า, ฟิล์ม, เคส, หูฟัง)', planTag: 'installment' },
    { value: 'Set Android (พาวเวอร์แบงค์, อะแดปเตอร์, สายชาร์จ Type C, ที่ตั้งโทรศัพท์, หูฟัง Type C)', planTag: 'installment' },
    // แผนวางดาวน์เท่านั้น — จากโปสเตอร์ "สำหรับลูกค้าซื้อสด และวางดาวน์"
    { value: 'Set iPhone 1 (เคส, ฟิล์ม, ที่ตั้งโทรศัพท์, หูฟัง)', planTag: 'downpayment' },
    { value: 'Set iPhone 2 (เคส, ฟิล์ม, ที่ตั้งโทรศัพท์, พาวเวอร์แบงค์)', planTag: 'downpayment' },
    { value: 'Set iPad (เคส, ฟิล์ม, แป้นพิมพ์, เมาส์)', planTag: 'downpayment' },
    { value: 'Set Android 1 (ที่ตั้งโทรศัพท์, อะแดปเตอร์, หูฟัง)', planTag: 'downpayment' },
    { value: 'Set Android 2 (ที่ตั้งโทรศัพท์, อะแดปเตอร์, พาวเวอร์แบงค์)', planTag: 'downpayment' },
    // Set น่ารักๆ 7 สี — ใช้ได้ทั้ง 2 แผน (มีในโปสเตอร์ทั้งสองใบเหมือนกัน)
    { value: 'Set ของแถมน่ารักๆ โทนฟ้า', planTag: 'both' },
    { value: 'Set ของแถมน่ารักๆ โทนม่วง', planTag: 'both' },
    { value: 'Set ของแถมน่ารักๆ โทนชมพู', planTag: 'both' },
    { value: 'Set ของแถมน่ารักๆ โทนดำ-เทา', planTag: 'both' },
    { value: 'Set ของแถมน่ารักๆ โทนเหลือง', planTag: 'both' },
    { value: 'Set ของแถมน่ารักๆ โทนเขียว', planTag: 'both' },
    { value: 'Set ของแถมน่ารักๆ คละสี', planTag: 'both' },
    { value: 'ไม่รับของแถม', planTag: 'both' },
  ];
  // ใช้แผนของรายการแรกตัดสินของแถมที่เลือกได้ (2026-09-04) — สมมติทุก SO ที่รวมในลิงก์เดียวกันเป็นแผนเดียวกัน
  // ตรงตามสเปกจริง (ซื้อพร้อมกันครั้งเดียว แค่ CRM บังคับแยก SO เท่านั้น)
  function giftOptionsForCurrentPlan() {
    return GIFT_OPTIONS.filter(function (o) { return o.planTag === 'both' || o.planTag === session.items[0].planType; });
  }
  // โปสเตอร์ของแถมจริง (2026-09-03) — ไฟล์ตั้งชื่อโดย user เองตอนเซฟไว้ใน 15_ระบบทำสัญญา แล้วคัดลอกเข้า assets/
  // "ซื้อสด_วางดาวน์" = แผนวางดาวน์, "เครดิตผ่าน_ผ่อนครบรับของ_ปิดยอด" = แผนเครดิตผ่าน (ผ่อนไปใช้ไป)
  var GIFT_POSTER_SRC = session.items[0].planType === 'downpayment' ? 'assets/gift-downpayment.jpeg' : 'assets/gift-installment.jpeg';

  function renderGiftSelection(container) {
    var options = giftOptionsForCurrentPlan();
    container.innerHTML =
      '<div class="card">' +
      '<h2>เลือกของแถม</h2>' +
      '<p class="hint">เลือกของแถมที่ต้องการรับพร้อมสัญญานี้ (แสดงเฉพาะรายการที่ใช้ได้กับแผน' + (session.items[0].planType === 'downpayment' ? 'วางดาวน์' : 'เครดิตผ่าน') + ' ของท่าน) ดูรูปตัวอย่างของแถมแต่ละ Set ด้านล่าง</p>' +
      '<img src="' + GIFT_POSTER_SRC + '" alt="ตัวอย่างของแถม" style="width:100%;border-radius:10px;border:1px solid var(--border);margin-bottom:14px;cursor:zoom-in;" id="giftPosterImg" />' +
      fieldHtml({ id: 'giftItem', label: 'รายการของแถม', required: true, type: 'select', value: state.data.giftItem,
        options: [{ value: '', label: '— เลือก —' }].concat(options.map(function (o) { return { value: o.value, label: o.value }; })) }) +
      '</div>';
    document.getElementById('giftItem').addEventListener('change', function (e) {
      state.data.giftItem = e.target.value;
      markField('giftItem', null);
    });
    // แตะรูปเพื่อเปิดดูขนาดเต็มในแท็บใหม่ (รูปต้นฉบับใหญ่ ใส่ในการ์ดพอดูออกแต่รายละเอียดเล็กอาจไม่ชัด)
    document.getElementById('giftPosterImg').addEventListener('click', function () {
      window.open(GIFT_POSTER_SRC, '_blank');
    });
  }
  function validateGiftSelection() {
    var errors = {};
    if (!state.data.giftItem) errors.giftItem = 'กรุณาเลือกรายการของแถม';
    Object.keys(errors).forEach(function (id) { markField(id, false, errors[id]); });
    if (!errors.giftItem) markField('giftItem', true);
    return errors;
  }

  // ---------- Step: personal ----------
  function renderPersonal(container) {
    var d = state.data;
    container.innerHTML =
      '<div class="card">' +
      '<h2>ข้อมูลส่วนตัวผู้เช่าซื้อ</h2>' +
      '<p class="hint">กรุณากรอกให้ตรงกับบัตรประชาชนจริง ระบบจะตรวจสอบความถูกต้องก่อนไปขั้นตอนถัดไป</p>' +
      '<div class="row2">' +
      fieldHtml({ id: 'title', label: 'คำนำหน้า', required: true, type: 'select', value: d.title,
        options: [{ value: '', label: '— เลือก —' }, { value: 'นาย', label: 'นาย' }, { value: 'นาง', label: 'นาง' }, { value: 'นางสาว', label: 'นางสาว' }, { value: 'อื่นๆ', label: 'อื่นๆ' }] }) +
      fieldHtml({ id: 'firstLastName', label: 'ชื่อ-นามสกุล', required: true, value: d.firstLastName, placeholder: 'เช่น สมชาย ใจดี' }) +
      '</div>' +
      '<div class="row2">' +
      fieldHtml({ id: 'age', label: 'อายุ (ปี)', required: true, value: d.age, placeholder: 'เช่น 25' }) +
      fieldHtml({ id: 'citizenId', label: 'เลขบัตรประชาชน', required: true, value: d.citizenId, placeholder: '13 หลัก' }) +
      '</div>' +
      '<div class="row2">' +
      fieldHtml({ id: 'phone', label: 'เบอร์โทรติดต่อ', required: true, type: 'tel', value: d.phone, placeholder: '0812345678' }) +
      fieldHtml({ id: 'nationality', label: 'สัญชาติ', required: true, type: 'select', value: d.nationality,
        options: [{ value: 'ไทย', label: 'ไทย' }, { value: 'ต่างชาติ', label: 'ต่างชาติ' }] }) +
      '</div>' +
      '</div>';

    ['title', 'firstLastName', 'age', 'citizenId', 'phone', 'nationality'].forEach(function (id) {
      document.getElementById(id).addEventListener('input', function (e) {
        d[id] = e.target.value;
        markField(id, null);
      });
      document.getElementById(id).addEventListener('change', function (e) {
        d[id] = e.target.value;
        markField(id, null);
      });
    });

    if (requiresGuardianNow()) {
      var notice = document.createElement('div');
      notice.className = 'notice';
      notice.textContent = 'อายุของลูกค้ายังไม่ครบ 19 ปี ระบบจะขอข้อมูลผู้ปกครองในขั้นตอนถัดไป';
      container.querySelector('.card').insertBefore(notice, container.querySelector('.hint').nextSibling);
    }
  }

  function validatePersonal() {
    var d = state.data, errors = {};
    if (!d.title) errors.title = 'กรุณาเลือกคำนำหน้า';
    if (!d.firstLastName || d.firstLastName.trim().length < 2) errors.firstLastName = 'กรุณากรอกชื่อ-นามสกุล';
    var ageNum = Number(d.age);
    if (!d.age || !Number.isInteger(ageNum) || ageNum < 1 || ageNum > 120) errors.age = 'กรุณากรอกอายุเป็นตัวเลข (1-120)';
    if (!isValidThaiCitizenId(d.citizenId)) errors.citizenId = 'เลขบัตรประชาชนไม่ถูกต้อง (ตรวจสอบเลขหลักที่ 13)';
    if (!isValidThaiMobile(d.phone)) errors.phone = 'เบอร์โทรไม่ถูกต้อง (ต้องเป็นเบอร์มือถือไทย 10 หลัก)';
    if (!d.nationality) errors.nationality = 'กรุณาเลือกสัญชาติ';
    Object.keys(errors).forEach(function (id) { markField(id, false, errors[id]); });
    ['title', 'firstLastName', 'age', 'citizenId', 'phone', 'nationality'].forEach(function (id) {
      if (!errors[id]) markField(id, true);
    });
    return errors;
  }

  // ---------- Step: address + reference person (2026-09-04, user ขอเพิ่ม — ใช้กับลูกค้าทุกกลุ่มเหมือนกัน
  // ไม่ว่าจะเป็นกลุ่มทั่วไป/ต่ำกว่า 19 ปี/ต่างชาติ ก็ต้องกรอกข้อ 1-3 นี้เหมือนกันหมด) ----------
  function renderAddressStep(container) {
    var d = state.data;
    var addr = d.address;
    var ship = d.shippingAddress;
    var ref = d.reference;

    container.innerHTML =
      '<div class="card">' +
      '<h2>ที่อยู่ปัจจุบัน</h2>' +
      '<p class="hint">กรอกที่อยู่ที่ติดต่อได้จริงในปัจจุบัน ระบบจะตรวจสอบว่าตำบล/อำเภอ/จังหวัดที่เลือกตรงกันจริง</p>' +
      window.attachAddressPicker.html('addr', addr) +
      '</div>' +

      '<div class="card">' +
      '<h2>ที่อยู่ในการจัดส่งสินค้า</h2>' +
      '<div class="field"><label><input type="checkbox" id="shipSameBox" ' + (ship.sameAsCurrent ? 'checked' : '') + ' /> ใช้ที่อยู่เดียวกับที่อยู่ปัจจุบัน</label></div>' +
      '<div id="shipAddrWrap" style="' + (ship.sameAsCurrent ? 'display:none;' : '') + '">' +
      window.attachAddressPicker.html('ship', ship, { detailLabel: 'บ้านเลขที่ / หมู่บ้าน / ถนน (ที่จัดส่งสินค้า)' }) +
      '</div>' +
      '</div>' +

      '<div class="card">' +
      '<h2>บุคคลอ้างอิง</h2>' +
      '<p class="hint">บุคคลที่ติดต่อได้กรณีติดต่อผู้เช่าซื้อโดยตรงไม่ได้</p>' +
      fieldHtml({ id: 'ref_firstLastName', label: 'ชื่อ-นามสกุลบุคคลอ้างอิง', required: true, value: ref.firstLastName }) +
      '<div class="row2">' +
      fieldHtml({ id: 'ref_phone', label: 'เบอร์โทรบุคคลอ้างอิง', required: true, type: 'tel', value: ref.phone }) +
      fieldHtml({ id: 'ref_relation', label: 'ความเกี่ยวข้องกับผู้เช่าซื้อ', required: true, type: 'select', value: ref.relation,
        options: [{ value: '', label: '— เลือก —' }, { value: 'บิดา/มารดา', label: 'บิดา/มารดา' }, { value: 'คู่สมรส', label: 'คู่สมรส' },
          { value: 'พี่น้อง', label: 'พี่น้อง' }, { value: 'ญาติ', label: 'ญาติ' }, { value: 'เพื่อน/เพื่อนร่วมงาน', label: 'เพื่อน/เพื่อนร่วมงาน' }, { value: 'อื่นๆ', label: 'อื่นๆ' }] }) +
      '</div>' +
      '</div>';

    window.attachAddressPicker.wire('addr', addr, function () { markField('addr_detail', null); });
    document.getElementById('shipSameBox').addEventListener('change', function (e) {
      ship.sameAsCurrent = e.target.checked;
      document.getElementById('shipAddrWrap').style.display = ship.sameAsCurrent ? 'none' : '';
    });
    window.attachAddressPicker.wire('ship', ship, function () { markField('ship_detail', null); });

    ['firstLastName', 'phone', 'relation'].forEach(function (key) {
      var id = 'ref_' + key;
      document.getElementById(id).addEventListener('input', function (e) { ref[key] = e.target.value; markField(id, null); });
      document.getElementById(id).addEventListener('change', function (e) { ref[key] = e.target.value; markField(id, null); });
    });
  }

  function validateAddressStep() {
    var d = state.data, errors = {};

    function checkAddr(addr, prefix) {
      if (!addr.detail || !addr.detail.trim()) errors[prefix + '_detail'] = 'กรุณากรอกที่อยู่';
      if (!addr.provinceId) errors[prefix + '_province'] = 'กรุณาเลือกจังหวัด';
      if (!addr.districtId) errors[prefix + '_district'] = 'กรุณาเลือกอำเภอ/เขต';
      if (!addr.subdistrictId) errors[prefix + '_subdistrict'] = 'กรุณาเลือกตำบล/แขวง';
    }
    checkAddr(d.address, 'addr');
    if (!d.shippingAddress.sameAsCurrent) checkAddr(d.shippingAddress, 'ship');

    if (!d.reference.firstLastName || d.reference.firstLastName.trim().length < 2) errors.ref_firstLastName = 'กรุณากรอกชื่อ-นามสกุลบุคคลอ้างอิง';
    if (!isValidThaiMobile(d.reference.phone)) errors.ref_phone = 'เบอร์โทรไม่ถูกต้อง (ต้องเป็นเบอร์มือถือไทย 10 หลัก)';
    if (!d.reference.relation) errors.ref_relation = 'กรุณาเลือกความเกี่ยวข้อง';

    var allIds = ['addr_detail', 'addr_province', 'addr_district', 'addr_subdistrict',
      'ship_detail', 'ship_province', 'ship_district', 'ship_subdistrict',
      'ref_firstLastName', 'ref_phone', 'ref_relation'];
    allIds.forEach(function (id) {
      if (!document.getElementById(id + '_field')) return;
      if (errors[id]) markField(id, false, errors[id]);
      else markField(id, true);
    });
    return errors;
  }

  // ---------- Step: guardian ----------
  function renderGuardian(container) {
    var g = state.data.guardian;
    container.innerHTML =
      '<div class="card">' +
      '<h2>ข้อมูลผู้ปกครอง</h2>' +
      '<p class="hint">เนื่องจากลูกค้าอายุยังไม่ครบ 19 ปีบริบูรณ์ (นอกช่วงอนุโลม) กฎหมายกำหนดให้ต้องมีผู้ปกครองยินยอม</p>' +
      '<div class="row2">' +
      fieldHtml({ id: 'g_title', label: 'คำนำหน้า', required: true, type: 'select', value: g.title,
        options: [{ value: '', label: '— เลือก —' }, { value: 'นาย', label: 'นาย' }, { value: 'นาง', label: 'นาง' }, { value: 'นางสาว', label: 'นางสาว' }] }) +
      fieldHtml({ id: 'g_firstLastName', label: 'ชื่อ-นามสกุลผู้ปกครอง', required: true, value: g.firstLastName }) +
      '</div>' +
      '<div class="row2">' +
      fieldHtml({ id: 'g_phone', label: 'เบอร์โทรผู้ปกครอง', required: true, type: 'tel', value: g.phone }) +
      fieldHtml({ id: 'g_citizenId', label: 'เลขบัตรประชาชนผู้ปกครอง', required: true, value: g.citizenId }) +
      '</div>' +
      '</div>';
    ['title', 'firstLastName', 'phone', 'citizenId'].forEach(function (key) {
      var id = 'g_' + key;
      document.getElementById(id).addEventListener('input', function (e) { g[key] = e.target.value; markField(id, null); });
      document.getElementById(id).addEventListener('change', function (e) { g[key] = e.target.value; markField(id, null); });
    });
  }
  function validateGuardian() {
    var g = state.data.guardian, errors = {};
    if (!g.title) errors.g_title = 'กรุณาเลือกคำนำหน้า';
    if (!g.firstLastName || g.firstLastName.trim().length < 2) errors.g_firstLastName = 'กรุณากรอกชื่อ-นามสกุลผู้ปกครอง';
    if (!isValidThaiMobile(g.phone)) errors.g_phone = 'เบอร์โทรไม่ถูกต้อง';
    if (!isValidThaiCitizenId(g.citizenId)) errors.g_citizenId = 'เลขบัตรประชาชนไม่ถูกต้อง';
    Object.keys(errors).forEach(function (id) { markField(id, false, errors[id]); });
    ['g_title', 'g_firstLastName', 'g_phone', 'g_citizenId'].forEach(function (id) { if (!errors[id]) markField(id, true); });
    return errors;
  }

  // ---------- Step: guarantor ----------
  function renderGuarantor(container) {
    var g = state.data.guarantor;
    container.innerHTML =
      '<div class="card">' +
      '<h2>ข้อมูลผู้ค้ำประกัน</h2>' +
      '<p class="hint">เนื่องจากลูกค้าไม่ได้ถือสัญชาติไทย จำเป็นต้องมีผู้ค้ำประกันสัญชาติไทย อายุ 23 ปีขึ้นไป</p>' +
      '<div class="row2">' +
      fieldHtml({ id: 'gt_title', label: 'คำนำหน้า', required: true, type: 'select', value: g.title,
        options: [{ value: '', label: '— เลือก —' }, { value: 'นาย', label: 'นาย' }, { value: 'นาง', label: 'นาง' }, { value: 'นางสาว', label: 'นางสาว' }] }) +
      fieldHtml({ id: 'gt_firstLastName', label: 'ชื่อ-นามสกุลผู้ค้ำประกัน', required: true, value: g.firstLastName }) +
      '</div>' +
      '<div class="row2">' +
      fieldHtml({ id: 'gt_age', label: 'อายุผู้ค้ำประกัน (ปี)', required: true, value: g.age, placeholder: 'ต้อง 23 ปีขึ้นไป' }) +
      fieldHtml({ id: 'gt_phone', label: 'เบอร์โทรผู้ค้ำประกัน', required: true, type: 'tel', value: g.phone }) +
      '</div>' +
      fieldHtml({ id: 'gt_citizenId', label: 'เลขบัตรประชาชนผู้ค้ำประกัน (ต้องเป็นคนไทย)', required: true, value: g.citizenId }) +
      '</div>';
    ['title', 'firstLastName', 'age', 'phone', 'citizenId'].forEach(function (key) {
      var id = 'gt_' + key;
      document.getElementById(id).addEventListener('input', function (e) { g[key] = e.target.value; markField(id, null); });
      document.getElementById(id).addEventListener('change', function (e) { g[key] = e.target.value; markField(id, null); });
    });
  }
  function validateGuarantor() {
    var g = state.data.guarantor, errors = {};
    if (!g.title) errors.gt_title = 'กรุณาเลือกคำนำหน้า';
    if (!g.firstLastName || g.firstLastName.trim().length < 2) errors.gt_firstLastName = 'กรุณากรอกชื่อ-นามสกุลผู้ค้ำประกัน';
    var ageNum = Number(g.age);
    if (!g.age || !Number.isInteger(ageNum) || ageNum < 23) errors.gt_age = 'ผู้ค้ำประกันต้องมีอายุ 23 ปีขึ้นไป';
    if (!isValidThaiMobile(g.phone)) errors.gt_phone = 'เบอร์โทรไม่ถูกต้อง';
    if (!isValidThaiCitizenId(g.citizenId)) errors.gt_citizenId = 'เลขบัตรประชาชนไม่ถูกต้อง (ผู้ค้ำต้องเป็นคนไทย)';
    Object.keys(errors).forEach(function (id) { markField(id, false, errors[id]); });
    ['gt_title', 'gt_firstLastName', 'gt_age', 'gt_phone', 'gt_citizenId'].forEach(function (id) { if (!errors[id]) markField(id, true); });
    return errors;
  }

  // ---------- Step: uploads ----------
  var MAX_FILE_BYTES = 5 * 1024 * 1024;
  // ตัวอย่างประกอบวิธีถ่ายรูป (SVG วาดเอง ไม่ใช่รูปถ่ายจริง — ยังไม่มีไฟล์รูปตัวอย่างจริงให้ใช้) วาดตาม
  // ภาพอ้างอิงที่ user ส่งมา 2026-09-03: ใบบัตรอ้างจากภาพ mockup บัตรประชาชนจริง (ตัวเลข/ชื่อเป็น X ทั้งหมด
  // กันเข้าใจผิดว่าเป็นข้อมูลจริง) ใบคู่บัตรอ้างจากภาพสอนถ่ายเซลฟี่คู่บัตร (คนหันหน้าตรง ถือบัตรตรงหน้าอก
  // ไม่ใช่เอียงข้างแก้มแบบที่วาดไว้รอบก่อน) มีกรอบมุมกล้องล้อมรอบสื่อว่า "จัดให้อยู่ในกรอบ ถ่ายตรงๆ"
  var EXAMPLE_SVG_ID_CARD =
    '<svg viewBox="0 0 180 116" width="140" height="90" font-family="Prompt, Sarabun, sans-serif">' +
    '<path d="M4 22V6h16M176 22V6h-16M4 94v16h16M176 94v16h-16" fill="none" stroke="#9aa1ab" stroke-width="3" stroke-linecap="round"/>' +
    '<rect x="10" y="8" width="160" height="100" rx="10" fill="#dbeeff" stroke="#5b9bd5" stroke-width="2"/>' +
    '<circle cx="24" cy="22" r="7" fill="#d92b2b"/>' +
    '<text x="35" y="21" font-size="8" font-weight="700" fill="#1c3a5e">บัตรประจำตัวประชาชน</text>' +
    '<text x="35" y="29" font-size="5" fill="#5b7a99">Thai National ID Card</text>' +
    '<rect x="140" y="14" width="16" height="11" rx="2" fill="#d4af37" stroke="#a67c1e" stroke-width="0.8"/>' +
    '<text x="16" y="42" font-size="5.5" fill="#5b7a99">เลขประจำตัวประชาชน</text>' +
    '<text x="16" y="50" font-size="7.5" font-weight="700" fill="#1c3a5e" letter-spacing="1">X XXXX XXXXX XX X</text>' +
    '<text x="16" y="61" font-size="5.5" fill="#5b7a99">ชื่อตัวและชื่อสกุล</text>' +
    '<text x="16" y="69" font-size="7" font-weight="700" fill="#1c3a5e">XXXXX XXXXXXXX</text>' +
    '<text x="16" y="80" font-size="6" fill="#334155">เกิดวันที่ XX XXX XXXX</text>' +
    '<text x="16" y="90" font-size="5" fill="#5b7a99">ที่อยู่ XX/XX หมู่ XX ถนน XXXXX</text>' +
    '<text x="16" y="97" font-size="5" fill="#5b7a99">ต.XXXXX อ.XXXXX จ.XXXXX</text>' +
    '<text x="16" y="106" font-size="4.8" fill="#5b7a99">วันออกบัตร XX XXX XXXX   วันหมดอายุ XX XXX XXXX</text>' +
    '<rect x="132" y="40" width="34" height="44" rx="4" fill="#eef2f7" stroke="#94a3b8" stroke-width="1.2"/>' +
    '<circle cx="149" cy="52" r="7" fill="#9aa7b8"/><path d="M138 76c0-8 5-13 11-13s11 5 11 13" fill="#9aa7b8"/>' +
    (function () { var b = ''; var xs = [11, 12.6, 13.4, 14.4, 15.4, 16.4]; for (var i = 0; i < xs.length; i++) { b += '<rect x="' + xs[i] + '" y="34" width="' + (i % 2 ? 0.7 : 1.1) + '" height="66" fill="#5b7a99"/>'; } return b; })() +
    '</svg>';
  var EXAMPLE_SVG_SELFIE =
    '<svg viewBox="0 0 160 148" width="126" height="117">' +
    '<path d="M4 24V6h18M156 24V6h-18M4 124v18h18M156 124v18h-18" fill="none" stroke="#9aa1ab" stroke-width="3" stroke-linecap="round"/>' +
    // ตัวคน หันหน้าตรง ไหล่กว้าง (ตามภาพอ้างอิง ไม่ใช่หันข้าง)
    '<path d="M18 146v-12c0-26 22-45 62-45s62 19 62 45v12z" fill="#43a06e"/>' +
    '<circle cx="80" cy="38" r="29" fill="#5b3a24"/><circle cx="80" cy="44" r="25" fill="#f4c9a0"/>' +
    '<circle cx="70" cy="43" r="2.4" fill="#3a2a1e"/><circle cx="90" cy="43" r="2.4" fill="#3a2a1e"/>' +
    '<path d="M69 53q11 8 22 0" stroke="#7a4a2a" stroke-width="2.2" fill="none" stroke-linecap="round"/>' +
    // มือถือบัตรขึ้นมาตรงกลางหน้าอก (ไม่เอียงข้างแก้มแบบเดิม) — วาดบัตรก่อน แล้ววาดปลายนิ้วทับขอบล่าง
    // ของบัตรทีหลัง ให้ดูเหมือนมือถือบัตรจากด้านหลังจริงๆ (นิ้วโผล่มาบนหน้าบัตรเล็กน้อย)
    '<g transform="translate(46 92) rotate(-6)">' +
    '<rect x="0" y="0" width="62" height="40" rx="6" fill="#dbeeff" stroke="#5b9bd5" stroke-width="2"/>' +
    '<circle cx="8" cy="8" r="2.4" fill="#d92b2b"/>' +
    '<rect x="6" y="15" width="17" height="20" rx="3" fill="#eef2f7" stroke="#94a3b8" stroke-width="1"/>' +
    '<circle cx="14.5" cy="22" r="4" fill="#9aa7b8"/><path d="M8 34c0-5 3-8 6.5-8s6.5 3 6.5 8" fill="#9aa7b8"/>' +
    '<rect x="28" y="10" width="28" height="4.5" rx="2.25" fill="#94a3b8"/>' +
    '<rect x="28" y="19" width="22" height="4" rx="2" fill="#cbd5e1"/>' +
    '<rect x="28" y="27" width="26" height="4" rx="2" fill="#cbd5e1"/>' +
    '<path d="M2 30c-8 2-11 12-4 18 4 3 10 2 12-3l3-13z" fill="#f4c9a0" stroke="#e0a97a" stroke-width="1"/>' +
    '<rect x="10" y="32" width="8" height="16" rx="4" fill="#f4c9a0" stroke="#e0a97a" stroke-width="0.8"/>' +
    '<rect x="20" y="34" width="8" height="15" rx="4" fill="#f4c9a0" stroke="#e0a97a" stroke-width="0.8"/>' +
    '<rect x="30" y="32" width="8" height="16" rx="4" fill="#f4c9a0" stroke="#e0a97a" stroke-width="0.8"/>' +
    '</g>' +
    '</svg>';

  function uploadBoxHtml(id, label, exampleSvg) {
    return (
      '<div class="field">' +
      '<label>' + label + ' <span class="req">*</span></label>' +
      (exampleSvg ? '<div style="text-align:center;background:#fafafa;border:1px dashed var(--border);border-radius:8px;padding:8px;margin-bottom:8px;">' +
        exampleSvg + '<div style="font-size:12px;color:var(--muted);margin-top:4px;">ตัวอย่าง (ภาพประกอบ ไม่ใช่รูปถ่ายจริง)</div></div>' : '') +
      '<div class="upload-box" id="' + id + '_box">' +
      '<input type="file" id="' + id + '_input" accept="image/*" capture="environment" />' +
      '<div class="upload-msg" id="' + id + '_msg">แตะเพื่อเลือกรูปภาพ (JPG/PNG ไม่เกิน 5MB)</div>' +
      '<img class="preview" id="' + id + '_preview" style="display:none" />' +
      '</div>' +
      '<div class="err" id="' + id + '_err"></div>' +
      '</div>'
    );
  }
  function wireUploadBox(id, onFile) {
    var box = document.getElementById(id + '_box');
    var input = document.getElementById(id + '_input');
    box.addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      var errEl = document.getElementById(id + '_err');
      var msgEl = document.getElementById(id + '_msg');
      errEl.textContent = '';
      if (!file) return;
      if (!/^image\//.test(file.type)) { errEl.textContent = 'กรุณาเลือกไฟล์รูปภาพเท่านั้น'; return; }
      if (file.size > MAX_FILE_BYTES) { errEl.textContent = 'ไฟล์ใหญ่เกิน 5MB'; return; }
      var reader = new FileReader();
      reader.onload = function () {
        box.classList.add('has-file');
        msgEl.textContent = file.name;
        var img = document.getElementById(id + '_preview');
        img.src = reader.result;
        img.style.display = 'block';
        onFile(reader.result, file);
      };
      reader.readAsDataURL(file);
    });
  }
  // TODO (2026-09-03, ยังไม่ได้ทำ): user ขอให้ตรวจสอบอายุที่กรอก (state.data.age) กับวันเกิดบนรูปบัตร
  // ประชาชนที่อัปโหลดตรงนี้ว่าตรงกันหรือไม่ (เหมือนบอท Lark ตัวอย่างที่ user ส่งมา) — ต้องใช้ OCR/vision LLM
  // อ่านตัวเลขบนรูปบัตร ยังไม่ได้เริ่มสร้างเพราะรอตัดสินใจเรื่อง ANTHROPIC_API_KEY (ดู README ข้อ 6)
  function renderUploads(container) {
    var needGuardian = requiresGuardianNow();
    var needGuarantor = requiresGuarantorNow();
    var html = '<div class="card"><h2>อัปโหลดรูปเอกสาร</h2><p class="hint">ต้องเห็นข้อมูลบนบัตรชัดเจน ไม่เบลอ ไม่มีแสงสะท้อนบัง</p>';
    html += uploadBoxHtml('u_idCard', 'รูปถ่ายบัตรประชาชนของลูกค้า', EXAMPLE_SVG_ID_CARD);
    html += uploadBoxHtml('u_selfie', 'รูปถ่ายคู่กับบัตรประชาชน (ถือบัตรคู่ใบหน้า)', EXAMPLE_SVG_SELFIE);
    if (needGuardian) html += uploadBoxHtml('u_guardianId', 'รูปถ่ายบัตรประชาชนผู้ปกครอง', EXAMPLE_SVG_ID_CARD);
    if (needGuarantor) html += uploadBoxHtml('u_guarantorId', 'รูปถ่ายบัตรประชาชนผู้ค้ำประกัน', EXAMPLE_SVG_ID_CARD);
    html += '</div>';
    container.innerHTML = html;

    wireUploadBox('u_idCard', function (dataUrl) { state.data.files.idCard = dataUrl; });
    wireUploadBox('u_selfie', function (dataUrl) { state.data.files.selfieWithId = dataUrl; });
    if (needGuardian) wireUploadBox('u_guardianId', function (dataUrl) { state.data.files.guardianId = dataUrl; });
    if (needGuarantor) wireUploadBox('u_guarantorId', function (dataUrl) { state.data.files.guarantorId = dataUrl; });
  }
  function validateUploads() {
    var errors = {};
    var f = state.data.files;
    if (!f.idCard) errors.u_idCard = true;
    if (!f.selfieWithId) errors.u_selfie = true;
    if (requiresGuardianNow() && !f.guardianId) errors.u_guardianId = true;
    if (requiresGuarantorNow() && !f.guarantorId) errors.u_guarantorId = true;
    Object.keys(errors).forEach(function (id) {
      var errEl = document.getElementById(id + '_err');
      if (errEl) errEl.textContent = 'กรุณาอัปโหลดรูปนี้ก่อนไปขั้นตอนถัดไป';
    });
    return errors;
  }

  // ---------- Step: review (ตารางผ่อนรายงวดเต็ม 12 แถว — สรุปยอดรวมแสดงไปแล้วในขั้นตอน "รายการที่ทำสัญญา") ----------
  // แยกตารางต่อ SO เดิม (2026-09-04 user ยืนยัน — ไม่รวมยอดข้ามรายการ แม้กรอกฟอร์มครั้งเดียว)
  function renderReview(container) {
    var html = '';
    session.items.forEach(function (s) {
      var rows = buildInstallmentSchedule(s.remainingBalance, s.installmentCount, s.firstDueDate);
      var rowsHtml = rows.map(function (r) {
        return '<tr><td>' + r.no + '</td><td>' + fmtDate(r.dueDate) + '</td><td>' + fmtMoney(r.amount) + '</td></tr>';
      }).join('');
      html += '<div class="card">' +
        '<h2>ตารางผ่อนชำระรายงวด — ' + s.product + '</h2>' +
        '<p class="hint">ตรวจสอบยอดให้ถูกต้องก่อนไปขั้นตอนเซ็นสัญญา หากพบว่ายอดผิด กรุณาติดต่อพนักงาน (CS) ก่อนดำเนินการต่อ</p>' +
        '<table class="installment-table"><thead><tr><th>งวดที่</th><th>วันครบกำหนด</th><th>จำนวนเงิน</th></tr></thead><tbody>' + rowsHtml + '</tbody></table>' +
        '</div>';
    });
    container.innerHTML = html;
  }
  function fmtMoney(n) { return Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fmtDate(d) { var dd = d instanceof Date ? d : new Date(d); return dd.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' }); }

  // ---------- Step: sign (summary + signature) ----------
  var sigPad = null; // { canvas, ctx, drawing, hasStroke }

  function renderSign(container) {
    var d = state.data;
    var needGuardian = requiresGuardianNow();
    var needGuarantor = requiresGuarantorNow();
    if (!d.viewedContracts) d.viewedContracts = {}; // { soNumber: true } — ต้องกดอ่านครบทุกรายการก่อนเซ็นได้

    var summaryLines = 'สัญญาเช่าซื้อระหว่าง บริษัท แซลม่อน เอ็นเตอร์ไพรส์ จำกัด ("ผู้ให้เช่าซื้อ") กับ ' +
      (d.title || '') + (d.firstLastName || '(ยังไม่ได้กรอกชื่อ)') + ' ("ผู้เช่าซื้อ")\n\n' +
      session.items.map(function (s) {
        return (s.planType === 'downpayment' ? 'แบบวางดาวน์' : 'แบบผ่อนชำระ') + ' — ' + s.product + ' ' + s.color +
          ': ยอดคงเหลือสุทธิ ' + fmtMoney(s.remainingBalance) + ' บาท | ผ่อน ' + s.installmentCount + ' งวด';
      }).join('\n') + '\n' +
      (needGuardian ? '\nมีผู้ปกครองให้ความยินยอม: ' + (d.guardian.firstLastName || '-') : '') +
      (needGuarantor ? '\nมีผู้ค้ำประกัน: ' + (d.guarantor.firstLastName || '-') : '');

    container.innerHTML =
      '<div class="card">' +
      '<h2>สรุปสัญญาก่อนลงลายมือชื่อ</h2>' +
      '<div class="contract-text">' + summaryLines + '</div>' +
      session.items.map(function (s) {
        return '<button type="button" class="btn btn-secondary btnReadContract" data-so="' + s.soNumber + '" style="margin-top:12px;width:100%;">' +
          '📄 อ่านสัญญาฉบับเต็ม: ' + s.product + ' (PDF)</button>';
      }).join('') +
      '<p class="err" id="contractPdfErr" style="margin-top:6px;"></p>' +
      '<div class="field" style="margin-top:14px;">' +
      '<label><input type="checkbox" id="agreeBox" /> ข้าพเจ้าได้อ่านและยอมรับเงื่อนไขในสัญญาฉบับเต็มทุกฉบับที่แนบไว้ข้างต้น</label>' +
      '<p class="err" id="agree_err"></p>' +
      '</div>' +
      '</div>' +

      '<div class="card">' +
      '<h2>ลายมือชื่อผู้เช่าซื้อ</h2>' +
      '<p class="hint">ใช้นิ้วหรือปากกาสไตลัสวาดลายเซ็นในกรอบด้านล่าง</p>' +
      '<div class="sig-pad-wrap"><canvas id="sigCanvas"></canvas></div>' +
      '<div class="sig-tools"><button type="button" class="btn btn-ghost" id="sigClear">ล้างลายเซ็น</button></div>' +
      '<div class="err" id="sig_err"></div>' +
      '</div>' +

      (needGuardian ? signatureUploadCardHtml('guardianSig', 'ลายมือชื่อผู้ปกครอง') : '') +
      (needGuarantor ? signatureUploadCardHtml('guarantorSig', 'ลายมือชื่อผู้ค้ำประกัน') : '') +
      '<p class="err" id="submitErr" style="margin-top:10px;"></p>';

    document.getElementById('agreeBox').checked = !!d.agreeContract;
    document.getElementById('agreeBox').addEventListener('change', function (e) { d.agreeContract = e.target.checked; });
    Array.prototype.forEach.call(document.querySelectorAll('.btnReadContract'), function (btn) {
      btn.addEventListener('click', function () { openContractPdf(btn.getAttribute('data-so'), btn); });
    });

    setupSignaturePad();
    if (needGuardian) setupSignatureUploadTool('guardianSig', function (dataUrl) { d.guardianSignature = dataUrl; });
    if (needGuarantor) setupSignatureUploadTool('guarantorSig', function (dataUrl) { d.guarantorSignature = dataUrl; });
  }

  // เรียก /api/preview-contract สร้าง PDF ตัวอย่างสัญญาจริง (เติมข้อมูลลง master template จริง) แล้วเปิดในแท็บใหม่
  // ให้ลูกค้าอ่านก่อนลงลายมือชื่อ — ยังไม่ฝังรูปถ่ายจริงในตัวอย่างนี้ (ดูหมายเหตุใน api/preview-contract.js)
  // มีหลายรายการได้ (2026-09-04) — เรียกทีละ SO, preview-contract.js เดิมรับ session แบบเดี่ยวอยู่แล้ว ไม่ต้อง
  // แก้ฝั่งนั้น แค่ประกอบ flat session จาก item + ฟิลด์ร่วม (contractDate/customer/letterheadDataUrl) เอง
  function openContractPdf(soNumber, btn) {
    var item = session.items.filter(function (it) { return it.soNumber === soNumber; })[0];
    if (!item) return;
    var errEl = document.getElementById('contractPdfErr');
    errEl.textContent = '';
    btn.disabled = true;
    var originalText = btn.textContent;
    btn.textContent = 'กำลังสร้างไฟล์...';
    var flatSession = Object.assign({
      contractDate: session.contractDate,
      customer: session.customer,
      letterheadDataUrl: session.letterheadDataUrl,
    }, item);
    fetch('/api/preview-contract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: flatSession, customer: state.data }),
    })
      .then(function (res) { return res.json().then(function (body) { return { ok: res.ok, body: body }; }); })
      .then(function (result) {
        if (!result.ok) throw new Error(result.body.error || 'สร้างไฟล์ไม่สำเร็จ');
        // สร้าง PDF จริงฝั่ง browser เอง (html2canvas + jsPDF) จาก block ย่อหน้า/ตารางที่ server ส่งมา —
        // แทนที่การ render ด้วย pdf-lib ฝั่ง server แบบเดิม (2026-09-04, ดู contract-html-renderer.js)
        // ส่ง customer/contractDate/hasGuardian/hasGuarantor ไปด้วย (2026-09-04 รอบนี้) ให้ renderer สร้างหน้า
        // รูปแนบ (บัตร ปชช./คู่บัตร ที่ลูกค้าอัปโหลดไปแล้วในขั้นตอนก่อนหน้านี้) + บล็อกลายเซ็นเองได้
        return renderContractPdf(result.body.blocks, {
          title: result.body.title,
          letterheadDataUrl: session.letterheadDataUrl,
          customer: state.data,
          contractDate: session.contractDate,
          hasGuardian: requiresGuardianNow(),
          hasGuarantor: requiresGuarantorNow(),
        });
      })
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        window.open(url, '_blank');
        state.data.viewedContracts[soNumber] = true;
      })
      .catch(function (err) {
        errEl.textContent = 'เปิดไฟล์สัญญาไม่สำเร็จ: ' + err.message + ' (ถ้าเปิดไฟล์นี้ตรงๆ ผ่าน file:// ต้องรันผ่าน dev-server.js ก่อน)';
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = originalText;
      });
  }

  function setupSignaturePad() {
    var canvas = document.getElementById('sigCanvas');
    var ctx = canvas.getContext('2d');
    function resize() {
      var rect = canvas.getBoundingClientRect();
      var dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#1f2430';
    }
    resize();
    sigPad = { canvas: canvas, ctx: ctx, drawing: false, hasStroke: !!state.data.signature };

    function pos(e) {
      var rect = canvas.getBoundingClientRect();
      var t = e.touches ? e.touches[0] : e;
      return { x: t.clientX - rect.left, y: t.clientY - rect.top };
    }
    function start(e) { e.preventDefault(); sigPad.drawing = true; var p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }
    function move(e) {
      if (!sigPad.drawing) return;
      e.preventDefault();
      var p = pos(e);
      ctx.lineTo(p.x, p.y); ctx.stroke();
      sigPad.hasStroke = true;
    }
    function end() {
      if (!sigPad.drawing) return;
      sigPad.drawing = false;
      state.data.signature = canvas.toDataURL('image/png');
      markSigError(false);
    }
    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end);

    document.getElementById('sigClear').addEventListener('click', function () {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      sigPad.hasStroke = false;
      state.data.signature = null;
    });
  }
  function markSigError(show, msg) {
    var el = document.getElementById('sig_err');
    if (!el) return;
    el.textContent = show ? (msg || 'กรุณาลงลายมือชื่อก่อนดำเนินการต่อ') : '';
  }

  // เครื่องมือแนบรูปลายเซ็น (ผู้ค้ำ/ผู้ปกครอง) + ลบพื้นหลังสีอ่อนแบบ threshold (ไม่ใช้ AI, ทำฝั่ง client ล้วน)
  function signatureUploadCardHtml(id, label) {
    return (
      '<div class="card">' +
      '<h2>' + label + '</h2>' +
      '<p class="hint">ถ่ายรูปลายเซ็นบนกระดาษสีขาว แล้วปรับความเข้มด้านล่างเพื่อลบพื้นหลังออก</p>' +
      '<div class="upload-box" id="' + id + '_box">' +
      '<input type="file" id="' + id + '_input" accept="image/*" capture="environment" />' +
      '<div class="upload-msg" id="' + id + '_msg">แตะเพื่อเลือกรูปลายเซ็น</div>' +
      '</div>' +
      '<canvas id="' + id + '_canvas" style="display:none; width:100%; border:1px solid var(--border); border-radius:8px; margin-top:8px;"></canvas>' +
      '<div id="' + id + '_sliderWrap" style="display:none; margin-top:8px;">' +
      '<label style="font-size:13px;">ความเข้มการลบพื้นหลัง</label>' +
      '<input type="range" id="' + id + '_threshold" min="150" max="250" value="200" style="width:100%;" />' +
      '</div>' +
      '<div class="err" id="' + id + '_err"></div>' +
      '</div>'
    );
  }
  function setupSignatureUploadTool(id, onConfirm) {
    var box = document.getElementById(id + '_box');
    var input = document.getElementById(id + '_input');
    var canvas = document.getElementById(id + '_canvas');
    var sliderWrap = document.getElementById(id + '_sliderWrap');
    var slider = document.getElementById(id + '_threshold');
    var ctx = canvas.getContext('2d');
    var sourceImg = null;

    box.addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      var errEl = document.getElementById(id + '_err');
      errEl.textContent = '';
      if (!file) return;
      if (!/^image\//.test(file.type)) { errEl.textContent = 'กรุณาเลือกไฟล์รูปภาพเท่านั้น'; return; }
      if (file.size > MAX_FILE_BYTES) { errEl.textContent = 'ไฟล์ใหญ่เกิน 5MB'; return; }
      var reader = new FileReader();
      reader.onload = function () {
        var img = new Image();
        img.onload = function () {
          sourceImg = img;
          var maxW = 500;
          var scale = Math.min(1, maxW / img.width);
          canvas.width = img.width * scale;
          canvas.height = img.height * scale;
          canvas.style.display = 'block';
          sliderWrap.style.display = 'block';
          box.classList.add('has-file');
          document.getElementById(id + '_msg').textContent = file.name;
          applyThreshold();
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });

    function applyThreshold() {
      if (!sourceImg) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(sourceImg, 0, 0, canvas.width, canvas.height);
      var imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      var d = imgData.data;
      var threshold = Number(slider.value);
      for (var i = 0; i < d.length; i += 4) {
        var brightness = (d[i] + d[i + 1] + d[i + 2]) / 3;
        if (brightness >= threshold) d[i + 3] = 0; // ทำพิกเซลสีอ่อน/ขาวให้โปร่งใส
      }
      ctx.putImageData(imgData, 0, 0);
      onConfirm(canvas.toDataURL('image/png'));
    }
    slider.addEventListener('input', applyThreshold);
  }

  // แสดงข้อความ error ให้เห็นจริงเสมอ (บั๊กเดิม: กด "ส่งข้อมูล" แล้วไม่มีอะไรเกิดขึ้นเลยถ้าลืมติ๊กยอมรับเงื่อนไข
  // หรือไม่ได้แนบลายเซ็นผู้ค้ำ/ผู้ปกครอง เพราะ goNext() แค่ return เฉยๆ ไม่มี error message ให้เห็นว่าติดตรงไหน)
  function showInlineError(id, message) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = message;
    el.style.display = message ? 'block' : 'none';
  }

  function validateSign() {
    var errors = {};
    showInlineError('contractPdfErr', '');
    showInlineError('agree_err', '');
    showInlineError('guardianSig_err', ''); // showInlineError เองก็เช็ค null อยู่แล้วถ้าไม่มี element นี้ในหน้า
    showInlineError('guarantorSig_err', '');

    var viewed = state.data.viewedContracts || {};
    var allViewed = session.items.every(function (s) { return viewed[s.soNumber]; });
    if (!allViewed) {
      errors.hasViewedContract = true;
      showInlineError('contractPdfErr', session.items.length > 1
        ? 'กรุณากดอ่านสัญญาฉบับเต็มให้ครบทุกรายการก่อนดำเนินการต่อ'
        : 'กรุณากดอ่านสัญญาฉบับเต็มก่อนดำเนินการต่อ');
    }
    if (!state.data.agreeContract) {
      errors.agree = true;
      showInlineError('agree_err', 'กรุณาติ๊กยอมรับเงื่อนไขก่อนดำเนินการต่อ');
    }
    if (!state.data.signature) { errors.signature = true; markSigError(true); }
    if (requiresGuardianNow() && !state.data.guardianSignature) {
      errors.guardianSignature = true;
      showInlineError('guardianSig_err', 'กรุณาแนบรูปลายเซ็นผู้ปกครองก่อนดำเนินการต่อ');
    }
    if (requiresGuarantorNow() && !state.data.guarantorSignature) {
      errors.guarantorSignature = true;
      showInlineError('guarantorSig_err', 'กรุณาแนบรูปลายเซ็นผู้ค้ำประกันก่อนดำเนินการต่อ');
    }
    return errors;
  }

  // ---------- shell / navigation ----------
  function renderStepper() {
    var steps = visibleSteps();
    var el = document.getElementById('stepper');
    el.innerHTML = steps.map(function (s, i) {
      var cls = i < state.stepIndex ? 'done' : (i === state.stepIndex ? 'current' : '');
      return '<div class="dot ' + cls + '"></div>';
    }).join('');
  }

  function renderCurrentStep() {
    var def = currentDef();
    var app = document.getElementById('app');
    if (!def) {
      app.innerHTML = '<div class="center-msg">ส่งข้อมูลเรียบร้อยแล้ว ขอบคุณค่ะ</div>';
      document.getElementById('navBar').style.display = 'none';
      return;
    }
    def.render(app);
    renderStepper();
    document.getElementById('btnBack').disabled = state.stepIndex === 0;
    document.getElementById('btnBack').style.visibility = state.stepIndex === 0 ? 'hidden' : 'visible';
    var isLast = state.stepIndex === visibleSteps().length - 1;
    document.getElementById('btnNext').textContent = isLast ? 'ส่งข้อมูล' : 'ถัดไป';
  }

  function goNext() {
    var def = currentDef();
    var errors = def.validate();
    if (Object.keys(errors).length > 0) {
      // เลื่อนไปหา error message แรกที่มองเห็นได้ กันเคส "กดปุ่มแล้วเหมือนไม่มีอะไรเกิดขึ้น" เพราะข้อความ error
      // อยู่นอกจอ (โดยเฉพาะขั้นตอนสุดท้ายที่มีหลายการ์ด: ยอมรับเงื่อนไข/ลายเซ็น/ลายเซ็นผู้ค้ำ-ผู้ปกครอง)
      var firstErrorEl = Array.prototype.filter.call(document.querySelectorAll('.err'), function (el) {
        return el.textContent && el.offsetParent !== null;
      })[0];
      if (firstErrorEl) firstErrorEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    var steps = visibleSteps();
    if (state.stepIndex < steps.length - 1) {
      state.stepIndex++;
      window.scrollTo(0, 0);
      renderCurrentStep();
    } else {
      submitContract();
    }
  }
  function goBack() {
    if (state.stepIndex > 0) {
      state.stepIndex--;
      window.scrollTo(0, 0);
      renderCurrentStep();
    }
  }

  // ส่งข้อมูลลูกค้า + ไฟล์ทั้งหมดไป /api/submit-contract จริง (2026-09-04 แทนที่ console.log mock เดิม) —
  // อัปโหลดรูป/ลายเซ็นเข้า Supabase Storage + บันทึก contract_submissions + อัปเดตสถานะ session จริง
  // ถ้าเปิดหน้านี้แบบไม่มี token จริง (?demo=1 หรือ MOCK_SESSION ตรงๆ) ยังใช้ mock เดิม (แค่ log) เหมือนก่อน
  // เพราะไม่มี session จริงใน DB ให้ผูกกับ submission นี้
  function submitContract() {
    if (!realToken) {
      console.log('SUBMIT (mock — ไม่มี token จริง) — payload:', JSON.stringify(state.data, null, 2));
      state.stepIndex = visibleSteps().length;
      renderCurrentStep();
      return;
    }
    var btn = document.getElementById('btnNext');
    var errEl = document.getElementById('submitErr');
    if (errEl) errEl.textContent = '';
    btn.disabled = true;
    btn.textContent = 'กำลังส่งข้อมูล...';
    fetch('/api/submit-contract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: realToken, customer: state.data }),
    })
      .then(function (res) { return res.json().then(function (body) { return { ok: res.ok, body: body }; }); })
      .then(function (result) {
        if (!result.ok) throw new Error(result.body.error || 'ส่งข้อมูลไม่สำเร็จ');
        state.stepIndex = visibleSteps().length;
        renderCurrentStep();
      })
      .catch(function (err) {
        if (errEl) errEl.textContent = 'ส่งข้อมูลไม่สำเร็จ: ' + err.message;
        btn.disabled = false;
        btn.textContent = 'ส่งข้อมูล';
      });
  }

  document.getElementById('btnNext').addEventListener('click', goNext);
  document.getElementById('btnBack').addEventListener('click', goBack);

  renderCurrentStep();
})();
