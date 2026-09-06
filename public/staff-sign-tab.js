// "ข้อมูลลูกค้าทำสัญญา" — เดิม (2026-09-04 รอบแรก) เป็นแค่คิวเอกสารรอพนักงานเซ็น ตอนนี้ (2026-09-04 รอบนี้
// ตามที่ user ขอ "หากมีส่งกลับมาแล้วให้แสดงข้อมูลไว้ที่เมนูข้อมูลลูกค้าทำสัญญา") แสดงรายชื่อลูกค้าที่ส่งฟอร์ม
// กลับมาแล้วทุกคน กดดูข้อมูลเต็มได้ (ส่วนตัว/ที่อยู่/บุคคลอ้างอิง/ผู้ปกครอง-ผู้ค้ำ/รูปเอกสารที่แนบ) ส่วนคนที่
// ยังไม่มีใครเซ็นจะมีปุ่ม "เซ็นเอกสาร" เพิ่มขึ้นมา (ฟังก์ชันเดิมจากรอบก่อน — นำการเซ็นออนไลน์ของระบบขออนุมัติ
// เอกสารมาใช้ ลูกค้าเซ็นก่อน พนักงาน 1 คนเซ็นทีหลัง ผ่านการล็อกอินเข้า app.html เดิม)
// ใช้: initStaffSignTab('containerElementId', currentUser)  — currentUser: { username, department }
function initStaffSignTab(containerId, currentUser) {
  'use strict';

  var sigPad = null; // { canvas, ctx, drawing, hasStroke }

  var state = {
    loading: true,
    error: null,
    queue: [],
    expandedId: null, // submissionId ที่กำลังกาง "ดูข้อมูลลูกค้า" อยู่ (null = ยุบทั้งหมด)
    signingId: null, // submissionId ที่กำลังเปิดเซ็นอยู่ (null = ยังไม่เปิด)
    submitting: false,
    submitError: null,
    savedSignatureDataUrl: null, // ลายเซ็นที่พนักงานคนนี้เคยบันทึกไว้ (2026-09-04) — โหลดครั้งเดียวตอนเข้าหน้า
    // ปฏิเสธ/ขอแก้ไขข้อมูล (2026-09-06) — พนักงานตรวจแล้วพบว่าข้อมูลบางส่วนผิด ระบุกลุ่มที่ต้องแก้แล้วส่งลิงก์
    // เดิมกลับให้ลูกค้าแก้ไขเฉพาะจุดนั้น (ดู staff-reject-submission.js / sign.js)
    rejectingId: null, // submissionId ที่กำลังเปิดปฏิเสธอยู่ (null = ยังไม่เปิด)
    rejectChecked: {}, // { personal: true, uploads: true, ... }
    rejectNote: '',
    rejecting: false,
    rejectError: null,
  };
  var REJECT_GROUPS = [
    { key: 'personal', label: 'ข้อมูลส่วนตัว' },
    { key: 'address', label: 'ที่อยู่และบุคคลอ้างอิง' },
    { key: 'guardian', label: 'ข้อมูลผู้ปกครอง', onlyIf: 'hasGuardian' },
    { key: 'guarantor', label: 'ข้อมูลผู้ค้ำประกัน', onlyIf: 'hasGuarantor' },
    { key: 'uploads', label: 'รูปเอกสารที่แนบ (บัตร/เซลฟี่)' },
  ];

  // โหลดลายเซ็นที่บันทึกไว้ล่าสุดของพนักงานคนนี้ (ถ้ามี) — กรองด้วย username ตรงๆ เห็นแค่ของตัวเองเท่านั้น
  // ตามที่ user ขอ ไม่ต้องรอก่อนโหลดคิว (ยิงพร้อมกัน) เผื่อคนไม่เคยบันทึกไว้เลยก็ไม่ต้องรอ
  async function loadSavedSignature() {
    try {
      var res = await fetch('/api/staff-signature?username=' + encodeURIComponent(currentUser.username));
      var body = await res.json();
      if (res.ok && body.signatureDataUrl) state.savedSignatureDataUrl = body.signatureDataUrl;
    } catch (e) { /* ไม่มีลายเซ็นบันทึกไว้ก็แค่วาดใหม่ปกติ ไม่ critical */ }
  }

  function fmtDateTime(iso) {
    if (!iso) return '-';
    var d = new Date(iso);
    if (isNaN(d)) return '-';
    return (isoToDDMMYYYY(iso.slice(0, 10)) || '-') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  async function loadQueue() {
    state.loading = true;
    state.error = null;
    render();
    try {
      var res = await fetch('/api/staff-sign-queue');
      var body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || 'โหลดข้อมูลไม่สำเร็จ');
      state.queue = body.queue || [];
    } catch (err) {
      state.error = 'โหลดข้อมูลไม่สำเร็จ: ' + err.message + ' (ถ้ายังไม่ได้รัน supabase-staff-signature.sql ต้องรันก่อน)';
    }
    state.loading = false;
    render();
  }

  function toggleExpand(submissionId) {
    state.expandedId = state.expandedId === submissionId ? null : submissionId;
    render();
  }

  function openSignPanel(submissionId) {
    state.signingId = submissionId;
    state.submitError = null;
    state.submitting = false;
    render();
  }

  function closeSignPanel() {
    state.signingId = null;
    render();
  }

  function openRejectPanel(submissionId) {
    state.rejectingId = submissionId;
    state.rejectChecked = {};
    state.rejectNote = '';
    state.rejectError = null;
    state.rejecting = false;
    render();
  }

  function closeRejectPanel() {
    state.rejectingId = null;
    render();
  }

  async function submitReject() {
    var rejectedFields = Object.keys(state.rejectChecked).filter(function (k) { return state.rejectChecked[k]; });
    if (!rejectedFields.length) {
      state.rejectError = 'กรุณาติ๊กเลือกอย่างน้อย 1 รายการที่ต้องแก้ไข';
      render();
      return;
    }
    state.rejecting = true;
    state.rejectError = null;
    render();
    try {
      var res = await fetch('/api/staff-reject-submission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submissionId: state.rejectingId,
          staffName: currentUser.username,
          rejectedFields: rejectedFields,
          note: state.rejectNote,
        }),
      });
      var body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || 'ปฏิเสธไม่สำเร็จ');
      state.rejectingId = null;
      await loadQueue(); // โหลดคิวใหม่ ให้แถวนี้ขึ้นสถานะ "รอลูกค้าแก้ไข" + ปุ่มคัดลอกลิงก์ทันที
      return;
    } catch (err) {
      state.rejectError = 'ปฏิเสธไม่สำเร็จ: ' + err.message;
    }
    state.rejecting = false;
    render();
  }

  // ---------- ดาวน์โหลดสัญญาฉบับจริง (2026-09-06) — ใช้ endpoint/renderer เดียวกับปุ่ม "ดูตัวอย่างสัญญา" ของ
  // CS (contracts-tab.js's previewContractFor) แต่ใส่ข้อมูล/รูปแนบ/ลายเซ็นจริงที่ลูกค้าส่งกลับมาแล้วแทน
  // placeholder — ให้พนักงานตรวจเอกสารฉบับจริงก่อนพิมพ์/ตัดสินใจเซ็นหรือปฏิเสธ ----------
  function downloadContractFor(submissionId, soNumber) {
    var item = state.queue.filter(function (q) { return q.submissionId === submissionId; })[0];
    if (!item) return;
    var sessionItem = (item.items || []).filter(function (it) { return it.soNumber === soNumber; })[0];
    if (!sessionItem) return;
    var btn = document.getElementById('btnDownloadContract__' + submissionId + '__' + soNumber);
    var errEl = document.getElementById('downloadContractErr__' + submissionId);
    if (errEl) errEl.textContent = '';
    var originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'กำลังสร้างไฟล์...';

    var c = item.customer || {};
    var hg = hasGuardianGuarantor(item);
    var customerWithFiles = Object.assign({}, c, {
      files: {
        idCard: item.files.idCard, selfieWithId: item.files.selfieWithId,
        guardianId: item.files.guardianId, guarantorId: item.files.guarantorId,
        signature: item.files.signature, guardianSignature: item.files.guardianSignature, guarantorSignature: item.files.guarantorSignature,
      },
    });
    var flatSession = Object.assign({ contractDate: item.contractDate, customer: c, letterheadDataUrl: item.letterheadDataUrl }, sessionItem);

    fetch('/api/preview-contract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: flatSession, customer: customerWithFiles, final: true }),
    })
      .then(function (res) { return res.json().then(function (body) { return { ok: res.ok, body: body }; }); })
      .then(function (result) {
        if (!result.ok) throw new Error(result.body.error || 'สร้างไฟล์ไม่สำเร็จ');
        return renderContractPdf(result.body.blocks, {
          title: result.body.title,
          letterheadDataUrl: flatSession.letterheadDataUrl,
          customer: customerWithFiles,
          contractDate: flatSession.contractDate,
          hasGuardian: hg.hasGuardian,
          hasGuarantor: hg.hasGuarantor,
          staffSignature: item.staffSignedAt ? { url: item.files.staffSignature } : null,
        });
      })
      .then(function (blob) {
        window.open(URL.createObjectURL(blob), '_blank');
      })
      .catch(function (err) {
        if (errEl) errEl.textContent = 'สร้างไฟล์ไม่สำเร็จ: ' + err.message;
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = originalText;
      });
  }

  async function submitSignature() {
    if (!sigPad || !sigPad.hasStroke) {
      state.submitError = 'กรุณาลงลายมือชื่อก่อนกดยืนยัน';
      render();
      return;
    }
    var signatureDataUrl = sigPad.canvas.toDataURL('image/png');
    state.submitting = true;
    state.submitError = null;
    render();
    try {
      var res = await fetch('/api/staff-sign-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submissionId: state.signingId,
          staffName: currentUser.username,
          signatureDataUrl: signatureDataUrl,
        }),
      });
      var body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || 'เซ็นไม่สำเร็จ');
      state.savedSignatureDataUrl = signatureDataUrl;
      // บันทึกลายเซ็นนี้ไว้ใช้ครั้งถัดไป (2026-09-04) — ไม่บล็อกความสำเร็จของการเซ็นหลัก ถ้าขั้นตอนนี้พังก็แค่
      // ต้องวาดใหม่รอบหน้า ไม่ใช่ปัญหาร้ายแรง
      fetch('/api/staff-signature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentUser.username, signatureDataUrl: signatureDataUrl }),
      }).catch(function () { /* เงียบไว้ ไม่ critical */ });
      state.signingId = null;
      await loadQueue(); // โหลดรายการใหม่ (แถวที่เพิ่งเซ็นจะเปลี่ยนสถานะเป็น "เซ็นแล้ว")
      return;
    } catch (err) {
      state.submitError = 'เซ็นไม่สำเร็จ: ' + err.message;
    }
    state.submitting = false;
    render();
  }

  function setupSignaturePad() {
    var canvas = document.getElementById('staffSigCanvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var rect = canvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1f2430';
    sigPad = { canvas: canvas, ctx: ctx, drawing: false, hasStroke: false };

    // เติมลายเซ็นที่บันทึกไว้ล่าสุดให้อัตโนมัติ (2026-09-04 ลดเวลาวาดใหม่) — กด "ล้างลายเซ็น" ถ้าอยากวาดใหม่
    if (state.savedSignatureDataUrl) {
      var img = new Image();
      img.onload = function () {
        ctx.drawImage(img, 0, 0, rect.width, rect.height);
        sigPad.hasStroke = true;
      };
      img.src = state.savedSignatureDataUrl;
    }

    function pos(e) {
      var r = canvas.getBoundingClientRect();
      var t = e.touches ? e.touches[0] : e;
      return { x: t.clientX - r.left, y: t.clientY - r.top };
    }
    function start(e) { e.preventDefault(); sigPad.drawing = true; var p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }
    function move(e) {
      if (!sigPad.drawing) return;
      e.preventDefault();
      var p = pos(e);
      ctx.lineTo(p.x, p.y); ctx.stroke();
      sigPad.hasStroke = true;
    }
    function end() { sigPad.drawing = false; }
    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end);

    document.getElementById('staffSigClear').addEventListener('click', function () {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      sigPad.hasStroke = false;
    });
  }

  // ---------- ข้อมูลเต็มของลูกค้า (ที่อยู่/บุคคลอ้างอิง/ผู้ปกครอง-ผู้ค้ำ/ไฟล์แนบ) ----------
  function formatAddress(addr) {
    if (!addr) return '-';
    var parts = [];
    if (addr.detail) parts.push(addr.detail);
    if (addr.subdistrictName) parts.push('ต./แขวง' + addr.subdistrictName);
    if (addr.districtName) parts.push('อ./เขต' + addr.districtName);
    if (addr.provinceName) parts.push('จ.' + addr.provinceName);
    if (addr.zip) parts.push(addr.zip);
    return parts.length ? parts.join(' ') : '-';
  }

  function infoRow(label, value) {
    return '<tr><td style="text-align:left;color:var(--muted);width:170px;">' + label + '</td><td>' + (value || '-') + '</td></tr>';
  }

  function fileThumbHtml(url, label) {
    if (!url) return '';
    return '<a href="' + url + '" target="_blank" style="display:inline-block;text-align:center;margin:0 10px 10px 0;">' +
      '<img src="' + url + '" style="width:110px;height:80px;object-fit:cover;border:1px solid var(--border);border-radius:8px;display:block;" />' +
      '<span style="font-size:12px;color:var(--muted);">' + label + '</span></a>';
  }

  function hasGuardianGuarantor(item) {
    var c = item.customer || {};
    return {
      hasGuardian: !!(c.guardian && c.guardian.firstLastName && c.guardian.firstLastName.trim()),
      hasGuarantor: !!(c.guarantor && c.guarantor.firstLastName && c.guarantor.firstLastName.trim()),
    };
  }

  function copyLinkToken(token) {
    var url = location.origin + '/sign.html?token=' + token;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).catch(function () { window.prompt('คัดลอกลิงก์นี้:', url); });
    } else {
      window.prompt('คัดลอกลิงก์นี้:', url);
    }
  }

  var CORRECTION_GROUP_LABELS = {
    personal: 'ข้อมูลส่วนตัว', address: 'ที่อยู่และบุคคลอ้างอิง',
    guardian: 'ข้อมูลผู้ปกครอง', guarantor: 'ข้อมูลผู้ค้ำประกัน', uploads: 'รูปเอกสารที่แนบ',
  };

  function correctionStatusHtml(item) {
    if (!item.rejectedAt) {
      return '<button type="button" class="btn btn-ghost btnOpenReject" data-id="' + item.submissionId + '" style="margin-top:10px;">ปฏิเสธ / ขอแก้ไขข้อมูล</button>';
    }
    var labels = (item.rejectedFields || []).map(function (k) { return CORRECTION_GROUP_LABELS[k] || k; });
    return '<div class="notice" style="margin-top:12px;">' +
      'ส่งกลับให้ลูกค้าแก้ไขแล้ว โดย ' + (item.rejectedBy || '-') + ' เมื่อ ' + fmtDateTime(item.rejectedAt) + '<br>' +
      'รายการที่ต้องแก้: <b>' + (labels.join(', ') || '-') + '</b>' +
      (item.rejectedNote ? '<br>หมายเหตุ: ' + item.rejectedNote : '') +
      '</div>' +
      '<button type="button" class="btn btn-secondary btnCopyRejectLink" data-token="' + item.token + '" style="margin-top:8px;">📋 คัดลอกลิงก์ให้ลูกค้าแก้ไข</button>';
  }

  function downloadContractButtonsHtml(item) {
    if (!item.items || !item.items.length) return '';
    return '<div style="margin-top:10px;">' +
      item.items.map(function (it) {
        return '<button type="button" class="btn btn-ghost btnDownloadContract" data-submission-id="' + item.submissionId + '" data-so="' + it.soNumber + '" ' +
          'id="btnDownloadContract__' + item.submissionId + '__' + it.soNumber + '" style="margin:4px 8px 4px 0;">📄 ดาวน์โหลดสัญญา: ' + it.product + '</button>';
      }).join('') +
      '<div class="err" id="downloadContractErr__' + item.submissionId + '"></div>' +
      '</div>';
  }

  function customerDetailHtml(item) {
    var c = item.customer || {};
    var addr = c.address || {};
    var ship = c.shippingAddress || {};
    var ref = c.reference || {};
    var guardian = c.guardian || {};
    var guarantor = c.guarantor || {};
    var hg = hasGuardianGuarantor(item);
    var hasGuardian = hg.hasGuardian;
    var hasGuarantor = hg.hasGuarantor;

    var html = '<div style="padding:14px 0 4px;border-top:1px solid var(--border);">' +
      '<table class="installment-table" style="margin-bottom:12px;">' +
      infoRow('ชื่อ-นามสกุล', (c.title || '') + (c.firstLastName || '-')) +
      infoRow('อายุ', c.age ? (c.age + ' ปี') : '-') +
      infoRow('เลขบัตรประชาชน', c.citizenId) +
      infoRow('เบอร์โทร', c.phone) +
      infoRow('สัญชาติ', c.nationality) +
      infoRow('ที่อยู่ปัจจุบัน', formatAddress(addr)) +
      infoRow('ที่อยู่จัดส่งสินค้า', ship.sameAsCurrent ? 'ใช้ที่อยู่เดียวกับที่อยู่ปัจจุบัน' : formatAddress(ship)) +
      infoRow('บุคคลอ้างอิง', ref.firstLastName ? (ref.firstLastName + ' (' + (ref.relation || '-') + ') โทร ' + (ref.phone || '-')) : '-') +
      (hasGuardian ? infoRow('ผู้ปกครอง', (guardian.title || '') + guardian.firstLastName + ' โทร ' + (guardian.phone || '-') + ' บัตร ' + (guardian.citizenId || '-')) : '') +
      (hasGuarantor ? infoRow('ผู้ค้ำประกัน', (guarantor.title || '') + guarantor.firstLastName + ' อายุ ' + (guarantor.age || '-') + ' ปี โทร ' + (guarantor.phone || '-') + ' บัตร ' + (guarantor.citizenId || '-')) : '') +
      '</table>' +
      '<div style="margin-bottom:4px;color:var(--muted);font-size:13px;">เอกสารแนบ (คลิกเพื่อดูเต็ม)</div>' +
      fileThumbHtml(item.files.idCard, 'บัตร ปชช. ลูกค้า') +
      fileThumbHtml(item.files.selfieWithId, 'คู่บัตร ลูกค้า') +
      fileThumbHtml(item.files.signature, 'ลายเซ็นลูกค้า') +
      (hasGuardian ? fileThumbHtml(item.files.guardianId, 'บัตร ปชช. ผู้ปกครอง') : '') +
      (hasGuardian ? fileThumbHtml(item.files.guardianSignature, 'ลายเซ็นผู้ปกครอง') : '') +
      (hasGuarantor ? fileThumbHtml(item.files.guarantorId, 'บัตร ปชช. ผู้ค้ำ') : '') +
      (hasGuarantor ? fileThumbHtml(item.files.guarantorSignature, 'ลายเซ็นผู้ค้ำ') : '') +
      (item.files.staffSignature ? fileThumbHtml(item.files.staffSignature, 'ลายเซ็นพนักงาน') : '') +
      downloadContractButtonsHtml(item) +
      correctionStatusHtml(item) +
      '</div>';
    return html;
  }

  function statusBadgeHtml(item) {
    if (item.rejectedAt) {
      return '<span class="badge badge-info" style="background:#fee2e2;color:#b91c1c;">รอลูกค้าแก้ไข</span>';
    }
    if (item.staffSignedAt) {
      return '<span class="badge badge-info" style="background:#e3f5ec;color:#1f7a4d;">เซ็นแล้ว โดย ' + (item.staffSignedBy || '-') + '</span>';
    }
    return '<span class="badge badge-info" style="background:#fff3e0;color:#b06a00;">รอเซ็น</span>';
  }

  function render() {
    var app = document.getElementById(containerId);
    var html = '';

    if (state.loading) {
      html = '<div class="card">กำลังโหลดข้อมูล...</div>';
    } else if (state.error) {
      html = '<div class="card"><p style="color:var(--danger);">' + state.error + '</p></div>';
    } else if (state.signingId) {
      var item = state.queue.filter(function (q) { return q.submissionId === state.signingId; })[0];
      html = '<div class="card">' +
        '<h2>เซ็นเอกสาร — ' + (item ? item.customerName : '') + '</h2>' +
        '<p class="hint">รายการ: ' + (item ? item.products.join(', ') : '') + ' (' + (item ? item.soNumbers.join(', ') : '') + ')</p>' +
        '<p class="hint">ลูกค้าส่งฟอร์ม/เซ็นชื่อแล้วเมื่อ ' + (item ? fmtDateTime(item.submittedAt) : '') + ' — ลงลายมือชื่อพนักงาน (' + currentUser.username + ') เพื่อยืนยันอนุมัติสัญญานี้</p>' +
        (state.savedSignatureDataUrl ? '<p class="hint">เติมลายเซ็นที่บันทึกไว้ล่าสุดให้แล้ว — กด "ล้างลายเซ็น" ถ้าต้องการวาดใหม่</p>' : '') +
        '<div class="sig-pad-wrap"><canvas id="staffSigCanvas"></canvas></div>' +
        '<div class="sig-tools"><button type="button" class="btn btn-ghost" id="staffSigClear">ล้างลายเซ็น</button></div>' +
        (state.submitError ? '<p style="color:var(--danger);margin-top:10px;">' + state.submitError + '</p>' : '') +
        '<div style="margin-top:14px;">' +
        '<button class="btn btn-primary" id="btnSubmitSign"' + (state.submitting ? ' disabled' : '') + '>' + (state.submitting ? 'กำลังบันทึก...' : 'ยืนยันเซ็น') + '</button> ' +
        '<button class="btn btn-ghost" id="btnCancelSign">ยกเลิก</button>' +
        '</div>' +
        '</div>';
    } else if (state.rejectingId) {
      var rejectItem = state.queue.filter(function (q) { return q.submissionId === state.rejectingId; })[0];
      var hg = rejectItem ? hasGuardianGuarantor(rejectItem) : { hasGuardian: false, hasGuarantor: false };
      var groups = REJECT_GROUPS.filter(function (g) {
        if (g.onlyIf === 'hasGuardian') return hg.hasGuardian;
        if (g.onlyIf === 'hasGuarantor') return hg.hasGuarantor;
        return true;
      });
      html = '<div class="card">' +
        '<h2>ปฏิเสธ / ขอแก้ไขข้อมูล — ' + (rejectItem ? rejectItem.customerName : '') + '</h2>' +
        '<p class="hint">ติ๊กเลือกข้อมูลที่ไม่ถูกต้อง ระบบจะส่งลิงก์เดิมกลับให้ลูกค้าแก้ไขเฉพาะจุดที่เลือก ส่วนข้อมูลอื่นที่ถูกต้องอยู่แล้วจะเติมให้อัตโนมัติไม่ต้องกรอกซ้ำ (ลูกค้าต้องตรวจสอบยอด/เซ็นชื่อใหม่เสมอ)</p>' +
        groups.map(function (g) {
          var checked = !!state.rejectChecked[g.key];
          return '<label style="display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid var(--border);">' +
            '<input type="checkbox" class="rejectFieldCheck" data-key="' + g.key + '"' + (checked ? ' checked' : '') + ' />' +
            '<span>' + g.label + '</span></label>';
        }).join('') +
        '<div class="field" style="margin-top:12px;"><label>หมายเหตุ (ไม่บังคับ)</label>' +
        '<textarea id="rejectNoteInput" rows="3" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:14px;">' + (state.rejectNote || '').replace(/</g, '&lt;') + '</textarea></div>' +
        (state.rejectError ? '<p style="color:var(--danger);margin-top:10px;">' + state.rejectError + '</p>' : '') +
        '<div style="margin-top:14px;">' +
        '<button class="btn btn-primary" id="btnConfirmReject"' + (state.rejecting ? ' disabled' : '') + '>' + (state.rejecting ? 'กำลังบันทึก...' : 'ยืนยันปฏิเสธ') + '</button> ' +
        '<button class="btn btn-ghost" id="btnCancelReject">ยกเลิก</button>' +
        '</div>' +
        '</div>';
    } else if (state.queue.length === 0) {
      html = '<div class="card"><h2>ข้อมูลลูกค้าทำสัญญา</h2><p class="hint">ยังไม่มีลูกค้าส่งฟอร์มกลับมา — สร้างลิงก์ให้ลูกค้าที่เมนู "สำหรับ CS" ก่อน</p></div>';
    } else {
      html = '<div class="card"><h2>ข้อมูลลูกค้าทำสัญญา (' + state.queue.length + ' รายการ)</h2>' +
        '<p class="hint">รายชื่อลูกค้าที่กรอกฟอร์ม/เซ็นชื่อส่งกลับมาแล้ว กด "ดูข้อมูลลูกค้า" เพื่อดูรายละเอียดเต็ม รายการที่ยังไม่มีใครเซ็นจะมีปุ่ม "เซ็นเอกสาร" ให้กดยืนยัน</p>' +
        state.queue.map(function (q) {
          var expanded = state.expandedId === q.submissionId;
          return '<div style="padding:12px 0;border-top:1px solid var(--border);">' +
            '<div style="display:flex;align-items:center;gap:10px;">' +
            '<div style="flex:1;">' +
            '<b>' + q.customerName + '</b> ' + statusBadgeHtml(q) + '<br>' +
            '<span style="color:var(--muted);font-size:13px;">' + q.products.join(', ') + ' (' + q.soNumbers.join(', ') + ')</span><br>' +
            '<span style="color:var(--muted);font-size:12px;">ส่งฟอร์มเมื่อ ' + fmtDateTime(q.submittedAt) + '</span>' +
            '</div>' +
            '<button class="btn btn-ghost btnToggleExpand" data-id="' + q.submissionId + '">' + (expanded ? 'ซ่อนข้อมูล' : 'ดูข้อมูลลูกค้า') + '</button>' +
            (!q.staffSignedAt && !q.rejectedAt ? '<button class="btn btn-primary btnOpenSign" data-id="' + q.submissionId + '">เซ็นเอกสาร</button>' : '') +
            '</div>' +
            (expanded ? customerDetailHtml(q) : '') +
            '</div>';
        }).join('') +
        '</div>';
    }

    app.innerHTML = html;

    if (state.signingId) {
      setupSignaturePad();
      document.getElementById('btnSubmitSign').addEventListener('click', submitSignature);
      document.getElementById('btnCancelSign').addEventListener('click', closeSignPanel);
    } else if (state.rejectingId) {
      Array.prototype.forEach.call(document.querySelectorAll('.rejectFieldCheck'), function (cb) {
        cb.addEventListener('change', function () { state.rejectChecked[cb.getAttribute('data-key')] = cb.checked; });
      });
      document.getElementById('rejectNoteInput').addEventListener('input', function (e) { state.rejectNote = e.target.value; });
      document.getElementById('btnConfirmReject').addEventListener('click', submitReject);
      document.getElementById('btnCancelReject').addEventListener('click', closeRejectPanel);
    } else if (!state.loading && !state.error) {
      Array.prototype.forEach.call(document.querySelectorAll('.btnOpenSign'), function (btn) {
        btn.addEventListener('click', function () { openSignPanel(btn.getAttribute('data-id')); });
      });
      Array.prototype.forEach.call(document.querySelectorAll('.btnToggleExpand'), function (btn) {
        btn.addEventListener('click', function () { toggleExpand(btn.getAttribute('data-id')); });
      });
      Array.prototype.forEach.call(document.querySelectorAll('.btnDownloadContract'), function (btn) {
        btn.addEventListener('click', function () { downloadContractFor(btn.getAttribute('data-submission-id'), btn.getAttribute('data-so')); });
      });
      Array.prototype.forEach.call(document.querySelectorAll('.btnOpenReject'), function (btn) {
        btn.addEventListener('click', function () { openRejectPanel(btn.getAttribute('data-id')); });
      });
      Array.prototype.forEach.call(document.querySelectorAll('.btnCopyRejectLink'), function (btn) {
        btn.addEventListener('click', function () {
          copyLinkToken(btn.getAttribute('data-token'));
          var original = btn.textContent;
          btn.textContent = '✅ คัดลอกแล้ว';
          setTimeout(function () { btn.textContent = original; }, 1500);
        });
      });
    }
  }

  loadQueue();
  loadSavedSignature(); // ยิงพร้อมกับ loadQueue ไม่ต้องรอกัน (คนละ endpoint ไม่เกี่ยวข้องกัน)
}
