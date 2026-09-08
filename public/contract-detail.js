// หน้าแสดง "ดูข้อมูลลูกค้า" แบบเต็ม เปิดเป็นแท็บใหม่แยกจากตาราง (2026-09-08 user ขอ — เดิมกางแถวขยายอยู่ใน
// ตารางเดียวกับตารางกว้างที่เลื่อนแนวนอนได้ ทำให้ต้องเลื่อนหน้าเว็บไปมาเพื่อดูข้อมูล) เปิดจากปุ่ม "ดูข้อมูลลูกค้า"
// ในตาราง "ข้อมูลลูกค้าทำสัญญา" (staff-sign-tab.js) — ใช้ /api/staff-sign-queue เดิม (ไม่เพิ่ม endpoint ใหม่
// กันเกินโควต้า 12 ฟังก์ชันของ Vercel Hobby plan) แล้วกรองหา submissionId ที่ต้องการเอง
//
// 2026-09-08 รอบ 2: user ขอเพิ่มปุ่ม "ดาวน์โหลดสัญญา" และ "ปฏิเสธ/ขอแก้ไขข้อมูล" กลับมาไว้ที่หน้านี้ด้วย
// (ตอนแรกย้ายไปอยู่ในแถวตารางอย่างเดียว) — พอร์ต downloadContractFor/correctionStatusHtml/reject panel มาจาก
// staff-sign-tab.js (ปรับให้ทำงานกับ item เดียวแทนทั้งคิว) — ปุ่ม "เปลี่ยน SO" ไม่ได้ขอมาด้วยรอบนี้ ยังอยู่แค่
// ในแถวตารางเหมือนเดิม (flow หลายขั้นตอน ค้นหา SO ใหม่จาก CRM ฯลฯ ไม่คุ้มจะพอร์ตมาซ้ำอีกที่ถ้าไม่มีคนขอ)
//
// ⚠️ บั๊กจริงที่เจอ (2026-09-08): ตอนแรกอ่าน user/department จาก sessionStorage เดียวกับ app.js เอง โดยหวังพึ่ง
// พฤติกรรม browser ที่ "ควร" copy sessionStorage ให้แท็บใหม่อัตโนมัติเวลาเปิดด้วย target="_blank" — ทดสอบจริงบน
// production แล้วไม่ทำงาน (พฤติกรรมนี้ implement ไม่ตรงกันระหว่างเบราว์เซอร์ มักใช้ได้จริงแค่ตอนเปิดด้วย
// window.open() ที่เรียกจาก JS โดยตรง ไม่ใช่จาก href ธรรมดา) ทำให้ต้องล็อกอินซ้ำทุกครั้งทั้งที่ล็อกอินอยู่แล้ว
// — เปลี่ยนมาให้ staff-sign-tab.js ส่ง username/department มาทาง URL query string ตรงๆ แทน (?user=...&dept=...)
// ชัดเจนแน่นอน ไม่พึ่งพฤติกรรม browser ที่ไม่แน่นอน (ระบบนี้เป็น mock login ยังไม่ใช่ auth จริงอยู่แล้ว ไม่กระทบ
// ความปลอดภัยเพิ่มจากเดิม) — ยังอ่าน sessionStorage เป็น fallback ไว้เผื่อเปิดหน้านี้ตรงๆ โดยไม่ผ่านลิงก์
// ใช้: initContractDetailView('containerElementId')
function initContractDetailView(containerId) {
  'use strict';

  var SESSION_KEY = 'staffLoginSession';
  var FULL_ACCESS_DEPARTMENTS = ['บัญชี', 'ผู้จัดการ'];

  var state = {
    loading: true, error: null, item: null, user: null,
    rejecting: false, rejectChecked: {}, rejectNote: '', rejectSubmitting: false, rejectError: null,
  };

  var REJECT_GROUPS = [
    { key: 'personal', label: 'ข้อมูลส่วนตัว' },
    { key: 'address', label: 'ที่อยู่และบุคคลอ้างอิง' },
    { key: 'guardian', label: 'ข้อมูลผู้ปกครอง', onlyIf: 'hasGuardian' },
    { key: 'guarantor', label: 'ข้อมูลผู้ค้ำประกัน', onlyIf: 'hasGuarantor' },
    { key: 'uploads', label: 'รูปเอกสารที่แนบ (บัตร/เซลฟี่)' },
  ];
  var CORRECTION_GROUP_LABELS = {
    personal: 'ข้อมูลส่วนตัว', address: 'ที่อยู่และบุคคลอ้างอิง',
    guardian: 'ข้อมูลผู้ปกครอง', guarantor: 'ข้อมูลผู้ค้ำประกัน', uploads: 'รูปเอกสารที่แนบ',
    order: 'รายการสินค้า/เลขที่คำสั่งซื้อ (SO)',
  };

  var urlParams = new URLSearchParams(location.search);
  if (urlParams.get('user') && urlParams.get('dept')) {
    state.user = { username: urlParams.get('user'), department: urlParams.get('dept') };
  } else {
    try {
      var stored = sessionStorage.getItem(SESSION_KEY);
      if (stored) state.user = JSON.parse(stored);
    } catch (e) { /* ไม่มี session ก็แค่แสดงข้อความให้กลับไปล็อกอิน */ }
  }

  function fmtDateTime(iso) {
    if (!iso) return '-';
    var d = new Date(iso);
    if (isNaN(d)) return '-';
    return (isoToDDMMYYYY(iso.slice(0, 10)) || '-') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

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
      '<img src="' + url + '" style="width:150px;height:110px;object-fit:cover;border:1px solid var(--border);border-radius:8px;display:block;" />' +
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

  // พอร์ตมาจาก staff-sign-tab.js's correctionStatusHtml ตรงๆ (ใช้ item.sessionToken ตัวจริง ไม่ใช่ item.token
  // ที่ไม่มีอยู่จริง — บั๊กเดิมที่เจอ/แก้พร้อมกันตอนพอร์ตฟังก์ชันนี้มาที่นี่)
  function correctionStatusHtml(item) {
    if (!item.rejectedAt) {
      return '<button type="button" class="btn btn-ghost btn-sm" id="btnOpenReject" style="white-space:nowrap;margin-top:6px;">ปฏิเสธ / ขอแก้ไขข้อมูล</button>';
    }
    var labels = (item.rejectedFields || []).map(function (k) { return CORRECTION_GROUP_LABELS[k] || k; });
    return '<div class="notice" style="margin-top:12px;">' +
      'ส่งกลับให้ลูกค้าแก้ไขแล้ว โดย ' + (item.rejectedBy || '-') + ' เมื่อ ' + fmtDateTime(item.rejectedAt) + '<br>' +
      'รายการที่ต้องแก้: <b>' + (labels.join(', ') || '-') + '</b>' +
      (item.rejectedNote ? '<br>หมายเหตุ: ' + item.rejectedNote : '') +
      '</div>' +
      '<button type="button" class="btn btn-secondary btn-sm" id="btnCopyRejectLink" data-token="' + item.sessionToken + '" style="white-space:nowrap;margin-top:6px;">📋 คัดลอกลิงก์ให้ลูกค้าแก้ไข</button>';
  }

  function openRejectPanel() {
    state.rejecting = true;
    state.rejectChecked = {};
    state.rejectNote = '';
    state.rejectError = null;
    state.rejectSubmitting = false;
    render();
  }
  function closeRejectPanel() { state.rejecting = false; render(); }

  async function submitReject() {
    var rejectedFields = Object.keys(state.rejectChecked).filter(function (k) { return state.rejectChecked[k]; });
    if (!rejectedFields.length) {
      state.rejectError = 'กรุณาติ๊กเลือกอย่างน้อย 1 รายการที่ต้องแก้ไข';
      render();
      return;
    }
    state.rejectSubmitting = true;
    state.rejectError = null;
    render();
    try {
      var res = await fetch('/api/staff-actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reject',
          submissionId: state.item.submissionId,
          staffName: state.user.username,
          rejectedFields: rejectedFields,
          note: state.rejectNote,
        }),
      });
      var body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || 'ปฏิเสธไม่สำเร็จ');
      state.rejecting = false;
      await load(); // โหลดข้อมูลใหม่ ให้เห็นสถานะ "ส่งกลับให้ลูกค้าแก้ไขแล้ว" ทันที
      return;
    } catch (err) {
      state.rejectError = 'ปฏิเสธไม่สำเร็จ: ' + err.message;
    }
    state.rejectSubmitting = false;
    render();
  }

  // พอร์ตมาจาก staff-sign-tab.js's downloadContractFor ตรงๆ (ปรับให้ใช้ state.item เดียวแทนการค้นจากคิว)
  function downloadContractFor(soNumber) {
    var item = state.item;
    var sessionItem = (item.items || []).filter(function (it) { return it.soNumber === soNumber; })[0];
    if (!sessionItem) return;
    var btn = document.getElementById('btnDownloadContract__' + soNumber);
    var errEl = document.getElementById('downloadContractErr__' + soNumber);
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

  function downloadButtonsHtml(item) {
    if (!item.items || !item.items.length) return '';
    return '<div style="margin-top:10px;">' +
      item.items.map(function (it) {
        return '<button type="button" class="btn btn-ghost btn-sm btnDownloadContract" data-so="' + it.soNumber + '" ' +
          'id="btnDownloadContract__' + it.soNumber + '" style="white-space:nowrap;margin:4px 8px 4px 0;">📄 ดาวน์โหลดสัญญา: ' + it.product + '</button>';
      }).join('') +
      item.items.map(function (it) { return '<div class="err" id="downloadContractErr__' + it.soNumber + '"></div>'; }).join('') +
      '</div>';
  }

  async function load() {
    var params = new URLSearchParams(location.search);
    var submissionId = params.get('id');
    if (!submissionId) { state.error = 'ไม่พบ id ของรายการ (เปิดหน้านี้ตรงๆ ไม่ได้ ต้องกดปุ่ม "ดูข้อมูลลูกค้า" จากตาราง)'; state.loading = false; render(); return; }
    state.loading = true;
    render();
    try {
      var res = await fetch('/api/staff-sign-queue');
      var body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || 'โหลดข้อมูลไม่สำเร็จ');
      state.item = (body.queue || []).filter(function (q) { return String(q.submissionId) === submissionId; })[0] || null;
      if (!state.item) state.error = 'ไม่พบรายการนี้ (อาจถูกลบ หรือลิงก์หมดอายุ)';
    } catch (err) {
      state.error = 'โหลดข้อมูลไม่สำเร็จ: ' + err.message;
    }
    state.loading = false;
    render();
  }

  function render() {
    var app = document.getElementById(containerId);
    var html = '';

    if (!state.user) {
      html = '<div class="card"><p style="color:var(--danger);">กรุณาเข้าสู่ระบบที่หน้าเว็บหลักก่อน (<a href="app.html">ไปหน้าเข้าสู่ระบบ</a>)</p></div>';
      app.innerHTML = html;
      return;
    }
    if (FULL_ACCESS_DEPARTMENTS.indexOf(state.user.department) === -1) {
      html = '<div class="card"><p style="color:var(--danger);">แผนกของคุณไม่มีสิทธิ์ดูข้อมูลส่วนตัวลูกค้าเต็มรูปแบบ</p></div>';
      app.innerHTML = html;
      return;
    }
    if (state.loading) { app.innerHTML = '<div class="card">กำลังโหลดข้อมูล...</div>'; return; }
    if (state.error) { app.innerHTML = '<div class="card"><p style="color:var(--danger);">' + state.error + '</p></div>'; return; }

    var item = state.item;
    var hg = hasGuardianGuarantor(item);

    if (state.rejecting) {
      var groups = REJECT_GROUPS.filter(function (g) {
        if (g.onlyIf === 'hasGuardian') return hg.hasGuardian;
        if (g.onlyIf === 'hasGuarantor') return hg.hasGuarantor;
        return true;
      });
      html = '<div class="card">' +
        '<h2>ปฏิเสธ / ขอแก้ไขข้อมูล — ' + item.customerName + '</h2>' +
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
        '<button class="btn btn-primary" id="btnConfirmReject"' + (state.rejectSubmitting ? ' disabled' : '') + '>' + (state.rejectSubmitting ? 'กำลังบันทึก...' : 'ยืนยันปฏิเสธ') + '</button> ' +
        '<button class="btn btn-ghost" id="btnCancelReject">ยกเลิก</button>' +
        '</div>' +
        '</div>';
      app.innerHTML = html;
      Array.prototype.forEach.call(document.querySelectorAll('.rejectFieldCheck'), function (cb) {
        cb.addEventListener('change', function () { state.rejectChecked[cb.getAttribute('data-key')] = cb.checked; });
      });
      document.getElementById('rejectNoteInput').addEventListener('input', function (e) { state.rejectNote = e.target.value; });
      document.getElementById('btnConfirmReject').addEventListener('click', submitReject);
      document.getElementById('btnCancelReject').addEventListener('click', closeRejectPanel);
      return;
    }

    var c = item.customer || {};
    var addr = c.address || {};
    var ship = c.shippingAddress || {};
    var ref = c.reference || {};
    var guardian = c.guardian || {};
    var guarantor = c.guarantor || {};

    html = '<div class="card">' +
      '<h2>ข้อมูลลูกค้า — ' + item.customerName + '</h2>' +
      '<p class="hint">' + (item.items || []).map(function (it) { return it.soNumber + ' (' + it.product + ')'; }).join(', ') + ' — ลูกค้าส่งฟอร์มเมื่อ ' + fmtDateTime(item.submittedAt) + '</p>' +
      '<table class="installment-table" style="margin-bottom:12px;">' +
      infoRow('ชื่อ-นามสกุล', (c.title || '') + (c.firstLastName || '-')) +
      infoRow('อายุ', c.age ? (c.age + ' ปี') : '-') +
      infoRow('เลขบัตรประชาชน', c.citizenId) +
      infoRow('เบอร์โทร', c.phone) +
      infoRow('สัญชาติ', c.nationality) +
      infoRow('ที่อยู่ปัจจุบัน', formatAddress(addr)) +
      infoRow('ที่อยู่จัดส่งสินค้า', ship.sameAsCurrent ? 'ใช้ที่อยู่เดียวกับที่อยู่ปัจจุบัน' : formatAddress(ship)) +
      infoRow('บุคคลอ้างอิง', ref.firstLastName ? (ref.firstLastName + ' (' + (ref.relation || '-') + ') โทร ' + (ref.phone || '-')) : '-') +
      (hg.hasGuardian ? infoRow('ผู้ปกครอง', (guardian.title || '') + guardian.firstLastName + ' โทร ' + (guardian.phone || '-') + ' บัตร ' + (guardian.citizenId || '-')) : '') +
      (hg.hasGuarantor ? infoRow('ผู้ค้ำประกัน', (guarantor.title || '') + guarantor.firstLastName + ' อายุ ' + (guarantor.age || '-') + ' ปี โทร ' + (guarantor.phone || '-') + ' บัตร ' + (guarantor.citizenId || '-')) : '') +
      '</table>' +
      '<div style="margin-bottom:4px;color:var(--muted);font-size:13px;">เอกสารแนบ (คลิกเพื่อดูเต็ม)</div>' +
      fileThumbHtml(item.files.idCard, 'บัตร ปชช. ลูกค้า') +
      fileThumbHtml(item.files.selfieWithId, 'คู่บัตร ลูกค้า') +
      fileThumbHtml(item.files.signature, 'ลายเซ็นลูกค้า') +
      (hg.hasGuardian ? fileThumbHtml(item.files.guardianId, 'บัตร ปชช. ผู้ปกครอง') : '') +
      (hg.hasGuardian ? fileThumbHtml(item.files.guardianSignature, 'ลายเซ็นผู้ปกครอง') : '') +
      (hg.hasGuarantor ? fileThumbHtml(item.files.guarantorId, 'บัตร ปชช. ผู้ค้ำ') : '') +
      (hg.hasGuarantor ? fileThumbHtml(item.files.guarantorSignature, 'ลายเซ็นผู้ค้ำ') : '') +
      (item.files.staffSignature ? fileThumbHtml(item.files.staffSignature, 'ลายเซ็นพนักงาน') : '') +
      downloadButtonsHtml(item) +
      correctionStatusHtml(item) +
      '<p class="hint" style="margin-top:16px;">ปุ่ม "เปลี่ยน SO" ยังต้องกลับไปทำที่แถวตาราง (ต้องค้นหา SO ใหม่จาก CRM หลายขั้นตอน)</p>' +
      '</div>';

    app.innerHTML = html;
    Array.prototype.forEach.call(document.querySelectorAll('.btnDownloadContract'), function (btn) {
      btn.addEventListener('click', function () { downloadContractFor(btn.getAttribute('data-so')); });
    });
    var btnOpenReject = document.getElementById('btnOpenReject');
    if (btnOpenReject) btnOpenReject.addEventListener('click', openRejectPanel);
    var btnCopyRejectLink = document.getElementById('btnCopyRejectLink');
    if (btnCopyRejectLink) {
      btnCopyRejectLink.addEventListener('click', function () {
        copyLinkToken(btnCopyRejectLink.getAttribute('data-token'));
        var original = btnCopyRejectLink.textContent;
        btnCopyRejectLink.textContent = '✅ คัดลอกแล้ว';
        setTimeout(function () { btnCopyRejectLink.textContent = original; }, 1500);
      });
    }
  }

  load();
}
