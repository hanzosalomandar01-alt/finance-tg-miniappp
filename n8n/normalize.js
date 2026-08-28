// ============================================================================
//  MiniApp API — сборка данных для мини-приложения "Ритм"
//  Режим Code-ноды: "Run Once for All Items"
// ============================================================================

// ---------- 0. НАСТРОЙКИ ----------
// BOT_TOKEN вписывается ТОЛЬКО здесь, в n8n. Никогда не коммить его в git.
const BOT_TOKEN      = 'ВСТАВЬ_ТОКЕН_БОТА';  // от @BotFather
const TOKEN          = '';                   // доп. секрет; '' = не проверять
const ALLOWED_TG_IDS = [];                   // напр. [123456789]; пусто = любой юзер бота
const MAX_AGE_SEC    = 24 * 60 * 60;

// ---------- 1. АВТОРИЗАЦИЯ ПО ПОДПИСИ TELEGRAM ----------
const body = ($('Webhook').first().json.body) || {};

function checkAuth() {
  if (TOKEN && body.token !== TOKEN) return 'unauthorized';

  if (!BOT_TOKEN || BOT_TOKEN.indexOf('ВСТАВЬ') === 0) return 'bot token not set';

  let nodeCrypto;
  try { nodeCrypto = require('crypto'); }
  catch (e) { return 'crypto unavailable'; }

  const initData = String(body.initData || '');
  if (!initData) return 'no initData';

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return 'no hash';
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => k + '=' + v)
    .join('\n');

  const secretKey = nodeCrypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const calcHash  = nodeCrypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (calcHash !== hash) return 'bad signature';

  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || Date.now() / 1000 - authDate > MAX_AGE_SEC) return 'expired';

  if (ALLOWED_TG_IDS.length) {
    let tgId = null;
    try { tgId = JSON.parse(params.get('user') || '{}').id; } catch (e) { /* ignore */ }
    if (!ALLOWED_TG_IDS.includes(Number(tgId))) return 'forbidden';
  }

  return null;
}

const denied = checkAuth();

if (denied) return [{ json: { error: denied } }];

// ---------- 2. ХЕЛПЕРЫ ----------
const pad = (n) => String(n).padStart(2, '0');

// безопасно читаем выход другой ноды: если она упала/не выполнилась — пустой массив
const from = (name) => {
  try { return $(name).all().map((i) => i.json).filter(Boolean); }
  catch (e) { return []; }
};

function toISODate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') {                        // серийный номер даты из Sheets
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    return isNaN(d) ? null : d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);                 // 2026-08-27
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);       // 27.08.2026
  if (m) return m[3] + '-' + pad(m[2]) + '-' + pad(m[1]);
  const d = new Date(s);
  if (isNaN(d)) return null;
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function toNumber(v) {
  if (typeof v === 'number') return v;
  if (v === null || v === undefined) return 0;
  const s = String(v)
    .replace(/[\s\u00A0]/g, '')
    .replace(/[^\d.,-]/g, '')
    .replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// ищем значение в строке таблицы по возможным названиям колонки
function col(row, names) {
  for (const key of Object.keys(row)) {
    const k = key.toLowerCase().trim();
    if (names.some((n) => k === n || k.includes(n))) {
      const v = row[key];
      if (v !== '' && v !== null && v !== undefined) return v;
    }
  }
  return null;
}

// ---------- 3. ЗАДАЧИ (Google Tasks) ----------
const RE_HIGH = /(!{2,}|срочн|важн|высок|high|urgent|\bp1\b)/i;
const RE_LOW  = /(низк|low|потом|когда-нибудь|\bp3\b)/i;

const tasks = from('Google Tasks')
  .filter((t) => t.id && t.title)
  .map((t) => {
    const hay = String(t.title || '') + ' ' + String(t.notes || '');
    let priority = 'med';
    if (RE_HIGH.test(hay)) priority = 'high';
    else if (RE_LOW.test(hay)) priority = 'low';
    return {
      id: String(t.id),
      text: String(t.title).replace(/\s*!{1,3}\s*$/, '').trim(),
      done: t.status === 'completed',
      priority,
      due: t.due ? String(t.due).slice(0, 10) : null,
    };
  });

// ---------- 4. СОБЫТИЯ (Google Calendar) ----------
const events = from('Google Calendar')
  .filter((e) => e.id && e.status !== 'cancelled')
  .map((e) => {
    const s = e.start || {};
    let date = '', time = '';
    if (s.dateTime) {                     // берём строкой, чтобы не сбить таймзону
      date = String(s.dateTime).slice(0, 10);
      time = String(s.dateTime).slice(11, 16);
    } else if (s.date) {                  // событие на весь день
      date = String(s.date).slice(0, 10);
    }
    return {
      id: String(e.id),
      title: String(e.summary || 'Без названия'),
      date,
      time,
      notes: String(e.description || ''),
    };
  })
  .filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date));

// ---------- 5. ФИНАНСЫ (Google Sheets) ----------
const C = {
  date:    ['дата', 'date', 'когда'],
  type:    ['тип', 'type', 'операц', 'вид'],
  amount:  ['сумма', 'amount', 'значение', 'value'],
  income:  ['доход', 'income', 'приход', 'поступлен'],
  expense: ['расход', 'expense', 'трата', 'затрат'],
  cat:     ['категор', 'category', 'статья'],
  note:    ['коммент', 'note', 'описан', 'заметк', 'примечан', 'назначен'],
};

const tx = [];
for (const row of from('Google Sheets')) {
  if (typeof row !== 'object') continue;

  const date = toISODate(col(row, C.date));
  if (!date) continue;

  let type = null;
  const rawType = col(row, C.type);
  if (rawType) {
    const t = String(rawType).toLowerCase();
    if (C.income.some((w) => t.includes(w))) type = 'income';
    else if (C.expense.some((w) => t.includes(w))) type = 'expense';
  }
  let amount = toNumber(col(row, C.amount));

  // запасной вариант: отдельные колонки "Доход" и "Расход"
  if (!type || !amount) {
    const exp = toNumber(col(row, C.expense));
    const inc = toNumber(col(row, C.income));
    if (exp) { type = 'expense'; amount = exp; }
    else if (inc) { type = 'income'; amount = inc; }
  }
  if (!type) type = amount < 0 ? 'expense' : 'income';

  amount = Math.abs(amount);
  if (!amount) continue;

  tx.push({
    id: date + '-' + tx.length,
    type,
    amount,
    category: String(col(row, C.cat) || 'Прочее').trim() || 'Прочее',
    date,
    note: String(col(row, C.note) || '').trim(),
  });
}

// ---------- 5b. ИТОГИ ИЗ ЛИСТА «СВОД» ----------
// Сырая сетка ячеек: [["", "Август"], ["Доход","Расход"], [0, 37]]
// Свод принимается в двух видах:
//   1) нода Google Sheets с именем «Свод»  -> объекты { Доход: 0, Расход: 37 }
//   2) HTTP Request «Свод (raw)»          -> сырая сетка { values: [[...]] }
let grid = [];
let svodSource = 'none';        // откуда взялся Свод — видно в debug ответа
let svodRawKeys = [];           // что вообще вернула нода

try {
  const v = $('Свод (raw)').first().json.values;
  if (Array.isArray(v) && v.length) { grid = v; svodSource = 'http'; }
} catch (e) { /* такой ноды нет — нормально */ }

if (!grid.length) {
  const all = from('Свод');
  svodRawKeys = all.length ? Object.keys(all[0]) : [];
  const rows = all.filter((r) => r && typeof r === 'object' && Object.keys(r).length);
  if (rows.length) {
    const keys = Object.keys(rows[0]).filter((k) => k !== 'row_number');
    grid = [keys].concat(rows.map((r) => keys.map((k) => r[k])));
    svodSource = 'sheets';
  }
}

const cellAt = (r, c) => {
  const row = grid[r];
  return Array.isArray(row) ? row[c] : undefined;
};
const cellText = (v) => String(v === null || v === undefined ? '' : v).toLowerCase().trim();

function isNumeric(v) {
  if (v === null || v === undefined || v === '') return false;
  if (typeof v === 'number') return !isNaN(v);
  return /\d/.test(String(v)) && !isNaN(toNumber(v));
}

// ищем ячейку-подпись и берём ближайшее число под ней (или справа)
function findTotal(words) {
  for (let r = 0; r < grid.length; r++) {
    const row = Array.isArray(grid[r]) ? grid[r] : [];
    for (let c = 0; c < row.length; c++) {
      const cell = cellText(row[c]);
      if (!cell || !words.some((w) => cell.indexOf(w) !== -1)) continue;

      for (let rr = r + 1; rr < Math.min(grid.length, r + 8); rr++) {
        const v = cellAt(rr, c);
        if (isNumeric(v)) return toNumber(v);
      }
      for (let cc = c + 1; cc < Math.min(row.length, c + 8); cc++) {
        if (isNumeric(row[cc])) return toNumber(row[cc]);
      }
    }
  }
  return 0;
}

// подпись периода — первая ячейка с названием месяца
function findPeriodLabel() {
  const months = ['январ', 'феврал', 'март', 'апрел', 'май', 'мая',
                  'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];
  for (const row of grid) {
    for (const cell of (Array.isArray(row) ? row : [])) {
      const s = cellText(cell);
      if (s && months.some((m) => s.indexOf(m) === 0)) return String(cell).trim();
    }
  }
  return '';
}

const totals = grid.length ? {
  label:   findPeriodLabel(),
  income:  Math.abs(findTotal(['доход', 'income'])),
  expense: Math.abs(findTotal(['расход', 'expense'])),
} : null;

// ---------- 6. ОТВЕТ ----------
return [{
  json: {
    tasks,
    events,
    tx,
    totals,
    generatedAt: new Date().toISOString(),
    counts: {
      tasks: tasks.length,
      events: events.length,
      tx: tx.length,
      svodRows: grid.length,
    },
    debug: {
      svodSource,                                  // none | sheets | http
      svodHeader: grid.length ? grid[0] : [],      // строка заголовков
      svodRawKeys,                                 // что отдала нода «Свод»
    },
  },
}];
