// Shared validation helpers for the contract intake form.
// Pure functions, no DOM — usable from both the browser (public/sign.js) and
// a Vercel function (api/contract-generate.js) for server-side re-validation.

// input[type=date] เนทีฟของเบราว์เซอร์แสดงผลตาม locale ของเครื่อง ไม่ใช่ dd/mm/yyyy เสมอไป — ใช้แปลง
// ค่า ISO (yyyy-mm-dd) ของ input ให้เป็นข้อความ dd/mm/yyyy แสดงคู่กัน กันสับสนว่า 10/05 คือวันไหนกันแน่
function isoToDDMMYYYY(iso) {
  if (!iso) return '';
  const parts = String(iso).split('-');
  if (parts.length !== 3) return '';
  return parts[2] + '/' + parts[1] + '/' + parts[0];
}

function isValidThaiCitizenId(id) {
  const digits = String(id || '').replace(/\D/g, '');
  if (digits.length !== 13) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits[i]) * (13 - i);
  const checkDigit = (11 - (sum % 11)) % 10;
  return checkDigit === Number(digits[12]);
}

function isValidThaiMobile(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return /^0[689]\d{8}$/.test(digits);
}

// เกณฑ์อายุ: 19 ปีบริบูรณ์ขึ้นไป อนุโลมได้ถ้าจะครบ 19 ปีภายใน 3 เดือนนับจากวันทำสัญญา
// dob / contractDate: 'YYYY-MM-DD' หรือ Date
function requiresGuardian(dob, contractDate) {
  const birth = dob instanceof Date ? dob : new Date(dob);
  const contract = contractDate instanceof Date ? contractDate : new Date(contractDate);
  if (isNaN(birth) || isNaN(contract)) return null; // ข้อมูลไม่พอตัดสิน

  const nineteenthBirthday = new Date(birth);
  nineteenthBirthday.setFullYear(birth.getFullYear() + 19);

  if (contract >= nineteenthBirthday) return false; // ครบ 19 ปีบริบูรณ์แล้ว ไม่ต้องมีผู้ปกครอง

  const graceStart = new Date(nineteenthBirthday);
  graceStart.setMonth(graceStart.getMonth() - 3);
  if (contract >= graceStart) return false; // อยู่ในช่วงอนุโลม 3 เดือนก่อนวันเกิดครบ 19 ปี

  return true; // ยังห่างวันเกิดครบ 19 ปีเกิน 3 เดือน ต้องมีผู้ปกครอง
}

function calcAge(dob, atDate) {
  const birth = dob instanceof Date ? dob : new Date(dob);
  const at = atDate instanceof Date ? atDate : new Date(atDate || Date.now());
  if (isNaN(birth) || isNaN(at)) return null;
  let age = at.getFullYear() - birth.getFullYear();
  const hasHadBirthdayThisYear =
    at.getMonth() > birth.getMonth() ||
    (at.getMonth() === birth.getMonth() && at.getDate() >= birth.getDate());
  if (!hasHadBirthdayThisYear) age -= 1;
  return age;
}

// ตารางผ่อนแบบหารเท่า ๆ กัน เศษที่หารไม่ลงตัวไปตกที่งวดสุดท้าย (กันปัดเศษสตางค์เพี้ยน
// แบบเดียวกับที่ debt-tracker เจอปัญหามาแล้ว — ดู memory splitEvenlyRounded)
function buildInstallmentSchedule(totalAmount, installmentCount, firstDueDate) {
  const count = Number(installmentCount) || 0;
  if (count <= 0) return [];
  const totalSatang = Math.round(Number(totalAmount) * 100);
  const baseSatang = Math.floor(totalSatang / count);
  const remainderSatang = totalSatang - baseSatang * count;

  const first = firstDueDate instanceof Date ? firstDueDate : new Date(firstDueDate);
  const rows = [];
  for (let i = 0; i < count; i++) {
    const due = new Date(first);
    due.setMonth(due.getMonth() + i);
    const satang = baseSatang + (i === count - 1 ? remainderSatang : 0);
    rows.push({ no: i + 1, dueDate: due, amount: satang / 100 });
  }
  return rows;
}

// เลขที่สัญญา: SALMONyyyymmdd-xxxxx (2026-09-03 ตามที่ user ระบุ) — yyyymmdd คือวันที่ทำสัญญา, xxxxx คือเลข
// ลำดับ 5 หลักท้ายของเลข SO ที่ผูกอยู่แล้ว (รูปแบบเลข SO จริงคือ SO-YYYYMMDDNNNNN มี 5 หลักท้ายไม่ซ้ำกันอยู่แล้ว
// ยืมมาใช้ตรงๆ แทนที่จะต้องมีตัวนับส่วนกลางเพิ่มอีกชุด — ระบบนี้ยังไม่มี DB จริงให้นับลำดับเองได้)
function buildContractNo(contractDateIso, soNumber) {
  const d = contractDateIso instanceof Date ? contractDateIso : new Date(contractDateIso);
  if (isNaN(d)) return '';
  const pad2 = (n) => String(n).padStart(2, '0');
  const yyyymmdd = d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate());
  const digits = String(soNumber || '').replace(/\D/g, '');
  const seq = digits.slice(-5).padStart(5, '0');
  return 'SALMON' + yyyymmdd + '-' + seq;
}

// แปลงจำนวนเงิน (บาท) เป็นตัวอักษรไทย เช่น 25900 -> "สองหมื่นห้าพันเก้าร้อยบาทถ้วน"
// ใช้เติมฟิลด์ {ราคา__ดาวน์__ภาษาไทย} ฯลฯ ในเทมเพลตสัญญา — สูตรมาตรฐานภาษาไทย (หน่วย/สิบ/ร้อย/พัน/หมื่น/แสน/ล้าน,
// กรณีพิเศษ "เอ็ด" ท้ายหลักหน่วยเมื่อไม่ใช่ตัวเดียว, "ยี่สิบ" แทน "สองสิบ")
function numberToThaiBahtText(amount) {
  const DIGIT_TH = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  const POSITION_TH = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน', 'ล้าน'];

  function convertIntegerGroup(numStr) {
    let result = '';
    const len = numStr.length;
    for (let i = 0; i < len; i++) {
      const digit = Number(numStr[i]);
      const posFromRight = len - i - 1;
      if (digit === 0) continue;
      if (posFromRight === 0 && digit === 1 && len > 1) {
        result += 'เอ็ด';
      } else if (posFromRight === 1 && digit === 2) {
        result += 'ยี่สิบ';
      } else if (posFromRight === 1 && digit === 1) {
        result += 'สิบ';
      } else {
        result += DIGIT_TH[digit] + POSITION_TH[posFromRight % 7];
      }
    }
    return result;
  }

  function convertInteger(intStr) {
    intStr = intStr.replace(/^0+(?=\d)/, '');
    if (intStr === '0' || intStr === '') return 'ศูนย์';
    // ตัดเป็นกลุ่มละ 6 หลัก (หลักล้าน) จากขวาไปซ้าย แล้วต่อด้วย "ล้าน" ซ้ำได้ตามจำนวนกลุ่ม
    const groups = [];
    let s = intStr;
    while (s.length > 0) {
      groups.unshift(s.slice(-6));
      s = s.slice(0, -6);
    }
    return groups.map(function (g, i) {
      const isLast = i === groups.length - 1;
      const text = convertIntegerGroup(g);
      return text + (isLast ? '' : 'ล้าน');
    }).join('');
  }

  const num = Math.round(Math.abs(Number(amount) || 0) * 100) / 100; // กันเศษทศนิยมเพี้ยนจาก floating point
  const baht = Math.floor(num);
  const satang = Math.round((num - baht) * 100);
  let text = convertInteger(String(baht)) + 'บาท';
  text += satang > 0 ? convertInteger(String(satang)) + 'สตางค์' : 'ถ้วน';
  return text;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isoToDDMMYYYY,
    isValidThaiCitizenId,
    isValidThaiMobile,
    requiresGuardian,
    calcAge,
    buildInstallmentSchedule,
    numberToThaiBahtText,
    buildContractNo,
  };
}
