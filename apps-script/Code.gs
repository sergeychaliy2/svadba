/**
 * ============================================================================
 *  Приём анкет гостей — свадьба Сергея и Ксении, 12.12.2026
 *  Google Apps Script: бесплатно, без ограничений по количеству ответов.
 *
 *  Установка — см. README.md, шаг 2.
 * ============================================================================
 */

/* ------------------------------ НАСТРОЙКИ ------------------------------- */

/** Пароль для страницы admin.html. ОБЯЗАТЕЛЬНО поменяйте на свой.
 *
 *  ВНИМАНИЕ: свой настоящий пароль вписывайте ТОЛЬКО в редакторе Apps Script
 *  внутри Google-таблицы. В этом файле в GitHub-репозитории должна остаться
 *  заглушка — репозиторий публичный, его видно всем.                   */
var ADMIN_TOKEN = 'ПОМЕНЯЙТЕ_В_РЕДАКТОРЕ_APPS_SCRIPT';

/** Лист, куда пишутся ответы. Создаётся сам при первой анкете.         */
var SHEET_NAME = 'Ответы';

/** Максимум гостей в одной анкете (защита от мусора).                  */
var MAX_GUESTS = 8;

/* -------------------------------- МЕНЮ ---------------------------------- */
/* Должно совпадать с массивами MAINS и SALADS в index.html
   (внизу файла, в блоке <script type="text/x-dc">).
   Если меняете блюда — поменяйте в обоих местах.                       */

var MAINS = [
  'Филе трески в сливочном соусе со стручковой фасолью',
  'Медальоны из говядины с картофельными дольками'
];

var SALADS = [
  'Цезарь с курицей',
  'Салат с чипсами бекона, грушей, медовой заправкой и голубым сыром',
  'С рукколой, креветками и черри'
];

var HEADERS = [
  'Дата ответа',
  'Имя и фамилия',
  'Придёт',
  'Горячее блюдо',
  'Салат',
  'Комментарий',
  'ID анкеты',
  'Статус'
];

/** Отметка в колонке «Статус» у убранных гостей.
 *  Строка при этом НЕ стирается — её всегда можно вернуть.             */
var MARK_REMOVED = 'убран';

/* ----------------------------- ТОЧКИ ВХОДА ------------------------------ */

function doGet(e) {
  var p = (e && e.parameter) || {};
  var out;
  try {
    var action = p.action || 'ping';
    if      (action === 'rsvp')   out = handleRsvp_(p.payload);
    else if (action === 'list')   out = handleList_(p.token);
    else if (action === 'remove') out = handleRemove_(p);
    else if (action === 'update') out = handleUpdate_(p);
    else                          out = { ok: true, pong: true };
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return reply_(out, p.callback);
}

function doPost(e) {
  var p = (e && e.parameter) || {};
  var body = '';
  try { body = (e && e.postData && e.postData.contents) || ''; } catch (ignore) {}
  var out;
  try {
    out = handleRsvp_(p.payload || body);
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return reply_(out, p.callback);
}

/* --------------------------- ПРИЁМ АНКЕТ -------------------------------- */

function handleRsvp_(rawPayload) {
  if (!rawPayload) throw new Error('пустая анкета');

  var data   = JSON.parse(rawPayload);
  var guests = Array.isArray(data.guests) ? data.guests : [];

  if (!guests.length)             throw new Error('не указан ни один гость');
  if (guests.length > MAX_GUESTS) throw new Error('слишком много гостей в одной анкете');

  var coming  = data.attending !== false;
  var comment = clip_(data.comment, 500);
  var stamp   = new Date();
  var formId  = Utilities.getUuid().slice(0, 8);
  var rows    = [];

  for (var i = 0; i < guests.length; i++) {
    var g    = guests[i] || {};
    var name = clip_(g.name, 80).replace(/\s+/g, ' ').trim();
    if (name.length < 2) throw new Error('слишком короткое имя гостя');

    rows.push([
      stamp,
      name,
      coming ? 'да' : 'нет',
      coming ? pick_(MAINS,  g.main)  : '',
      coming ? pick_(SALADS, g.salad) : '',
      i === 0 ? comment : '',
      formId,
      ''
    ]);
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = getSheet_();
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HEADERS.length).setValues(rows);
  } finally {
    lock.releaseLock();
  }

  return { ok: true, saved: rows.length, formId: formId };
}

/* --------------------------- ЧТЕНИЕ СПИСКА ------------------------------ */

function handleList_(token) {
  if (!checkToken_(token)) return { ok: false, error: 'неверный пароль' };

  var sheet = getSheet_();
  var last  = sheet.getLastRow();
  if (last < 2) return { ok: true, rows: [], count: 0, menu: menu_() };

  var values = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
  var rows   = [];

  for (var i = 0; i < values.length; i++) {
    var v = values[i];
    if (!v[1]) continue;
    rows.push({
      row:     i + 2,                       // номер строки в самой таблице
      at:      v[0] instanceof Date ? v[0].toISOString() : String(v[0]),
      name:    String(v[1]),
      coming:  String(v[2]).toLowerCase().indexOf('да') === 0,
      hot:     String(v[3] || ''),
      salad:   String(v[4] || ''),
      comment: String(v[5] || ''),
      formId:  String(v[6] || ''),
      removed: String(v[7] || '').trim().toLowerCase() === MARK_REMOVED
    });
  }

  return { ok: true, rows: rows, count: rows.length, menu: menu_() };
}

/* ----------------------- УБРАТЬ / ВЕРНУТЬ ГОСТЯ ------------------------- */

function handleRemove_(p) {
  if (!checkToken_(p.token)) return { ok: false, error: 'неверный пароль' };

  var restore = String(p.restore || '') === '1';

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = getSheet_();
    var row   = safeRow_(sheet, p.row, p.was);
    sheet.getRange(row, 8).setValue(restore ? '' : MARK_REMOVED);
  } finally {
    lock.releaseLock();
  }

  return { ok: true, removed: !restore };
}

/* --------------------------- ПРАВКА ГОСТЯ ------------------------------- */

function handleUpdate_(p) {
  if (!checkToken_(p.token)) return { ok: false, error: 'неверный пароль' };

  var name = clip_(p.name, 80).replace(/\s+/g, ' ').trim();
  if (name.length < 2) return { ok: false, error: 'слишком короткое имя' };

  var coming = String(p.coming || 'да').toLowerCase().indexOf('да') === 0;

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = getSheet_();
    var row   = safeRow_(sheet, p.row, p.was);

    sheet.getRange(row, 2, 1, 5).setValues([[
      name,
      coming ? 'да' : 'нет',
      coming ? pick_(MAINS,  p.main)  : '',
      coming ? pick_(SALADS, p.salad) : '',
      clip_(p.comment, 500)
    ]]);
  } finally {
    lock.releaseLock();
  }

  return { ok: true };
}

/* --------------------------- ВСПОМОГАТЕЛЬНОЕ ---------------------------- */

function checkToken_(token) {
  return !!token && String(token) === String(ADMIN_TOKEN);
}

/** Проверяем, что правим именно ту строку, которую админ видел на экране.
 *  Если таблицу успели поменять руками — лучше отказать, чем испортить
 *  чужую запись.                                                        */
function safeRow_(sheet, rawRow, expectedName) {
  var row = parseInt(rawRow, 10);
  if (!(row >= 2)) throw new Error('не указана строка');
  if (row > sheet.getLastRow()) throw new Error('такой строки уже нет — обновите страницу');

  var actual = String(sheet.getRange(row, 2).getValue()).trim();
  if (expectedName && actual !== String(expectedName).trim()) {
    throw new Error('таблица изменилась — обновите страницу и повторите');
  }
  return row;
}

/** Меню отдаём на страницу сводки, чтобы в редакторе были выпадающие
 *  списки с точными названиями — без опечаток руками.                   */
function menu_() {
  return { mains: MAINS, salads: SALADS };
}

/** Принимаем только блюда из меню — чтобы в таблицу не попал мусор. */
function pick_(list, value) {
  var v = String(value === null || value === undefined ? '' : value).trim();
  return list.indexOf(v) > -1 ? v : '';
}

function getSheet_() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
         .setFontWeight('bold')
         .setBackground('#f6e3e8');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 155);
    sheet.setColumnWidth(2, 220);
    sheet.setColumnWidth(3, 80);
    sheet.setColumnWidth(4, 340);
    sheet.setColumnWidth(5, 390);
    sheet.setColumnWidth(6, 260);
    sheet.setColumnWidth(7, 90);
    sheet.setColumnWidth(8, 90);
  } else {
    // Дописываем недостающие колонки шапки — если лист остался
    // от прежней версии скрипта, где колонки «Статус» ещё не было.
    var width = sheet.getLastColumn();
    if (width < HEADERS.length) {
      sheet.getRange(1, width + 1, 1, HEADERS.length - width)
           .setValues([HEADERS.slice(width)])
           .setFontWeight('bold')
           .setBackground('#f6e3e8');
      sheet.setColumnWidth(HEADERS.length, 90);
    }
  }

  return sheet;
}

function clip_(value, max) {
  if (value === null || value === undefined) return '';
  var s = String(value);
  return s.length > max ? s.slice(0, max) : s;
}

function reply_(obj, callback) {
  var json = JSON.stringify(obj);
  if (callback && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(callback)) {
    return ContentService
      .createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

/* -------------------------------- ТЕСТ ---------------------------------- */
/* Запустите вручную из редактора Apps Script (кнопка «Выполнить»),
   чтобы разом выдать разрешения и убедиться, что лист создаётся.       */

function testAddRow() {
  var res = handleRsvp_(JSON.stringify({
    attending: true,
    comment: 'Тестовая запись — эту строку можно убрать кнопкой в сводке',
    guests: [{ name: 'Тест Тестовый', main: MAINS[0], salad: SALADS[0] }]
  }));
  Logger.log(res);
}
