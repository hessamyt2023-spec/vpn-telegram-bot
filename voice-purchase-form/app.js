/*
 * «لیست خرید صوتی» — the purchase-list form as a web app, filled by Persian voice.
 * State lives in localStorage; parser.js turns speech into actions; voice.js listens.
 */
(function () {
  'use strict';

  const P = window.FormParser;
  const FIELDS = P.FIELDS;
  const LABEL = P.FIELD_LABELS;
  const STORE_KEY = 'voice-purchase-form:v1';
  const inViewer = !!(window.claude && typeof window.claude.use === 'function');

  // The form from «1_30193228293_261006_154625.pdf», row for row.
  const SAMPLE = {
    title: 'لیست خرید',
    date: '1405/07/06',
    rows: [
      ['ATTINY2313A', 'DIP-20', '1', 'میکروکنترلر 8 بیتی'],
      ['ATMEGA8A U', 'DIP-28', '1', 'میکروکنترلر AVR'],
      ['ULN2803AG', 'DIP-18', '1', 'ترانزیستور دارلینگتون'],
      ['PT2272-M4', 'DIP-18', '1', 'آی سی انکودر و دیکودر و مالتی پلکسر'],
      ['پایه آی سی 28 پین', 'DIP-28', '1', 'برای گزینه 2'],
      ['پایه آی سی 20 پین', 'DIP-20', '1', 'برای گزینه 1'],
      ['پایه آی سی 18 پین', 'DIP-18', '2', 'برای گزینه 4,3'],
      ['CRYSTAL 11.0592MHz', 'DIP', '2', 'کریستال'],
      ['78L05', 'DIP(TO-92)', '2', 'رگولاتور خطی'],
      ['1N4007', 'DIP', '9', 'دیود معمولی'],
      ['100 OHM', 'DIP(1.4W)', '1', 'مقاومت'],
      ['120 OHM', 'DIP(1.4W)', '2', 'مقاومت'],
      ['0 OHM', 'DIP(1.4W)', '3', 'مقاومت'],
      ['22PF', 'DIP(عدسی)', '4', 'خازن'],
      ['100NF', 'DIP(عدسی)', '2', 'خازن'],
      ['1000UF/25V', 'الکترولیت', '5', 'خازن MM 20*10'],
      ['100UF/25V', 'الکترولیت', '1', 'خازن MM 6*12'],
      ['470UF/16V', 'الکترولیت', '1', 'خازن MM 8*12'],
      ['رله بچه میلون 12 ولت', '5PIN(DIP)', '4', 'رله'],
      ['KF300(2PIN)', 'DIP', '4', 'کانکتور'],
      ['XH 3pin ST', 'نری روبردی', '1', 'کانکتور'],
      ['سیم دار XH 3pin', 'مادگی طول 10سانت', '2', 'کانکتور'],
      ['کانکتور مخابراتی 3PIN', 'DIP', '1', 'کانکتور مخابراتی'],
      ['جافیوزی درب دار 5*20', 'DIP(5*20)', '1', 'پایه فیوز'],
      ['فیوز شیشه ای (5*20) 4 آمپر', '4 آمپر', '1', 'فیوز'],
      ['SYN470R', 'ماژول', '1', 'ماژول گیرنده'],
      ['ریموت کنترل گزینه فوق', '', '1', 'ریموت'],
      ['فیش آداپتوری سیم دار مادگی', 'سیم دار', '1', 'کانکتور مخابراتی'],
      ['BUZZER(TMB12A05)', 'DIP', '1', 'بازر'],
      ['HEADER (1*12)(2.54MM)MALE RIGHT', 'MALE(RIGHT)', '1', 'پین هدر'],
    ],
  };

  const EXAMPLES = [
    ['کالا صد نانو نوع عدسی تعداد دو توضیحات خازن', 'یک ردیف کامل اضافه می‌کند: 100NF · عدسی · 2 · خازن'],
    ['پنج تا مقاومت صد اهم', 'ردیف جدید با تعداد 5 و کالای «مقاومت 100 OHM»'],
    ['تعداد سه', 'تعداد ردیف انتخاب‌شده را 3 می‌کند'],
    ['ردیف دوازده توضیحات برای گزینه دو', 'توضیحات ردیف 12 را عوض می‌کند'],
    ['کالا هزار میکرو بیست و پنج ولت نوع الکترولیت', 'ردیف جدید: 1000UF/25V · الکترولیت'],
    ['حذف ردیف آخر', 'آخرین ردیف را پاک می‌کند'],
    ['تاریخ ششم مهر هزار و چهارصد و پنج', 'تاریخ فرم: 1405/07/06'],
    ['برگرد', 'آخرین تغییر را برمی‌گرداند'],
  ];

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const uid = () => Math.random().toString(36).slice(2, 10);
  const fa = (n) => Number(n).toLocaleString('fa-IR');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  function makeRow(fields) {
    const row = { id: uid(), kala: '', type: '', qty: '', desc: '' };
    for (const f of FIELDS) if (fields && fields[f] != null) row[f] = String(fields[f]);
    return row;
  }

  function makeForm(opts) {
    opts = opts || {};
    return {
      id: uid(),
      title: opts.title || 'لیست خرید',
      date: opts.date || P.todayJalali(),
      rows: (opts.rows || []).map(makeRow),
      sample: !!opts.sample,
      updatedAt: Date.now(),
    };
  }

  function seed() {
    const form = makeForm({
      title: SAMPLE.title,
      date: SAMPLE.date,
      sample: true,
      rows: SAMPLE.rows.map(([kala, type, qty, desc]) => ({ kala, type, qty, desc })),
    });
    return { forms: [form], currentId: form.id, settings: { mode: 'smart', lang: 'fa-IR', units: true } };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.forms) || !data.forms.length) return null;
      data.settings = Object.assign({ mode: 'smart', lang: 'fa-IR', units: true }, data.settings);
      return data;
    } catch (e) {
      return null;
    }
  }

  const state = load() || seed();
  let saveTimer = 0;
  function persist() {
    const f = current();
    if (f) f.updatedAt = Date.now();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* storage blocked */ }
    }, 200);
  }

  function current() {
    return state.forms.find((f) => f.id === state.currentId) || state.forms[0];
  }

  let downloads = null; // claude.ai viewer's save capability, when the page runs there

  const ui = {
    activeRowId: null,
    cursor: { rowId: null, field: 'kala' }, // rowId null = the next new row
    flash: new Set(),
    log: [],
    editSnapshotTaken: false,
  };

  // Undo history per form, in memory.
  const history = new Map();
  function hist() {
    const id = current().id;
    if (!history.has(id)) history.set(id, { undo: [], redo: [] });
    return history.get(id);
  }
  function snapshot() {
    const f = current();
    return JSON.stringify({ title: f.title, date: f.date, rows: f.rows });
  }
  function restore(json) {
    const f = current();
    const s = JSON.parse(json);
    f.title = s.title;
    f.date = s.date;
    f.rows = s.rows;
  }
  function pushUndo() {
    const h = hist();
    h.undo.push(snapshot());
    if (h.undo.length > 80) h.undo.shift();
    h.redo.length = 0;
    current().sample = false;
  }
  function undo() {
    const h = hist();
    if (!h.undo.length) return false;
    h.redo.push(snapshot());
    restore(h.undo.pop());
    return true;
  }
  function redo() {
    const h = hist();
    if (!h.redo.length) return false;
    h.undo.push(snapshot());
    restore(h.redo.pop());
    return true;
  }

  // ---------------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------------

  const $ = (id) => document.getElementById(id);
  const el = {
    formSelect: $('form-select'),
    title: $('form-title'),
    date: $('form-date'),
    rows: $('rows'),
    summary: $('summary'),
    mic: $('mic'),
    micLabel: $('mic-label'),
    micStatus: $('mic-status'),
    tFinal: $('t-final'),
    tInterim: $('t-interim'),
    lastResult: $('last-result'),
    modeHint: $('mode-hint'),
    notice: $('env-notice'),
    units: $('opt-units'),
    cmdForm: $('cmd-form'),
    cmdInput: $('cmd-input'),
    log: $('log'),
    examples: $('examples'),
    help: $('help'),
    printSheet: $('print-sheet'),
    undo: $('btn-undo'),
    redo: $('btn-redo'),
    print: $('btn-print'),
    csv: $('btn-csv'),
  };

  function rowIndex(id) {
    return current().rows.findIndex((r) => r.id === id);
  }

  function renderFormSelect() {
    el.formSelect.innerHTML = state.forms
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((f) => {
        const n = f.rows.length;
        const label = `${f.title} — ${f.date} (${fa(n)} ردیف)${f.sample ? ' · نمونهٔ PDF' : ''}`;
        return `<option value="${f.id}"${f.id === state.currentId ? ' selected' : ''}>${esc(label)}</option>`;
      })
      .join('');
  }

  function cellHtml(row, index, field) {
    const key = row.id + ':' + field;
    const cls = ['c-' + field];
    if (state.settings.mode === 'guided' && ui.cursor.rowId === row.id && ui.cursor.field === field) cls.push('is-cursor');
    if (ui.flash.has(key)) cls.push('flash');
    const extra = field === 'qty' ? ' inputmode="decimal"' : '';
    return `<td class="${cls.join(' ')}" data-label="${LABEL[field]}"><input id="c-${row.id}-${field}" data-field="${field}" value="${esc(row[field])}" dir="auto" autocomplete="off" aria-label="${LABEL[field]} ردیف ${index + 1}"${extra}></td>`;
  }

  function renderRows() {
    const f = current();
    let html = f.rows.map((row, i) => {
      const active = row.id === ui.activeRowId ? ' class="is-active"' : '';
      return `<tr data-id="${row.id}"${active}><td class="c-idx">${i + 1}</td>${FIELDS.map((fl) => cellHtml(row, i, fl)).join('')}<td class="c-act"><button type="button" class="row-del" data-del="${row.id}" aria-label="حذف ردیف ${i + 1}" title="حذف ردیف">×</button></td></tr>`;
    }).join('');
    if (state.settings.mode === 'guided' && ui.cursor.rowId === null) {
      html += `<tr class="ghost"><td class="c-idx">${f.rows.length + 1}</td><td colspan="4" class="is-cursor">ردیف جدید — «${LABEL[ui.cursor.field]}» را بگویید</td><td class="c-act"></td></tr>`;
    }
    el.rows.innerHTML = html;
    ui.flash.clear();
  }

  function renderSummary() {
    const rows = current().rows;
    const filled = rows.filter((r) => r.kala.trim()).length;
    const total = rows.reduce((s, r) => s + (parseFloat(r.qty) || 0), 0);
    el.summary.textContent = `${fa(rows.length)} ردیف · ${fa(filled)} کالا · مجموع تعداد ${fa(total)} · ذخیرهٔ خودکار در همین مرورگر`;
  }

  function renderPrint() {
    const f = current();
    const rows = f.rows.filter((r) => FIELDS.some((fl) => String(r[fl]).trim()));
    el.printSheet.innerHTML = `<table dir="rtl"><thead>
      <tr><th colspan="2" class="p-title">${esc(f.title)}</th><th colspan="3" class="p-date">تاریخ ${esc(f.date)}</th></tr>
      <tr class="p-head"><th class="p-idx">ردیف</th><th class="p-kala">کالا</th><th class="p-type">نوع</th><th class="p-qty">تعداد</th><th>توضیحات</th></tr>
      </thead><tbody>${rows.map((r, i) => `<tr><td class="p-idx">${i + 1}</td><td class="p-data" dir="auto">${esc(r.kala)}</td><td class="p-data" dir="auto">${esc(r.type)}</td><td class="p-data p-qty">${esc(r.qty)}</td><td dir="auto">${esc(r.desc)}</td></tr>`).join('')}</tbody></table>`;
  }

  function renderHeader() {
    const f = current();
    if (document.activeElement !== el.title) el.title.value = f.title;
    if (document.activeElement !== el.date) el.date.value = f.date;
  }

  function renderControls() {
    document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === state.settings.mode)));
    document.querySelectorAll('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === state.settings.lang)));
    el.units.checked = state.settings.units;
    el.undo.disabled = !hist().undo.length;
    el.redo.disabled = !hist().redo.length;
    el.modeHint.textContent = state.settings.mode === 'guided'
      ? `خانه به خانه: فقط مقدار خانهٔ نارنجی را بگویید (الان: «${LABEL[ui.cursor.field]}» ${cursorRowLabel()}). «بعدی» رد می‌شود، «قبلی» برمی‌گردد.`
      : 'فرمان آزاد: هر جمله یک فرمان است. خانه‌ها را با «کالا»، «نوع»، «تعداد» و «توضیحات» نام ببرید، یا آزاد بگویید: «پنج تا مقاومت صد اهم».';
  }

  function cursorRowLabel() {
    const i = rowIndex(ui.cursor.rowId);
    return i >= 0 ? `در ردیف ${fa(i + 1)}` : 'در ردیف جدید';
  }

  function renderLog() {
    if (!ui.log.length) {
      el.log.innerHTML = '<li class="is-info"><span class="log-empty">هنوز تغییری ثبت نشده. روی میکروفون بزنید و بگویید «کالا صد نانو تعداد دو».</span></li>';
      return;
    }
    el.log.innerHTML = ui.log.slice(0, 6).map((e) => `<li class="is-${e.kind}">
      ${e.heard ? `<span class="heard">«${esc(e.heard)}»</span>` : ''}
      <span class="what">${esc(e.text)}</span>
      ${e.detail ? `<span class="detail" dir="auto">${esc(e.detail)}</span>` : ''}
    </li>`).join('');
  }

  function render() {
    renderFormSelect();
    renderHeader();
    renderRows();
    renderSummary();
    renderControls();
    renderLog();
    renderPrint();
  }

  function addLog(kind, text, heard, detail) {
    ui.log.unshift({ kind, text, heard, detail });
    if (ui.log.length > 30) ui.log.pop();
    // Echo the latest result under the mic, where it is visible on phones too.
    el.lastResult.hidden = false;
    el.lastResult.className = 'last-result is-' + kind;
    el.lastResult.textContent = detail ? `${text} — ${detail}` : text;
  }

  function describeFields(fields) {
    return FIELDS.filter((f) => f in fields).map((f) => `${LABEL[f]}: ${fields[f] === '' ? '(خالی)' : fields[f]}`).join(' · ');
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  function resolveTarget(target) {
    const rows = current().rows;
    const active = rowIndex(ui.activeRowId);
    let i = -1;
    if (target.row) i = target.row - 1;
    else if (target.last) i = rows.length - 1;
    else if (target.active) i = active >= 0 ? active : rows.length - 1;
    else if (target.prev) i = (active >= 0 ? active : rows.length) - 1;
    else if (target.next) i = active + 1;
    return { index: i, row: rows[i] || null };
  }

  function missingRowMessage(target) {
    if (target.row) return `ردیف ${fa(target.row)} وجود ندارد؛ فرم ${fa(current().rows.length)} ردیف دارد.`;
    return 'فرم هنوز ردیفی ندارد. اول یک کالا بگویید.';
  }

  function setActive(rowId) {
    ui.activeRowId = rowId;
  }

  function markFlash(rowId, fields) {
    for (const f of fields) ui.flash.add(rowId + ':' + f);
  }

  function addRow(fields, heard) {
    pushUndo();
    const f = current();
    const values = Object.assign({}, fields);
    if (values.kala && !values.qty && state.settings.mode === 'smart') values.qty = '1';
    const row = makeRow(values);
    f.rows.push(row);
    setActive(row.id);
    markFlash(row.id, FIELDS.filter((k) => values[k]));
    const detail = describeFields(values);
    addLog('ok', `ردیف ${fa(f.rows.length)} اضافه شد`, heard, detail);
    scrollToRow(row.id);
    return row;
  }

  function advanceCursor(step) {
    const rows = current().rows;
    let i = ui.cursor.rowId === null ? rows.length : rowIndex(ui.cursor.rowId);
    let fi = FIELDS.indexOf(ui.cursor.field) + step;
    if (fi >= FIELDS.length) { fi = 0; i++; }
    if (fi < 0) { fi = FIELDS.length - 1; i--; }
    if (i < 0) { i = 0; fi = 0; }
    ui.cursor = { rowId: i < rows.length ? rows[i].id : null, field: FIELDS[fi] };
    if (ui.cursor.rowId) setActive(ui.cursor.rowId);
    scrollToRow(ui.cursor.rowId);
  }

  function apply(action, heard) {
    const f = current();
    switch (action.type) {
      case 'empty':
        return;
      case 'add': {
        const row = addRow(action.fields, heard);
        if (state.settings.mode === 'guided') {
          const firstEmpty = FIELDS.find((k) => !row[k]);
          ui.cursor = { rowId: row.id, field: firstEmpty || 'kala' };
          if (!firstEmpty) advanceCursor(1);
        }
        break;
      }
      case 'update': {
        let { row, index } = resolveTarget(action.target);
        if (!row && action.target.next) {
          addRow(action.fields, heard);
          break;
        }
        if (!row) {
          addLog('error', missingRowMessage(action.target), heard);
          break;
        }
        if (!Object.keys(action.fields).length) {
          addLog('error', (action.problems && action.problems[0]) || 'متوجه نشدم چه چیزی را عوض کنم.', heard);
          break;
        }
        pushUndo();
        Object.assign(row, action.fields);
        setActive(row.id);
        markFlash(row.id, Object.keys(action.fields));
        addLog('ok', `ردیف ${fa(index + 1)} به‌روز شد`, heard, describeFields(action.fields));
        scrollToRow(row.id);
        break;
      }
      case 'delete': {
        const { row, index } = resolveTarget(action.target);
        if (!row) {
          addLog('error', missingRowMessage(action.target), heard);
          break;
        }
        pushUndo();
        f.rows.splice(index, 1);
        if (ui.activeRowId === row.id) setActive(f.rows[Math.min(index, f.rows.length - 1)]?.id || null);
        if (ui.cursor.rowId === row.id) ui.cursor = { rowId: null, field: 'kala' };
        addLog('ok', `ردیف ${fa(index + 1)} حذف شد`, heard, row.kala ? `کالا: ${row.kala} — با «برگرد» برمی‌گردد` : '');
        break;
      }
      case 'select': {
        const { row, index } = resolveTarget(action.target);
        if (!row) {
          addLog('error', missingRowMessage(action.target), heard);
          break;
        }
        setActive(row.id);
        ui.cursor = { rowId: row.id, field: 'kala' };
        addLog('info', `ردیف ${fa(index + 1)} انتخاب شد`, heard, row.kala);
        scrollToRow(row.id);
        break;
      }
      case 'fill': {
        pushUndo();
        let row = f.rows.find((r) => r.id === ui.cursor.rowId);
        if (!row) {
          row = makeRow({});
          f.rows.push(row);
        }
        row[action.field] = action.value;
        setActive(row.id);
        ui.cursor = { rowId: row.id, field: action.field };
        markFlash(row.id, [action.field]);
        addLog('ok', `ردیف ${fa(rowIndex(row.id) + 1)} · ${LABEL[action.field]}`, heard, action.value);
        advanceCursor(1);
        break;
      }
      case 'next':
      case 'prev':
        if (state.settings.mode === 'guided') {
          advanceCursor(action.type === 'next' ? 1 : -1);
          addLog('info', `خانهٔ بعدی: «${LABEL[ui.cursor.field]}» ${cursorRowLabel()}`, heard);
        } else {
          apply({ type: 'select', target: action.type === 'next' ? { next: true } : { prev: true } }, heard);
          return;
        }
        break;
      case 'date':
        pushUndo();
        f.date = action.value;
        addLog('ok', 'تاریخ فرم عوض شد', heard, action.value);
        break;
      case 'undo': {
        const done = undo();
        addLog(done ? 'ok' : 'info', done ? 'آخرین تغییر برگشت' : 'چیزی برای برگرداندن نیست', heard);
        break;
      }
      case 'redo': {
        const done = redo();
        addLog(done ? 'ok' : 'info', done ? 'تغییر دوباره انجام شد' : 'چیزی برای انجام دوباره نیست', heard);
        break;
      }
      case 'stop':
        voice.stop();
        addLog('info', 'میکروفون خاموش شد', heard);
        break;
      case 'save':
        persist();
        addLog('ok', 'ذخیره شد؛ همهٔ تغییرها خودکار در همین مرورگر ذخیره می‌شوند', heard);
        break;
      case 'print':
        if (inViewer) addLog('info', 'چاپ در پیش‌نمایش claude.ai در دسترس نیست؛ خروجی CSV بگیرید یا نسخهٔ میزبانی‌شده را باز کنید.', heard);
        else setTimeout(() => window.print(), 300);
        break;
      case 'newForm':
        newForm();
        addLog('ok', 'فرم جدید ساخته شد', heard, current().date);
        break;
      case 'langEn':
      case 'langFa':
        setLang(action.type === 'langEn' ? 'en-US' : 'fa-IR');
        addLog('info', action.type === 'langEn' ? 'زبان گفتار: انگلیسی (برای کد قطعه‌ها). برای برگشت بگویید Persian.' : 'زبان گفتار: فارسی', heard);
        break;
      case 'help':
        el.help.open = true;
        el.help.scrollIntoView({ block: 'nearest' });
        addLog('info', 'نمونهٔ فرمان‌ها باز شد', heard);
        break;
      case 'error':
        addLog('error', action.message, heard);
        break;
      default:
        addLog('error', 'متوجه نشدم. مثلا بگویید «کالا صد نانو تعداد دو» یا «ردیف سه تعداد چهار».', heard);
    }
    if (action.problems && action.problems.length && action.type !== 'update') {
      addLog('error', action.problems[0], heard);
    }
    persist();
    render();
  }

  function handleText(text, source) {
    const ctx = {
      units: state.settings.units,
      year: Number(String(current().date).slice(0, 4)) || undefined,
      today: new Date(),
    };
    const action = state.settings.mode === 'guided'
      ? P.parseGuided(text, ui.cursor.field, ctx)
      : P.parseCommand(text, ctx);
    if (source === 'voice') el.tFinal.textContent = text;
    apply(action, text);
  }

  function scrollToRow(rowId) {
    requestAnimationFrame(() => {
      const tr = rowId ? el.rows.querySelector(`tr[data-id="${rowId}"]`) : el.rows.querySelector('tr.ghost');
      if (tr && tr.scrollIntoView) tr.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  function newForm() {
    const form = makeForm({ date: P.todayJalali() });
    state.forms.push(form);
    state.currentId = form.id;
    ui.activeRowId = null;
    ui.cursor = { rowId: null, field: 'kala' };
    persist();
  }

  // ---------------------------------------------------------------------------
  // Voice
  // ---------------------------------------------------------------------------

  function setMicStatus(text, isError) {
    el.micStatus.textContent = text;
    el.micStatus.classList.toggle('is-error', !!isError);
  }

  const voice = new window.VoiceInput({
    onState(s) {
      const live = s === 'listening';
      el.mic.classList.toggle('is-live', live);
      el.mic.setAttribute('aria-pressed', String(live));
      el.micLabel.textContent = live ? 'خاموش کردن میکروفون' : 'روشن کردن میکروفون';
      if (live) setMicStatus(state.settings.lang === 'fa-IR' ? 'در حال شنیدن… فارسی صحبت کنید' : 'Listening… (English)');
      else if (!el.micStatus.classList.contains('is-error')) setMicStatus('میکروفون خاموش است');
    },
    onInterim(text) {
      el.tInterim.textContent = text;
    },
    onFinal(text) {
      el.tInterim.textContent = '';
      handleText(text, 'voice');
    },
    onError(code, message) {
      setMicStatus(message, true);
      addLog('error', message);
      renderLog();
    },
  });

  function setLang(lang) {
    state.settings.lang = lang;
    voice.setLang(lang);
    persist();
    renderControls();
  }

  el.mic.addEventListener('click', () => {
    if (voice.listening) {
      voice.stop();
    } else {
      setMicStatus('در حال روشن کردن میکروفون…');
      voice.start(state.settings.lang);
    }
  });

  if (!window.VoiceInput.supported) {
    el.mic.disabled = true;
    setMicStatus('این مرورگر تشخیص گفتار ندارد؛ Chrome یا Edge را باز کنید.', true);
  }
  if (inViewer) {
    el.notice.hidden = false;
    el.notice.textContent = 'در پیش‌نمایش claude.ai مرورگر اجازهٔ میکروفون نمی‌دهد. برای گفتار زنده نسخهٔ میزبانی‌شده را در Chrome یا Edge باز کنید؛ اینجا می‌توانید فرمان‌ها را تایپ کنید، روی نمونه‌ها بزنید، یا با میکروفون کیبورد گوشی در کادر «فرمان متنی» صحبت کنید.';
    el.print.hidden = true;
    el.csv.hidden = true;
    window.claude.use('downloads').then((dl) => {
      downloads = dl;
      if (dl) el.csv.hidden = false;
    }).catch(() => {});
  }

  // ---------------------------------------------------------------------------
  // Files
  // ---------------------------------------------------------------------------

  function fileBase() {
    const f = current();
    return `${f.title}-${f.date}`.replace(/[/\\:*?"<>|\s]+/g, '-');
  }

  function csvCell(v) {
    const s = String(v == null ? '' : v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function toCSV() {
    const f = current();
    const lines = [[f.title, '', '', 'تاریخ', f.date], ['ردیف', 'کالا', 'نوع', 'تعداد', 'توضیحات']];
    f.rows.filter((r) => FIELDS.some((k) => String(r[k]).trim()))
      .forEach((r, i) => lines.push([i + 1, r.kala, r.type, r.qty, r.desc]));
    return '﻿' + lines.map((l) => l.map(csvCell).join(',')).join('\r\n');
  }

  async function saveFile(filename, text, mime) {
    if (inViewer) {
      if (!downloads) return;
      try {
        await downloads.save({ filename, data: text });
        addLog('ok', 'فایل ذخیره شد', null, filename);
      } catch (e) {
        if (!e || e.code !== 'declined') addLog('error', 'ذخیرهٔ فایل انجام نشد.', null, e && e.message);
      }
      renderLog();
      return;
    }
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    addLog('ok', 'فایل ساخته شد', null, filename);
    renderLog();
  }


  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  el.rows.addEventListener('focusin', (e) => {
    const input = e.target.closest('input[data-field]');
    if (!input) return;
    const tr = input.closest('tr');
    ui.editSnapshotTaken = false;
    if (ui.activeRowId !== tr.dataset.id) {
      el.rows.querySelectorAll('tr.is-active').forEach((t) => t.classList.remove('is-active'));
      tr.classList.add('is-active');
      ui.activeRowId = tr.dataset.id;
    }
    if (state.settings.mode === 'guided') {
      ui.cursor = { rowId: tr.dataset.id, field: input.dataset.field };
      el.rows.querySelectorAll('.is-cursor').forEach((td) => td.classList.remove('is-cursor'));
      el.rows.querySelector('tr.ghost')?.remove();
      input.parentElement.classList.add('is-cursor');
      renderControls();
    }
  });

  el.rows.addEventListener('input', (e) => {
    const input = e.target.closest('input[data-field]');
    if (!input) return;
    if (!ui.editSnapshotTaken) {
      pushUndo();
      ui.editSnapshotTaken = true;
    }
    const row = current().rows.find((r) => r.id === input.closest('tr').dataset.id);
    if (!row) return;
    let value = input.value;
    if (input.dataset.field === 'qty') value = P.normalize(value).replace(/[^\d.]/g, '');
    row[input.dataset.field] = value;
    persist();
    renderSummary();
    renderControls();
    renderPrint();
  });

  el.rows.addEventListener('keydown', (e) => {
    const input = e.target.closest('input[data-field]');
    if (!input || e.key !== 'Enter') return;
    e.preventDefault();
    const tr = input.closest('tr');
    const fi = FIELDS.indexOf(input.dataset.field);
    if (fi < FIELDS.length - 1) {
      tr.querySelector(`input[data-field="${FIELDS[fi + 1]}"]`).focus();
      return;
    }
    const next = tr.nextElementSibling && tr.nextElementSibling.querySelector('input[data-field="kala"]');
    if (next) {
      next.focus();
    } else {
      const row = addRow({}, null);
      persist();
      render();
      $(`c-${row.id}-kala`).focus();
    }
  });

  el.rows.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (!del) return;
    const i = rowIndex(del.dataset.del);
    if (i < 0) return;
    apply({ type: 'delete', target: { row: i + 1 } }, null);
  });

  $('btn-add-row').addEventListener('click', () => {
    const row = addRow({}, null);
    if (state.settings.mode === 'guided') ui.cursor = { rowId: row.id, field: 'kala' };
    persist();
    render();
    $(`c-${row.id}-kala`).focus();
  });

  el.title.addEventListener('input', () => {
    current().title = el.title.value;
    persist();
    renderPrint();
  });
  el.title.addEventListener('change', renderFormSelect);

  el.date.addEventListener('change', () => {
    const v = P.normalize(el.date.value).replace(/[-.]/g, '/');
    const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(v);
    pushUndo();
    current().date = m ? P.formatJalali(+m[1], +m[2], +m[3]) : v;
    persist();
    render();
  });

  $('btn-today').addEventListener('click', () => {
    pushUndo();
    current().date = P.todayJalali();
    persist();
    render();
  });

  el.formSelect.addEventListener('change', () => {
    state.currentId = el.formSelect.value;
    ui.activeRowId = null;
    ui.cursor = { rowId: null, field: 'kala' };
    persist();
    render();
  });

  $('btn-new-form').addEventListener('click', () => {
    newForm();
    addLog('ok', 'فرم جدید ساخته شد', null, current().date);
    render();
  });

  // Two-step buttons instead of confirm(): first press arms, second press acts.
  function armed(button, idleText, armedText, action) {
    let timer = 0;
    button.addEventListener('click', () => {
      if (!button.classList.contains('is-armed')) {
        button.classList.add('is-armed');
        button.textContent = armedText;
        timer = setTimeout(() => {
          button.classList.remove('is-armed');
          button.textContent = idleText;
        }, 4000);
        return;
      }
      clearTimeout(timer);
      button.classList.remove('is-armed');
      button.textContent = idleText;
      action();
    });
  }

  armed($('btn-delete-form'), 'حذف فرم', 'برای حذف دوباره بزنید', () => {
    const f = current();
    state.forms = state.forms.filter((x) => x.id !== f.id);
    history.delete(f.id);
    if (!state.forms.length) state.forms.push(makeForm({}));
    state.currentId = state.forms[0].id;
    ui.activeRowId = null;
    ui.cursor = { rowId: null, field: 'kala' };
    addLog('ok', 'فرم حذف شد', null, `${f.title} — ${f.date}`);
    persist();
    render();
  });

  armed($('btn-clear'), 'پاک کردن ردیف‌ها', 'مطمئنید؟ دوباره بزنید', () => {
    pushUndo();
    current().rows = [];
    ui.activeRowId = null;
    ui.cursor = { rowId: null, field: 'kala' };
    addLog('ok', 'همهٔ ردیف‌ها پاک شد', null, 'با «برگرد» برمی‌گردد');
    persist();
    render();
  });

  el.undo.addEventListener('click', () => apply({ type: 'undo' }, null));
  el.redo.addEventListener('click', () => apply({ type: 'redo' }, null));
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.target.closest('input')) return;
    if (e.key.toLowerCase() === 'z') {
      e.preventDefault();
      apply({ type: e.shiftKey ? 'redo' : 'undo' }, null);
    } else if (e.key.toLowerCase() === 'y') {
      e.preventDefault();
      apply({ type: 'redo' }, null);
    }
  });

  el.csv.addEventListener('click', () => saveFile(fileBase() + '.csv', toCSV(), 'text/csv;charset=utf-8'));
  el.print.addEventListener('click', () => {
    renderPrint();
    window.print();
  });

  document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    state.settings.mode = b.dataset.mode;
    if (b.dataset.mode === 'guided') {
      // Start on the first empty cell of the selected row, else on a new row.
      const row = current().rows.find((r) => r.id === ui.activeRowId);
      const empty = row && FIELDS.find((k) => !row[k]);
      ui.cursor = empty ? { rowId: row.id, field: empty } : { rowId: null, field: 'kala' };
      scrollToRow(ui.cursor.rowId);
    }
    persist();
    render();
  }));
  document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));
  el.units.addEventListener('change', () => {
    state.settings.units = el.units.checked;
    persist();
  });

  el.cmdForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = el.cmdInput.value.trim();
    if (!text) return;
    handleText(text, 'text');
    el.cmdInput.value = '';
  });

  el.examples.innerHTML = EXAMPLES.map(([say, does], i) => `<li><button type="button" data-ex="${i}"><span class="ex-say">«${esc(say)}»</span><span class="ex-does">${esc(does)}</span></button></li>`).join('');
  el.examples.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ex]');
    if (b) handleText(EXAMPLES[Number(b.dataset.ex)][0], 'example');
  });

  window.addEventListener('beforeprint', renderPrint);
  window.addEventListener('pagehide', () => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* storage blocked */ }
  });

  if (current().rows.length) ui.activeRowId = current().rows[current().rows.length - 1].id;
  if (current().sample) {
    addLog('info', 'این فرم از روی فایل PDF شما ساخته شده (۳۰ ردیف، تاریخ ۱۴۰۵/۰۷/۰۶). با «فرم جدید» یک فرم خالی بسازید.');
  }
  render();
})();
