// เครื่องมือกรอกที่อยู่แบบ cascading จังหวัด -> อำเภอ/เขต -> ตำบล/แขวง (2026-09-04)
// ใช้ dataset จริงจาก kongvut/thai-province-data (77 จังหวัด/930 อำเภอ/7452 ตำบล พร้อมรหัสไปรษณีย์)
// บังคับให้เลือกได้เฉพาะชุดที่มีอยู่จริง (เลือกอำเภอได้เฉพาะของจังหวัดที่เลือกไว้ ฯลฯ) แทนการให้พิมพ์อิสระ —
// นี่คือวิธี "ตรวจสอบ" ที่ user ขอ (กันพิมพ์ผิด/พิมพ์ตำบล-อำเภอ-จังหวัดไม่ตรงกันจริง) ใช้ซ้ำได้ 2 จุด
// (ที่อยู่ปัจจุบัน + ที่อยู่จัดส่ง) ผ่าน attachAddressPicker(prefix, addr, onChange)
//
// 2026-09-06 (user ขอ): เปลี่ยนจาก <select> เดิม (ต้องพิมพ์/เลื่อนหาชื่อเต็มในลิสต์ยาว 7,452 ตำบล) เป็นช่อง
// พิมพ์ค้นหาแบบ combobox — พิมพ์บางส่วนของชื่อคำไหนก็ได้ กรองจากลิสต์ที่อนุญาต (ยังเป็น cascading เหมือนเดิม
// เลือกอำเภอได้เฉพาะของจังหวัดที่เลือกไว้) แล้วค่อยคลิก/กด Enter เลือกจากลิสต์ที่กรองแล้ว ยังคง "บังคับเลือกจาก
// ชุดที่มีอยู่จริง" เหมือนเดิม — พิมพ์เฉยๆ ไม่ถือว่าเลือกแล้วจนกว่าจะคลิก/Enter เลือกจริง (blur แล้วไม่ตรงจะ
// เด้งกลับค่าที่เลือกล่าสุด กันข้อมูลเพี้ยน)

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
    function comboFieldHtml(id, label, placeholder) {
      return (
        '<div class="field" id="' + id + '_field">' +
        '<label for="' + id + '">' + label + ' <span class="req">*</span></label>' +
        '<div class="combo-wrap" id="' + id + '_wrap">' +
        '<input type="text" id="' + id + '" placeholder="' + placeholder + '" disabled autocomplete="off" />' +
        '</div>' +
        '<div class="err"></div>' +
        '</div>'
      );
    }
    return (
      '<div class="field" id="' + prefix + '_detail_field">' +
      '<label for="' + prefix + '_detail">' + (opts.detailLabel || 'บ้านเลขที่ / หมู่บ้าน / ถนน') + ' <span class="req">*</span></label>' +
      '<input type="text" id="' + prefix + '_detail" value="' + (addr.detail || '').replace(/"/g, '&quot;') + '" placeholder="เช่น 123/45 หมู่ 6 ถนนสุขุมวิท" autocomplete="off" />' +
      '<div class="err"></div>' +
      '</div>' +
      '<div class="row2">' +
      comboFieldHtml(prefix + '_province', 'จังหวัด', 'กำลังโหลดข้อมูล...') +
      comboFieldHtml(prefix + '_district', 'อำเภอ/เขต', '— เลือกจังหวัดก่อน —') +
      '</div>' +
      '<div class="row2">' +
      comboFieldHtml(prefix + '_subdistrict', 'ตำบล/แขวง', '— เลือกอำเภอ/เขตก่อน —') +
      '<div class="field">' +
      '<label for="' + prefix + '_zip">รหัสไปรษณีย์</label>' +
      '<input type="text" id="' + prefix + '_zip" value="' + (addr.zip || '') + '" readonly />' +
      '</div>' +
      '</div>'
    );
  }

  // combobox แบบ generic ใช้ซ้ำได้ทั้ง 3 ระดับ (จังหวัด/อำเภอ/ตำบล) — พิมพ์กรองจาก list ปัจจุบัน (getList เรียก
  // สดทุกครั้งเพราะ list ของอำเภอ/ตำบลเปลี่ยนตามระดับบนที่เลือกไว้) เลือกได้เฉพาะรายการที่กรองเจอจริงเท่านั้น
  // (พิมพ์เฉยๆ ไม่ commit ค่า — ต้องคลิก/Enter) list item: { id, name, zip? }
  function createCombobox(id, opts) {
    var inputEl = document.getElementById(id);
    var wrapEl = document.getElementById(id + '_wrap');
    var panel = null;
    var filtered = [];
    var activeIndex = -1;
    var selected = null; // { id, name, zip? } — ค่าที่ยืนยันแล้วจริง (commit แล้ว)

    function closePanel() {
      if (!panel) return;
      panel.remove();
      panel = null;
      document.removeEventListener('mousedown', onOutsideMouseDown, true);
    }
    function onOutsideMouseDown(e) {
      if (wrapEl.contains(e.target)) return;
      revertIfUnmatched();
      closePanel();
    }
    function revertIfUnmatched() {
      inputEl.value = selected ? selected.name : '';
    }

    function renderPanel() {
      if (!panel) return;
      if (!filtered.length) {
        panel.innerHTML = '<div class="combo-empty">ไม่พบรายการที่ตรงกัน</div>';
        return;
      }
      panel.innerHTML = filtered.map(function (item, i) {
        return '<div class="combo-option' + (i === activeIndex ? ' active' : '') + '" data-idx="' + i + '">' + item.name + (item.zip ? ' (' + item.zip + ')' : '') + '</div>';
      }).join('');
      Array.prototype.forEach.call(panel.querySelectorAll('.combo-option'), function (el) {
        el.addEventListener('mousedown', function (e) {
          e.preventDefault(); // กัน blur ยิงก่อน click (จะไป revert ค่าทิ้งก่อนเลือกได้)
          pick(filtered[Number(el.getAttribute('data-idx'))]);
        });
      });
    }

    function openPanelWithCurrentText() {
      if (inputEl.disabled) return;
      filtered = filterList(inputEl.value);
      activeIndex = -1;
      if (!panel) {
        panel = document.createElement('div');
        panel.className = 'combo-panel';
        wrapEl.appendChild(panel);
        setTimeout(function () { document.addEventListener('mousedown', onOutsideMouseDown, true); }, 0);
      }
      renderPanel();
    }

    function filterList(text) {
      var list = opts.getList();
      var q = text.trim().toLowerCase();
      if (!q) return list;
      return list.filter(function (item) { return item.name.toLowerCase().indexOf(q) !== -1; });
    }

    function pick(item) {
      selected = item;
      inputEl.value = item.name;
      closePanel();
      opts.onPick(item);
    }

    inputEl.addEventListener('focus', openPanelWithCurrentText);
    inputEl.addEventListener('input', openPanelWithCurrentText);
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { revertIfUnmatched(); closePanel(); return; }
      if (!panel) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); activeIndex = Math.min(activeIndex + 1, filtered.length - 1); renderPanel(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); activeIndex = Math.max(activeIndex - 1, 0); renderPanel(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (activeIndex >= 0 && filtered[activeIndex]) pick(filtered[activeIndex]); }
    });

    return {
      // เรียกตอน dataset โหลดเสร็จ/ระดับบนเปลี่ยน — เซ็ตค่าเริ่มต้น (ถ้ามีของเดิมค้างอยู่ตอนย้อนกลับมาหน้านี้) + enable/disable
      reset: function (opts2) {
        opts2 = opts2 || {};
        selected = opts2.selected || null;
        inputEl.value = selected ? selected.name : '';
        inputEl.disabled = !!opts2.disabled;
        inputEl.placeholder = opts2.placeholder || '';
        closePanel();
      },
    };
  }

  // เรียกหลังจากใส่ addressFieldsHtml() ลง DOM แล้วเท่านั้น — โหลด dataset (ครั้งแรกครั้งเดียว ที่เหลือ cache
  // ไว้ใน dataPromise) แล้ว wire combobox ทั้ง 3 ระดับ พร้อม cascading + preselect ค่าเดิมถ้ามี (กรณีย้อนกลับ
  // มาหน้านี้ระหว่างกรอกฟอร์ม) onChange(addr) เรียกทุกครั้งที่ค่าที่อยู่เปลี่ยน
  function wireAddressPicker(prefix, addr, onChange) {
    var detailEl = document.getElementById(prefix + '_detail');
    var zipEl = document.getElementById(prefix + '_zip');
    detailEl.addEventListener('input', function (e) { addr.detail = e.target.value; onChange(addr); });

    var data = null; // เซ็ตหลัง dataset โหลดเสร็จ — ก่อนหน้านั้น input ยัง disabled อยู่ getList จึงไม่ถูกเรียกจริง
    // สร้าง combobox แค่ครั้งเดียวต่อฟิลด์ (ผูก event listener ครั้งเดียว) — ไม่สร้างซ้ำตอน dataset โหลดเสร็จ
    // เพราะจะทำให้มี listener ซ้อนกัน 2 ชุดบน input เดียวกัน
    var provinceCombo = createCombobox(prefix + '_province', {
      getList: function () { return data ? data.provinces.map(function (p) { return { id: p.id, name: p.name }; }) : []; },
      onPick: function (item) {
        addr.provinceId = item.id; addr.provinceName = item.name;
        addr.districtId = ''; addr.districtName = '';
        addr.subdistrictId = ''; addr.subdistrictName = ''; addr.zip = '';
        zipEl.value = '';
        resetDistrict();
        resetSubdistrict();
        onChange(addr);
      },
    });
    var districtCombo = createCombobox(prefix + '_district', {
      getList: function () {
        if (!data) return [];
        return data.districts.filter(function (d) { return String(d.provinceId) === String(addr.provinceId); })
          .map(function (d) { return { id: d.id, name: d.name }; });
      },
      onPick: function (item) {
        addr.districtId = item.id; addr.districtName = item.name;
        addr.subdistrictId = ''; addr.subdistrictName = ''; addr.zip = '';
        zipEl.value = '';
        resetSubdistrict();
        onChange(addr);
      },
    });
    var subdistrictCombo = createCombobox(prefix + '_subdistrict', {
      getList: function () {
        if (!data) return [];
        return data.subdistricts.filter(function (s) { return String(s.districtId) === String(addr.districtId); })
          .map(function (s) { return { id: s.id, name: s.name, zip: s.zip }; });
      },
      onPick: function (item) {
        addr.subdistrictId = item.id; addr.subdistrictName = item.name; addr.zip = item.zip || '';
        zipEl.value = addr.zip;
        onChange(addr);
      },
    });

    loadThaiAddressData().then(function (loaded) {
      data = loaded;
      provinceCombo.reset({
        selected: addr.provinceId ? { id: addr.provinceId, name: addr.provinceName } : null,
        disabled: false,
        placeholder: '— พิมพ์เพื่อค้นหาจังหวัด —',
      });
      resetDistrict();
      resetSubdistrict();
    }).catch(function (err) {
      var provinceEl = document.getElementById(prefix + '_province');
      provinceEl.placeholder = 'โหลดข้อมูลไม่สำเร็จ ลองรีเฟรชหน้านี้';
      console.error(err);
    });

    function resetDistrict() {
      districtCombo.reset({
        selected: addr.districtId ? { id: addr.districtId, name: addr.districtName } : null,
        disabled: !addr.provinceId,
        placeholder: addr.provinceId ? '— พิมพ์เพื่อค้นหาอำเภอ/เขต —' : '— เลือกจังหวัดก่อน —',
      });
    }
    function resetSubdistrict() {
      subdistrictCombo.reset({
        selected: addr.subdistrictId ? { id: addr.subdistrictId, name: addr.subdistrictName } : null,
        disabled: !addr.districtId,
        placeholder: addr.districtId ? '— พิมพ์เพื่อค้นหาตำบล/แขวง —' : '— เลือกอำเภอ/เขตก่อน —',
      });
    }
  }

  function isAddressComplete(addr) {
    return !!(addr && addr.detail && addr.detail.trim() && addr.provinceId && addr.districtId && addr.subdistrictId);
  }

  window.attachAddressPicker = { html: addressFieldsHtml, wire: wireAddressPicker, isComplete: isAddressComplete };
})();
