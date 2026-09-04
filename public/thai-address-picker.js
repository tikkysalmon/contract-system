// เครื่องมือกรอกที่อยู่แบบ cascading dropdown จังหวัด -> อำเภอ/เขต -> ตำบล/แขวง (2026-09-04)
// ใช้ dataset จริงจาก kongvut/thai-province-data (77 จังหวัด/930 อำเภอ/7452 ตำบล พร้อมรหัสไปรษณีย์)
// บังคับให้เลือกได้เฉพาะชุดที่มีอยู่จริง (เลือกอำเภอได้เฉพาะของจังหวัดที่เลือกไว้ ฯลฯ) แทนการให้พิมพ์อิสระ —
// นี่คือวิธี "ตรวจสอบ" ที่ user ขอ (กันพิมพ์ผิด/พิมพ์ตำบล-อำเภอ-จังหวัดไม่ตรงกันจริง) ใช้ซ้ำได้ 2 จุด
// (ที่อยู่ปัจจุบัน + ที่อยู่จัดส่ง) ผ่าน attachAddressPicker(prefix, addr, onChange)

(function () {
  'use strict';

  var dataPromise = null;
  function loadThaiAddressData() {
    if (!dataPromise) {
      dataPromise = fetch('assets/thai-address-data.json').then(function (r) {
        if (!r.ok) throw new Error('โหลดข้อมูลจังหวัด/อำเภอ/ตำบลไม่สำเร็จ');
        return r.json();
      });
    }
    return dataPromise;
  }

  // opts: { detailLabel } — คืน HTML string ของฟิลด์ที่อยู่ทั้งชุด (เรียก wireAddressPicker ต่อหลัง innerHTML แล้ว)
  function addressFieldsHtml(prefix, addr, opts) {
    opts = opts || {};
    return (
      '<div class="field" id="' + prefix + '_detail_field">' +
      '<label for="' + prefix + '_detail">' + (opts.detailLabel || 'บ้านเลขที่ / หมู่บ้าน / ถนน') + ' <span class="req">*</span></label>' +
      '<input type="text" id="' + prefix + '_detail" value="' + (addr.detail || '').replace(/"/g, '&quot;') + '" placeholder="เช่น 123/45 หมู่ 6 ถนนสุขุมวิท" autocomplete="off" />' +
      '<div class="err"></div>' +
      '</div>' +
      '<div class="row2">' +
      '<div class="field" id="' + prefix + '_province_field">' +
      '<label for="' + prefix + '_province">จังหวัด <span class="req">*</span></label>' +
      '<select id="' + prefix + '_province" disabled><option value="">กำลังโหลดข้อมูล...</option></select>' +
      '<div class="err"></div>' +
      '</div>' +
      '<div class="field" id="' + prefix + '_district_field">' +
      '<label for="' + prefix + '_district">อำเภอ/เขต <span class="req">*</span></label>' +
      '<select id="' + prefix + '_district" disabled><option value="">— เลือกจังหวัดก่อน —</option></select>' +
      '<div class="err"></div>' +
      '</div>' +
      '</div>' +
      '<div class="row2">' +
      '<div class="field" id="' + prefix + '_subdistrict_field">' +
      '<label for="' + prefix + '_subdistrict">ตำบล/แขวง <span class="req">*</span></label>' +
      '<select id="' + prefix + '_subdistrict" disabled><option value="">— เลือกอำเภอ/เขตก่อน —</option></select>' +
      '<div class="err"></div>' +
      '</div>' +
      '<div class="field">' +
      '<label for="' + prefix + '_zip">รหัสไปรษณีย์</label>' +
      '<input type="text" id="' + prefix + '_zip" value="' + (addr.zip || '') + '" readonly />' +
      '</div>' +
      '</div>'
    );
  }

  // เรียกหลังจากใส่ addressFieldsHtml() ลง DOM แล้วเท่านั้น — โหลด dataset (ครั้งแรกครั้งเดียว ที่เหลือ cache
  // ไว้ใน dataPromise) แล้วเติม option ให้ select ทั้ง 3 ระดับ พร้อม cascading + preselect ค่าเดิมถ้ามี
  // (กรณีย้อนกลับมาหน้านี้ระหว่างกรอกฟอร์ม) onChange(addr) เรียกทุกครั้งที่ค่าที่อยู่เปลี่ยน
  function wireAddressPicker(prefix, addr, onChange) {
    var detailEl = document.getElementById(prefix + '_detail');
    var provinceEl = document.getElementById(prefix + '_province');
    var districtEl = document.getElementById(prefix + '_district');
    var subdistrictEl = document.getElementById(prefix + '_subdistrict');
    var zipEl = document.getElementById(prefix + '_zip');

    detailEl.addEventListener('input', function (e) { addr.detail = e.target.value; onChange(addr); });

    loadThaiAddressData().then(function (data) {
      provinceEl.disabled = false;
      provinceEl.innerHTML = '<option value="">— เลือก —</option>' +
        data.provinces.map(function (p) { return '<option value="' + p.id + '">' + p.name + '</option>'; }).join('');
      if (addr.provinceId) provinceEl.value = String(addr.provinceId);
      fillDistricts(data);

      provinceEl.addEventListener('change', function () {
        addr.provinceId = provinceEl.value || '';
        addr.provinceName = provinceEl.selectedOptions[0] ? provinceEl.selectedOptions[0].textContent : '';
        addr.districtId = ''; addr.districtName = '';
        addr.subdistrictId = ''; addr.subdistrictName = ''; addr.zip = '';
        zipEl.value = '';
        fillDistricts(data);
        onChange(addr);
      });
      districtEl.addEventListener('change', function () {
        addr.districtId = districtEl.value || '';
        addr.districtName = districtEl.selectedOptions[0] ? districtEl.selectedOptions[0].textContent : '';
        addr.subdistrictId = ''; addr.subdistrictName = ''; addr.zip = '';
        zipEl.value = '';
        fillSubdistricts(data);
        onChange(addr);
      });
      subdistrictEl.addEventListener('change', function () {
        addr.subdistrictId = subdistrictEl.value || '';
        var opt = subdistrictEl.selectedOptions[0];
        addr.subdistrictName = opt ? opt.textContent.split(' (')[0] : '';
        addr.zip = opt ? (opt.getAttribute('data-zip') || '') : '';
        zipEl.value = addr.zip;
        onChange(addr);
      });
    }).catch(function (err) {
      provinceEl.innerHTML = '<option value="">โหลดข้อมูลไม่สำเร็จ ลองรีเฟรชหน้านี้</option>';
      console.error(err);
    });

    function fillDistricts(data) {
      var list = data.districts.filter(function (d) { return String(d.provinceId) === String(addr.provinceId); });
      districtEl.disabled = !addr.provinceId;
      districtEl.innerHTML = addr.provinceId
        ? '<option value="">— เลือก —</option>' + list.map(function (d) { return '<option value="' + d.id + '">' + d.name + '</option>'; }).join('')
        : '<option value="">— เลือกจังหวัดก่อน —</option>';
      if (addr.districtId) districtEl.value = String(addr.districtId);
      fillSubdistricts(data);
    }
    function fillSubdistricts(data) {
      var list = data.subdistricts.filter(function (s) { return String(s.districtId) === String(addr.districtId); });
      subdistrictEl.disabled = !addr.districtId;
      subdistrictEl.innerHTML = addr.districtId
        ? '<option value="">— เลือก —</option>' + list.map(function (s) { return '<option value="' + s.id + '" data-zip="' + s.zip + '">' + s.name + ' (' + s.zip + ')</option>'; }).join('')
        : '<option value="">— เลือกอำเภอ/เขตก่อน —</option>';
      if (addr.subdistrictId) { subdistrictEl.value = String(addr.subdistrictId); zipEl.value = addr.zip || ''; }
    }
  }

  function isAddressComplete(addr) {
    return !!(addr && addr.detail && addr.detail.trim() && addr.provinceId && addr.districtId && addr.subdistrictId);
  }

  window.attachAddressPicker = { html: addressFieldsHtml, wire: wireAddressPicker, isComplete: isAddressComplete };
})();
