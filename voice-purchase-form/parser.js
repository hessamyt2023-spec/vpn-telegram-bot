/*
 * Persian speech → actions on the «لیست خرید» purchase form.
 *
 * Pure text processing (no DOM, no browser APIs), so the same file runs in the
 * page and under `node --test`. Every utterance goes through:
 *   normalize → fractions → number words to digits → field segmentation → units
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FormParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const FIELDS = ['kala', 'type', 'qty', 'desc'];
  const FIELD_LABELS = { kala: 'کالا', type: 'نوع', qty: 'تعداد', desc: 'توضیحات' };

  // ---------------------------------------------------------------------------
  // Characters
  // ---------------------------------------------------------------------------

  function normalize(text) {
    return String(text == null ? '' : text)
      .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/[يى]/g, 'ی')
      .replace(/ك/g, 'ک')
      .replace(/ۀ/g, 'ه')
      .replace(/[ً-ٰٟ]/g, '')
      .replace(/٫/g, '.')
      .replace(/٬/g, ',')
      .replace(/[‌‍‎‏ ]/g, ' ')
      .replace(/(\d)[,،](?=\d)/g, '$1\u0001') // keep «4,3» from the form
      .replace(/[،,؛;!؟?«»"]/g, ' ')
      .replace(/\u0001/g, ',')
      .replace(/\.(?=\s|$)/g, ' ') // sentence dots, not 11.0592
      .replace(/:/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const lower = (t) => (t == null ? '' : String(t).toLowerCase());

  // ---------------------------------------------------------------------------
  // Numbers
  // ---------------------------------------------------------------------------

  // [value, kind]; kind decides what may follow after «و».
  const NUM_WORDS = {
    'صفر': [0, 'one'], 'یک': [1, 'one'], 'یه': [1, 'one'], 'یکی': [1, 'one'],
    'یدونه': [1, 'one'], 'یکدونه': [1, 'one'],
    'دو': [2, 'one'], 'سه': [3, 'one'], 'چهار': [4, 'one'], 'چار': [4, 'one'],
    'پنج': [5, 'one'], 'شش': [6, 'one'], 'شیش': [6, 'one'], 'هفت': [7, 'one'],
    'هشت': [8, 'one'], 'نه': [9, 'one'],
    'ده': [10, 'teen'], 'یازده': [11, 'teen'], 'دوازده': [12, 'teen'], 'سیزده': [13, 'teen'],
    'چهارده': [14, 'teen'], 'چارده': [14, 'teen'], 'پانزده': [15, 'teen'], 'پونزده': [15, 'teen'],
    'شانزده': [16, 'teen'], 'شونزده': [16, 'teen'], 'هفده': [17, 'teen'], 'هیفده': [17, 'teen'],
    'هجده': [18, 'teen'], 'هیجده': [18, 'teen'], 'هژده': [18, 'teen'], 'نوزده': [19, 'teen'],
    'بیست': [20, 'ten'], 'سی': [30, 'ten'], 'چهل': [40, 'ten'], 'چل': [40, 'ten'],
    'پنجاه': [50, 'ten'], 'شصت': [60, 'ten'], 'هفتاد': [70, 'ten'], 'هشتاد': [80, 'ten'],
    'نود': [90, 'ten'],
    'صد': [100, 'hundred'], 'یکصد': [100, 'hundred'], 'دویست': [200, 'hundred'],
    'سیصد': [300, 'hundred'], 'چهارصد': [400, 'hundred'], 'چارصد': [400, 'hundred'],
    'پانصد': [500, 'hundred'], 'پونصد': [500, 'hundred'], 'ششصد': [600, 'hundred'],
    'شیشصد': [600, 'hundred'], 'هفتصد': [700, 'hundred'], 'هشتصد': [800, 'hundred'],
    'نهصد': [900, 'hundred'],
    'هزار': [1000, 'scale'], 'میلیون': [1e6, 'scale'], 'میلیارد': [1e9, 'scale'],
  };
  const ORDINAL_SPECIAL = { 'اول': 1, 'نخست': 1, 'سوم': 3 };
  // «سی» is also the letter C: آی سی (IC), دی سی (DC), پی سی بی (PCB), سی دی (CD)…
  const C_BEFORE = new Set(['آی', 'ای', 'دی', 'پی', 'ال', 'آر', 'ام', 'اس']);
  const C_AFTER = new Set(['دی', 'پی']);

  function ordinalValue(t) {
    if (t === 'سیم' || t === 'سیمین') return null; // «سیم» is wire, not 30th
    if (ORDINAL_SPECIAL[t] !== undefined) return [ORDINAL_SPECIAL[t], 'one'];
    if (t.length > 3 && t.endsWith('ین')) {
      const r = ordinalValue(t.slice(0, -2)); // اولین، دومین، پنجمین
      if (r) return r;
    }
    if (t.length > 1 && t.endsWith('م')) {
      const stem = t.slice(0, -1);
      if (stem !== 'یه' && stem !== 'یکی' && NUM_WORDS[stem]) return NUM_WORDS[stem];
    }
    return null;
  }

  function numberToken(toks, k) {
    const t = toks[k];
    if (t == null) return null;
    if (/^\d+(\.\d+)?$/.test(t)) return { v: Number(t), kind: 'digits', raw: t };
    if (t === 'سی' && (C_BEFORE.has(toks[k - 1]) || C_AFTER.has(toks[k + 1]))) return null;
    const w = NUM_WORDS[t];
    if (w) return { v: w[0], kind: w[1] };
    const o = ordinalValue(t);
    if (o) return { v: o[0], kind: o[1], ordinal: true };
    return null;
  }

  // Reads one spoken number starting at toks[i]: «هزار و چهارصد و پنج» → 1405.
  function readNumber(toks, i, noDecimal) {
    let total = 0;
    let current = 0;
    let limit = Infinity;
    let lastScale = Infinity;
    let j = i;
    let any = false;
    let ordinal = false;
    let raw = null;

    while (j < toks.length && !ordinal) {
      let k = j;
      const hasAnd = any && toks[k] === 'و';
      if (hasAnd) k++;
      const w = numberToken(toks, k);
      if (!w) break;
      if (w.kind === 'scale') {
        if (hasAnd || w.v >= lastScale || (any && current === 0)) break;
        total += (current || 1) * w.v;
        current = 0;
        lastScale = w.v;
        limit = w.v;
      } else {
        if (any && !hasAnd) break;
        if (!(w.v < limit)) break;
        current += w.v;
        limit = w.kind === 'hundred' ? 100 : w.kind === 'ten' ? 10 : 0;
        if (!any && w.kind === 'digits') raw = w.raw;
      }
      any = true;
      j = k + 1;
      if (w.ordinal) ordinal = true;
    }
    if (!any) return null;

    const value = total + current;
    let text = raw !== null && j === i + 1 ? raw : String(value);
    if (!ordinal && toks[j] === 'ام') {
      ordinal = true; // «سی ام»
      j++;
    }
    if (!ordinal && !noDecimal) {
      if ((toks[j] === 'ممیز' || toks[j] === 'اعشار') && numberToken(toks, j + 1)) {
        let frac = '';
        j++;
        while (j < toks.length && numberToken(toks, j)) {
          const n = readNumber(toks, j, true);
          if (!n || n.ordinal) break;
          frac += n.text;
          j = n.end;
        }
        text = String(value) + '.' + frac;
      } else if (toks[j] === 'و' && toks[j + 1] === 'نیم') {
        text = String(value + 0.5);
        j += 2;
      }
    }
    return { value: Number(text), text, end: j, ordinal };
  }

  // «دوتا» → «دو تا», «۵تا» → «5 تا»
  function splitGlued(tok) {
    const m = /^(.+?)(تا|تایی)$/.exec(tok);
    if (m && (NUM_WORDS[m[1]] || /^\d+$/.test(m[1]))) return [m[1], 'تا'];
    return [tok];
  }

  function tokenize(text) {
    const norm = normalize(text);
    if (!norm) return [];
    return norm.split(' ').flatMap(splitGlued);
  }

  const FRACTIONS = { 'دوم': '1/2', 'سوم': '1/3', 'چهارم': '1/4', 'هشتم': '1/8' };

  // «یک چهارم وات» → «1/4 وات», «بیست و پنج» → «25», «ششم» → «6».
  function wordsToDigits(text) {
    const toks = tokenize(text);
    const out = [];
    for (let i = 0; i < toks.length;) {
      if ((toks[i] === 'یک' || toks[i] === '1') && FRACTIONS[toks[i + 1]] &&
          (toks[i - 1] === undefined || !numberToken(toks, i - 1) || toks[i - 1] === 'و')) {
        out.push(FRACTIONS[toks[i + 1]]);
        i += 2;
        continue;
      }
      const n = readNumber(toks, i);
      if (n) {
        out.push(n.text);
        i = n.end;
      } else {
        out.push(toks[i]);
        i++;
      }
    }
    return out.join(' ');
  }

  function extractQty(text) {
    const m = /(\d+(?:\.\d+)?)/.exec(wordsToDigits(text));
    return m ? m[1] : null;
  }

  // ---------------------------------------------------------------------------
  // Electronic units: «صد نانو» → 100NF, «هزار میکرو بیست و پنج ولت» → 1000UF/25V
  // ---------------------------------------------------------------------------

  const NUM = '(\\d+(?:[.*/]\\d+)*)';
  const END = '(?![\\p{L}\\p{N}])';
  const START = '(?<![\\p{L}\\p{N}])';
  const unit = (words, out) => [new RegExp(NUM + '\\s*(?:' + words + ')' + END, 'gu'), out];
  const word = (words, out) => [new RegExp(START + '(?:' + words + ')' + END, 'gu'), out];

  const UNIT_RULES = [
    [new RegExp(NUM + '\\s*(?:در|ضربدر|ضرب در|×|x|X)\\s*' + NUM + END, 'gu'), '$1*$2'],
    unit('پیکو ?فاراد|پیکو|pf', '$1PF'),
    unit('نانو ?فاراد|نانو|nf', '$1NF'),
    unit('میکرو ?فاراد|میکرو|uf|µf', '$1UF'),
    unit('فاراد', '$1F'),
    unit('مگا ?هرتز|مگ', '$1MHz'),
    unit('کیلو ?هرتز', '$1kHz'),
    unit('هرتز', '$1Hz'),
    unit('کیلو ?اهم', '$1K OHM'),
    unit('مگا ?اهم', '$1M OHM'),
    unit('کیلو', '$1K'),
    unit('اهم', '$1 OHM'),
    unit('میلی ?ولت', '$1mV'),
    unit('ولت', '$1V'),
    unit('میلی ?آمپر', '$1mA'),
    unit('وات', '$1W'),
    unit('میلی ?متر|میلیمتر', '$1 MM'),
    [/(\d+(?:\.\d+)?[PNU]F)\s+(\d+(?:\.\d+)?V)(?![\p{L}\p{N}])/gu, '$1/$2'],
    [new RegExp(START + '(?:دیپ|دیب)\\s*(\\d+)' + END, 'gu'), 'DIP-$1'],
    word('دیپ|دیب', 'DIP'),
    [new RegExp(START + 'تی او\\s*(\\d+)' + END, 'gu'), 'TO-$1'],
    word('اس ام دی|اسمدی', 'SMD'),
    word('ال ای دی', 'LED'),
    word('یو اس بی', 'USB'),
    word('پی سی بی', 'PCB'),
  ];

  function applyUnits(text) {
    let s = String(text || '');
    for (const [re, out] of UNIT_RULES) s = s.replace(re, out);
    return s.replace(/\s+/g, ' ').trim();
  }

  // ---------------------------------------------------------------------------
  // Command vocabulary
  // ---------------------------------------------------------------------------

  const FIELD_KEYWORDS = [
    ['kala', ['نام کالا', 'اسم کالا', 'کالا', 'اسم', 'نام', 'item', 'part', 'name']],
    ['type', ['نوع', 'نوعش', 'پکیج', 'پکیچ', 'تایپ', 'type', 'package']],
    ['qty', ['تعداد', 'تعدادش', 'مقدار', 'quantity', 'qty', 'count']],
    ['desc', ['توضیحات', 'توضیح', 'توضیحاتش', 'شرح', 'یادداشت', 'description', 'note', 'notes']],
  ]
    .flatMap(([field, list]) => list.map((p) => [field, p.split(' ')]))
    .sort((a, b) => b[1].length - a[1].length);

  const GLOBAL = {
    stop: ['تمام', 'تموم', 'بسه', 'توقف', 'استپ', 'قطع', 'خاموش', 'میکروفون خاموش', 'کافیه', 'پایان', 'stop'],
    undo: ['برگرد', 'برگردون', 'واگرد', 'لغو', 'آندو', 'بازگشت', 'undo'],
    redo: ['انجام دوباره', 'redo'],
    next: ['بعدی', 'بعد', 'رد', 'رد شو', 'عبور', 'خالی', 'هیچی', 'ندارد', 'نداره', 'next', 'skip'],
    prev: ['قبلی', 'قبل', 'عقب', 'previous', 'back'],
    save: ['ذخیره', 'سیو', 'save'],
    print: ['چاپ', 'پرینت', 'print'],
    newForm: ['فرم جدید', 'لیست جدید', 'لیست خرید جدید', 'new form'],
    langEn: ['انگلیسی', 'زبان انگلیسی', 'english'],
    langFa: ['فارسی', 'زبان فارسی', 'persian', 'farsi'],
    help: ['راهنما', 'کمک', 'help'],
  };
  const GLOBAL_LOOKUP = new Map();
  for (const [type, phrases] of Object.entries(GLOBAL)) {
    for (const p of phrases) GLOBAL_LOOKUP.set(p, type);
  }

  const POLITE = new Set(['لطفا', 'لطفاً', 'خب', 'خوب', 'اوکی', 'please', 'ok', 'okay']);
  const VERB_FILLERS = new Set(['کن', 'بکن', 'شو', 'بشه', 'بزن', 'رو', 'را', 'بده', 'please']);
  const VALUE_LEAD = new Set(['رو', 'را', 'هم', 'بشه', 'میشه', 'باشه', 'بنویس', 'بذار', 'بزار', 'بگذار', 'بزن', 'برابر', 'مساوی', 'is']);
  const VALUE_TRAIL = new Set(['باشه', 'باشد', 'هست', 'است', 'بشه', 'بشود', 'کن', 'بکن', 'بنویس', 'بذار', 'بزار', 'رو', 'را', 'لطفا']);
  const CLEAR_WORDS = new Set(['پاک', 'پاکش', 'حذف', 'خالی', 'هیچی', 'clear', 'delete']);
  const DELETE_WORDS = new Set(['حذف', 'پاک', 'پاکش', 'بردار', 'delete', 'remove']);
  const ADD_WORDS = new Set(['اضافه', 'افزودن', 'بیافزا', 'بیفزا', 'add']);
  const ROW_WORDS = new Set(['ردیف', 'سطر', 'row', 'line']);
  const PREFIX_NOISE = new Set(['کن', 'بکن', 'رو', 'را', 'شه', 'بشه', 'شود', 'برو', 'به', 'انتخاب', 'هم', 'و', 'لطفا', 'go', 'to', 'the', 'select']);
  const COUNTERS = '(?:تا|عدد|دونه|دانه|pcs|x)';

  function matchKeyword(toks, i) {
    for (const [field, words] of FIELD_KEYWORDS) {
      if (words.every((w, k) => lower(toks[i + k]) === w)) return { field, len: words.length };
    }
    return null;
  }

  function stripFillers(toks) {
    return toks.filter((t) => !POLITE.has(lower(t)) && !VERB_FILLERS.has(lower(t)));
  }

  function matchGlobal(toks) {
    const phrase = lower(stripFillers(toks).join(' '));
    const type = GLOBAL_LOOKUP.get(phrase);
    return type ? { type } : null;
  }

  function cleanValue(toks) {
    const t = toks.slice();
    while (t.length && VALUE_LEAD.has(lower(t[0]))) t.shift();
    while (t.length && VALUE_TRAIL.has(lower(t[t.length - 1]))) t.pop();
    return t.join(' ').trim();
  }

  function segment(toks) {
    const prefix = [];
    const parts = {};
    let cur = null;
    for (let i = 0; i < toks.length;) {
      const m = matchKeyword(toks, i);
      if (m) {
        cur = m.field;
        parts[cur] = [];
        i += m.len;
        continue;
      }
      (cur ? parts[cur] : prefix).push(toks[i]);
      i++;
    }
    return { prefix, parts };
  }

  // Finds «ردیف ۳», «ردیف جدید», «آخرین ردیف», «همین ردیف»… and returns the rest.
  function parseRowRef(prefix) {
    for (let i = 0; i < prefix.length; i++) {
      if (!ROW_WORDS.has(lower(prefix[i]))) continue;
      const next = lower(prefix[i + 1]);
      const before = prefix[i - 1];
      const rest = prefix.slice(0, i);
      let ref = null;
      let used = 1;
      if (/^\d+$/.test(next)) { ref = { row: Number(next) }; used = 2; }
      else if (['جدید', 'تازه', 'new'].includes(next)) { ref = { add: true }; used = 2; }
      else if (['آخر', 'آخری', 'last'].includes(next)) { ref = { last: true }; used = 2; }
      else if (['قبلی', 'قبل', 'previous'].includes(next)) { ref = { prev: true }; used = 2; }
      else if (['بعدی', 'بعد', 'next'].includes(next)) { ref = { next: true }; used = 2; }
      else if (before === 'آخرین') { ref = { last: true }; rest.pop(); }
      else if (before === 'این' || before === 'همین') { ref = { active: true }; rest.pop(); }
      else ref = { active: true };
      return { ref, rest: rest.concat(prefix.slice(i + used)) };
    }
    return { ref: null, rest: prefix };
  }

  function fieldsFromParts(parts, units) {
    const fields = {};
    const problems = [];
    for (const [field, toks] of Object.entries(parts)) {
      const value = cleanValue(toks);
      if (CLEAR_WORDS.has(value)) {
        fields[field] = '';
      } else if (field === 'qty') {
        const q = extractQty(value);
        if (q === null) problems.push('تعداد را به صورت عدد بگویید، مثلا «تعداد سه».');
        else fields.qty = q;
      } else if (value) {
        fields[field] = units ? applyUnits(value) : value;
      }
    }
    return { fields, problems };
  }

  // «پنج تا مقاومت صد اهم» → { qty: '5', kala: 'مقاومت 100 OHM' }
  function parseFree(text, units) {
    let qty = null;
    let kala = text;
    let m = new RegExp('^(\\d+(?:\\.\\d+)?)\\s*' + COUNTERS + '\\s+(.+)$').exec(text);
    if (m) {
      qty = m[1];
      kala = m[2];
    } else if ((m = new RegExp('^(.+?)\\s+(\\d+(?:\\.\\d+)?)\\s*' + COUNTERS + '$').exec(text))) {
      kala = m[1];
      qty = m[2];
    }
    const fields = { kala: units ? applyUnits(kala) : kala };
    if (qty !== null) fields.qty = qty;
    return fields;
  }

  // ---------------------------------------------------------------------------
  // Jalali (Persian) calendar
  // ---------------------------------------------------------------------------

  function gregorianToJalali(gy, gm, gd) {
    const gdm = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    const gy2 = gm > 2 ? gy + 1 : gy;
    let days = 355666 + 365 * gy + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) +
      Math.floor((gy2 + 399) / 400) + gd + gdm[gm - 1];
    let jy = -1595 + 33 * Math.floor(days / 12053);
    days %= 12053;
    jy += 4 * Math.floor(days / 1461);
    days %= 1461;
    if (days > 365) {
      jy += Math.floor((days - 1) / 365);
      days = (days - 1) % 365;
    }
    const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
    const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
    return [jy, jm, jd];
  }

  const pad2 = (n) => String(n).padStart(2, '0');
  const formatJalali = (y, m, d) => y + '/' + pad2(m) + '/' + pad2(d);

  function todayJalali(date) {
    const d = date || new Date();
    const [y, m, dd] = gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
    return formatJalali(y, m, dd);
  }

  const MONTHS = {
    'فروردین': 1, 'اردیبهشت': 2, 'خرداد': 3, 'تیر': 4, 'مرداد': 5, 'امرداد': 5,
    'شهریور': 6, 'مهر': 7, 'آبان': 8, 'آذر': 9, 'دی': 10, 'بهمن': 11, 'اسفند': 12,
  };
  const RELATIVE_DAYS = { 'امروز': 0, 'دیروز': -1, 'فردا': 1, 'پریروز': -2, 'today': 0, 'yesterday': -1, 'tomorrow': 1 };
  const DATE_NOISE = new Set(['رو', 'را', 'بذار', 'بزار', 'بزن', 'بنویس', 'کن', 'به', 'ماه', 'سال', 'روز', 'برابر', 'هست', 'باشه']);

  function validDate(y, m, d) {
    return y >= 1300 && y <= 1500 && m >= 1 && m <= 12 && d >= 1 && d <= (m <= 6 ? 31 : 30);
  }

  function parseDate(toks, ctx) {
    const t = toks.filter((x) => !DATE_NOISE.has(x));
    const today = ctx.today || new Date();
    if (t.includes('پس') && t.includes('فردا')) {
      return { type: 'date', value: todayJalali(new Date(today.getTime() + 2 * 864e5)) };
    }
    for (const x of t) {
      if (RELATIVE_DAYS[lower(x)] !== undefined) {
        const d = new Date(today.getTime() + RELATIVE_DAYS[lower(x)] * 864e5);
        return { type: 'date', value: todayJalali(d) };
      }
    }
    const joined = t.join(' ');
    let y, m, d;
    const slash = /(\d{4})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{1,2})/.exec(joined);
    if (slash) {
      [y, m, d] = [Number(slash[1]), Number(slash[2]), Number(slash[3])];
    } else {
      const mi = t.findIndex((x) => MONTHS[x]);
      const num = (x) => (/^\d+$/.test(x) ? Number(x) : null);
      if (mi >= 0) {
        m = MONTHS[t[mi]];
        d = t.slice(0, mi).map(num).filter((n) => n !== null).pop();
        y = t.slice(mi + 1).map(num).find((n) => n !== null && n >= 1000);
        if (d === undefined) d = t.slice(mi + 1).map(num).find((n) => n !== null && n <= 31);
        if (y === undefined) y = ctx.year || Number(todayJalali(today).slice(0, 4));
      } else {
        const nums = t.map(num).filter((n) => n !== null);
        if (nums.length === 3) {
          if (nums[0] >= 1300) [y, m, d] = nums;
          else if (nums[2] >= 1300) [d, m, y] = nums;
        }
      }
    }
    if (validDate(y, m, d)) return { type: 'date', value: formatJalali(y, m, d) };
    return { type: 'error', message: 'تاریخ را مثل «تاریخ ششم مهر ۱۴۰۵» یا «تاریخ امروز» بگویید.' };
  }

  // ---------------------------------------------------------------------------
  // Public parsers
  // ---------------------------------------------------------------------------

  function prepare(raw) {
    let toks = wordsToDigits(raw).split(' ').filter(Boolean);
    while (toks.length > 1 && POLITE.has(lower(toks[0]))) toks.shift();
    // «نه، تعداد پنج» — a leading «no» before a keyword is not the number nine.
    if (toks[0] === '9' && /^نه$/.test(normalize(raw).split(' ')[0]) && toks.length > 1 &&
        (matchKeyword(toks, 1) || ROW_WORDS.has(lower(toks[1])))) {
      toks = toks.slice(1);
    }
    return toks;
  }

  /**
   * Free-form command mode. ctx: { units: bool, year: number, today: Date }
   * Returns one action: add | update | delete | select | date | stop | undo | … | error | unknown
   */
  function parseCommand(raw, ctx) {
    ctx = ctx || {};
    const units = ctx.units !== false;
    const toks = prepare(raw);
    if (!toks.length) return { type: 'empty' };

    const global = matchGlobal(toks);
    if (global) return global;

    const head = stripFillers(toks);
    if (head[0] === 'تاریخ' || lower(head[0]) === 'date') return parseDate(head.slice(1), ctx);

    const { prefix, parts } = segment(toks);
    const { ref, rest } = parseRowRef(prefix);
    const { fields, problems } = fieldsFromParts(parts, units);
    if (problems.length && !Object.keys(fields).length) return { type: 'error', message: problems[0] };

    const restWords = rest.filter((t) => !PREFIX_NOISE.has(lower(t)));
    const wantsDelete = restWords.some((t) => DELETE_WORDS.has(lower(t)));
    const wantsAdd = (ref && ref.add) || restWords.some((t) => ADD_WORDS.has(lower(t)));
    const freeText = restWords
      .filter((t) => !DELETE_WORDS.has(lower(t)) && !ADD_WORDS.has(lower(t)) && lower(t) !== 'جدید')
      .join(' ');
    const hasFields = Object.keys(parts).length > 0;
    const target = ref && !ref.add ? ref : null;

    if (wantsDelete && !hasFields && !freeText) {
      if (!target) return { type: 'error', message: 'بگویید کدام ردیف، مثلا «حذف ردیف ۵» یا «حذف ردیف آخر».' };
      return { type: 'delete', target };
    }
    if (wantsAdd) {
      const extra = freeText ? parseFree(freeText, units) : {};
      return { type: 'add', fields: Object.assign(extra, fields), problems };
    }
    if (hasFields) {
      if (target) return { type: 'update', target, fields, problems };
      if ('kala' in fields) return { type: 'add', fields, problems };
      return { type: 'update', target: { active: true }, fields, problems };
    }
    if (target && !freeText) return { type: 'select', target };
    if (target) return { type: 'update', target, fields: parseFree(freeText, units) };
    if (freeText) return { type: 'add', fields: parseFree(freeText, units) };
    return { type: 'unknown', text: normalize(raw) };
  }

  /**
   * Cell-by-cell mode: the utterance is the value of `field`, unless it is a
   * global command or starts like a full command (ردیف…، تاریخ…، کالا…).
   */
  function parseGuided(raw, field, ctx) {
    ctx = ctx || {};
    const toks = prepare(raw);
    if (!toks.length) return { type: 'empty' };
    const global = matchGlobal(toks);
    if (global) return global;
    const first = lower(stripFillers(toks)[0]);
    if (matchKeyword(toks, 0) || ROW_WORDS.has(first) || first === 'تاریخ' || DELETE_WORDS.has(first) ||
        (first === 'آخرین' && ROW_WORDS.has(lower(toks[1])))) {
      return parseCommand(raw, ctx);
    }
    const value = cleanValue(toks);
    if (field === 'qty') {
      const q = extractQty(value);
      if (q === null) return { type: 'error', message: 'برای «تعداد» یک عدد بگویید، مثلا «سه» یا «دوازده تا».' };
      return { type: 'fill', field, value: q };
    }
    return { type: 'fill', field, value: ctx.units === false ? value : applyUnits(value) };
  }

  return {
    FIELDS,
    FIELD_LABELS,
    normalize,
    wordsToDigits,
    applyUnits,
    extractQty,
    parseCommand,
    parseGuided,
    gregorianToJalali,
    todayJalali,
    formatJalali,
  };
});
