'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../parser.js');

test('number words become digits', () => {
  const cases = [
    ['بیست و پنج', '25'],
    ['هزار و چهارصد و پنج', '1405'],
    ['صد و بیست اهم', '120 اهم'],
    ['دوتا خازن', '2 تا خازن'],
    ['بیست و پنج هزار', '25000'],
    ['یک میلیون و دویست هزار', '1200000'],
    ['یازده ممیز صفر پنج نه دو', '11.0592'],
    ['یازده ممیز صفر پونصد و نود و دو', '11.0592'],
    ['دو و نیم', '2.5'],
    ['ردیف سوم', 'ردیف 3'],
    ['ردیف دوازدهم', 'ردیف 12'],
    ['سی ام', '30'],
    ['برای گزینه چهار و سه', 'برای گزینه 4 و 3'],
    ['۱۲ عدد', '12 عدد'],
    ['یک چهارم وات', '1/4 وات'],
  ];
  for (const [input, expected] of cases) assert.equal(P.wordsToDigits(input), expected, input);
});

test('letters that sound like numbers stay letters', () => {
  assert.equal(P.wordsToDigits('پایه آی سی بیست و هشت پین'), 'پایه آی سی 28 پین');
  assert.equal(P.wordsToDigits('سیم دار'), 'سیم دار');
  assert.equal(P.wordsToDigits('دی سی'), 'دی سی');
});

test('electronic units follow the form notation', () => {
  const cases = [
    ['100 نانو', '100NF'],
    ['22 پیکو', '22PF'],
    ['1000 میکرو 25 ولت', '1000UF/25V'],
    ['470 میکروفاراد 16 ولت', '470UF/16V'],
    ['100 اهم', '100 OHM'],
    ['10 کیلو اهم', '10K OHM'],
    ['کریستال 11.0592 مگاهرتز', 'کریستال 11.0592MHz'],
    ['دیپ 28', 'DIP-28'],
    ['تی او 92', 'TO-92'],
    ['خازن 20 در 10 میلیمتر', 'خازن 20*10 MM'],
    ['1/4 وات', '1/4W'],
    ['میکروکنترلر', 'میکروکنترلر'],
  ];
  for (const [input, expected] of cases) assert.equal(P.applyUnits(input), expected, input);
});

test('a full row in one sentence', () => {
  const a = P.parseCommand('کالا صد نانو نوع عدسی تعداد دو توضیحات خازن');
  assert.deepEqual(a, {
    type: 'add',
    fields: { kala: '100NF', type: 'عدسی', qty: '2', desc: 'خازن' },
    problems: [],
  });
});

test('free sentence with a counter word', () => {
  assert.deepEqual(P.parseCommand('پنج تا مقاومت صد اهم'), {
    type: 'add',
    fields: { kala: 'مقاومت 100 OHM', qty: '5' },
  });
  assert.deepEqual(P.parseCommand('خازن هزار میکرو بیست و پنج ولت سه عدد'), {
    type: 'add',
    fields: { kala: 'خازن 1000UF/25V', qty: '3' },
  });
  assert.deepEqual(P.parseCommand('یه دونه بازر'), { type: 'add', fields: { kala: 'بازر', qty: '1' } });
});

test('editing, selecting and deleting rows', () => {
  assert.deepEqual(P.parseCommand('ردیف سه تعداد چهار'), {
    type: 'update', target: { row: 3 }, fields: { qty: '4' }, problems: [],
  });
  assert.deepEqual(P.parseCommand('ردیف دوازده توضیحات برای گزینه دو'), {
    type: 'update', target: { row: 12 }, fields: { desc: 'برای گزینه 2' }, problems: [],
  });
  assert.deepEqual(P.parseCommand('ردیف ۳ توضیحات پاک کن'), {
    type: 'update', target: { row: 3 }, fields: { desc: '' }, problems: [],
  });
  assert.deepEqual(P.parseCommand('تعداد رو بذار شش'), {
    type: 'update', target: { active: true }, fields: { qty: '6' }, problems: [],
  });
  assert.deepEqual(P.parseCommand('نه تعداد پنج'), {
    type: 'update', target: { active: true }, fields: { qty: '5' }, problems: [],
  });
  assert.deepEqual(P.parseCommand('ردیف ۵'), { type: 'select', target: { row: 5 } });
  assert.deepEqual(P.parseCommand('ردیف سوم رو پاک کن'), { type: 'delete', target: { row: 3 } });
  assert.deepEqual(P.parseCommand('حذف ردیف آخر'), { type: 'delete', target: { last: true } });
  assert.deepEqual(P.parseCommand('آخرین ردیف رو حذف کن'), { type: 'delete', target: { last: true } });
  assert.equal(P.parseCommand('حذف کن').type, 'error');
  assert.deepEqual(P.parseCommand('ردیف جدید'), { type: 'add', fields: {}, problems: [] });
  assert.deepEqual(P.parseCommand('row 3 quantity 4'), {
    type: 'update', target: { row: 3 }, fields: { qty: '4' }, problems: [],
  });
});

test('global commands', () => {
  assert.equal(P.parseCommand('برگرد').type, 'undo');
  assert.equal(P.parseCommand('تمام').type, 'stop');
  assert.equal(P.parseCommand('لطفا ذخیره کن').type, 'save');
  assert.equal(P.parseCommand('انگلیسی').type, 'langEn');
  assert.equal(P.parseCommand('Persian').type, 'langFa');
});

test('dates', () => {
  const today = new Date(2026, 9, 10); // 18 Mehr 1405
  assert.deepEqual(P.parseCommand('تاریخ ششم مهر هزار و چهارصد و پنج'), { type: 'date', value: '1405/07/06' });
  assert.deepEqual(P.parseCommand('تاریخ امروز', { today }), { type: 'date', value: '1405/07/18' });
  assert.deepEqual(P.parseCommand('تاریخ رو بذار دیروز', { today }), { type: 'date', value: '1405/07/17' });
  assert.deepEqual(P.parseCommand('تاریخ بیستم آبان', { year: 1405 }), { type: 'date', value: '1405/08/20' });
  assert.deepEqual(P.parseCommand('تاریخ ۱۴۰۵/۰۷/۰۶'), { type: 'date', value: '1405/07/06' });
  assert.equal(P.parseCommand('تاریخ سی و دو مهر').type, 'error');
});

test('cell-by-cell values', () => {
  assert.deepEqual(P.parseGuided('بیست و دو پیکو', 'kala'), { type: 'fill', field: 'kala', value: '22PF' });
  assert.deepEqual(P.parseGuided('دیپ بیست و هشت', 'type'), { type: 'fill', field: 'type', value: 'DIP-28' });
  assert.deepEqual(P.parseGuided('سه تا', 'qty'), { type: 'fill', field: 'qty', value: '3' });
  assert.deepEqual(P.parseGuided('برای گزینه دو', 'desc'), { type: 'fill', field: 'desc', value: 'برای گزینه 2' });
  assert.equal(P.parseGuided('بعدی', 'kala').type, 'next');
  assert.equal(P.parseGuided('خالی', 'desc').type, 'next');
  assert.equal(P.parseGuided('سلام', 'qty').type, 'error');
  assert.deepEqual(P.parseGuided('ردیف ۴', 'kala'), { type: 'select', target: { row: 4 } });
});

test('Jalali calendar', () => {
  assert.deepEqual(P.gregorianToJalali(2026, 10, 10), [1405, 7, 18]);
  assert.deepEqual(P.gregorianToJalali(2026, 9, 28), [1405, 7, 6]);
  assert.deepEqual(P.gregorianToJalali(2026, 3, 21), [1405, 1, 1]);
  assert.deepEqual(P.gregorianToJalali(2025, 3, 20), [1403, 12, 30]);
});
