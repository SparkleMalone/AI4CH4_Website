/**
 * AI⁴Methane expertise directory backend (Google Apps Script web app).
 *
 * Stores member expertise profiles in a Google Sheet in your Drive and serves
 * them to the website:
 *   GET  ?action=list           -> public profiles (no private fields)
 *   POST {action:'submit', ...} -> create or update a profile (password required)
 *   POST {action:'get_own'}     -> load your own profile via your private edit token
 *   POST {action:'request_link'}-> email your private edit link to the address on file
 *   POST {action:'delete'}      -> remove your profile via your edit token
 *
 * The survey password is checked HERE, on the server; it is never in the
 * website's code. Set it with setup() (Script Properties > SURVEY_PASSWORD).
 *
 * See SETUP.md for deployment steps.
 */

// ---------- Configuration ----------
var SHEET_NAME = 'Responses';
var CACHE_KEY = 'public_profiles_v1';
var CACHE_SECONDS = 6 * 60 * 60; // cleared on every change anyway
var OPPORTUNITY_SHEET_NAME = 'Opportunities';
var OPPORTUNITY_CACHE_KEY = 'public_opportunities_v1';

var COLUMNS = [
  'id', 'email', 'name', 'affiliation', 'position', 'career_stage',
  'domains', 'methods', 'applications', 'scales', 'regions', 'keywords', 'bio',
  'website', 'orcid', 'open_to', 'show_email',
  'edit_token', 'created_at', 'updated_at'
];
var LIST_FIELDS = ['domains', 'methods', 'applications', 'scales', 'regions', 'keywords', 'open_to'];
var PUBLIC_FIELDS = [
  'id', 'name', 'affiliation', 'position', 'career_stage',
  'domains', 'methods', 'applications', 'scales', 'regions', 'keywords', 'bio',
  'website', 'orcid', 'open_to', 'updated_at'
];
var OPPORTUNITY_COLUMNS = [
  'id', 'title', 'type', 'deadline', 'visible_until', 'url', 'description',
  'contact_name', 'contact_email', 'affiliation', 'posted_at', 'updated_at'
];
var OPPORTUNITY_PUBLIC_FIELDS = [
  'id', 'title', 'type', 'deadline', 'visible_until', 'url', 'description',
  'contact_name', 'contact_email', 'affiliation', 'posted_at', 'updated_at'
];
var MAX_LEN = { name: 120, affiliation: 200, position: 120, career_stage: 60, bio: 1200, website: 300, orcid: 40, email: 200 };
var OPPORTUNITY_MAX_LEN = { title: 160, type: 80, url: 500, description: 1800, contact_name: 120, contact_email: 200, affiliation: 200 };
var MAX_LIST_ITEMS = 40;
var MAX_ITEM_LEN = 80;

/**
 * Run once from the Apps Script editor (select "setup" and press Run).
 * Creates the Responses sheet with headers and sets default properties.
 * Edit SITE_URL below to the address where the website is published.
 */
function setup() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SURVEY_PASSWORD')) props.setProperty('SURVEY_PASSWORD', 'AI4Methane');
  if (!props.getProperty('SITE_URL')) props.setProperty('SITE_URL', 'https://ai4ch4.com/');
  if (!props.getProperty('ADMIN_EMAIL')) props.setProperty('ADMIN_EMAIL', Session.getEffectiveUser().getEmail());
  var sheet = getSheet_();
  var opportunitySheet = getOpportunitySheet_();
  Logger.log('Ready. Sheet: ' + sheet.getParent().getUrl());
  Logger.log('Opportunities sheet ready: ' + opportunitySheet.getParent().getUrl());
}

/** Runs automatically when you edit the Responses sheet by hand, so the website shows the change right away. */
function onEdit() {
  clearCache_();
  clearOpportunitiesCache_();
}

// ---------- HTTP entry points ----------
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'list';
  if (action === 'list') return json_({ ok: true, profiles: publicProfiles_(), generated_at: new Date().toISOString() });
  if (action === 'list_opportunities') return json_({ ok: true, opportunities: publicOpportunities_(), generated_at: new Date().toISOString() });
  return json_({ ok: false, error: 'Unknown action.' });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'Could not read the request.' });
  }
  try {
    switch (body.action) {
      case 'submit': return json_(submit_(body));
      case 'submit_opportunity': return json_(submitOpportunity_(body));
      case 'get_own': return json_(getOwn_(body));
      case 'request_link': return json_(requestLink_(body));
      case 'delete': return json_(deleteProfile_(body));
      default: return json_({ ok: false, error: 'Unknown action.' });
    }
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'Something went wrong on the server. Please try again in a minute.' });
  }
}

function submitOpportunity_(body) {
  if (!passwordOk_(body.password)) return { ok: false, code: 'bad_password', error: 'Incorrect survey password.' };

  var clean = cleanOpportunity_(body.opportunity || {});
  if (clean.error) return { ok: false, code: 'invalid', error: clean.error };
  var p = clean.opportunity;

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = getOpportunitySheet_();
    cleanupExpiredOpportunities_(sheet);
    var now = new Date().toISOString();
    p.id = 'o' + Utilities.getUuid().slice(0, 8);
    p.posted_at = now;
    p.updated_at = now;
    appendOpportunityRow_(sheet, p);
    clearOpportunitiesCache_();
    notifyAdminOpportunity_(p);
    return { ok: true, id: p.id };
  } finally {
    lock.releaseLock();
  }
}

// ---------- Actions ----------
function submit_(body) {
  if (!passwordOk_(body.password)) return { ok: false, code: 'bad_password', error: 'Incorrect survey password.' };

  var clean = cleanProfile_(body.profile || {});
  if (clean.error) return { ok: false, code: 'invalid', error: clean.error };
  var p = clean.profile;

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = getSheet_();
    var rows = readRows_(sheet);
    var now = new Date().toISOString();

    if (body.token) {
      // Update an existing profile, identified by its private edit token.
      var idx = findIndex_(rows, 'edit_token', String(body.token));
      if (idx < 0) return { ok: false, code: 'bad_token', error: 'This edit link is no longer valid. Request a new one below.' };
      var row = rows[idx];
      // Changing the email must not collide with another member's profile.
      var other = findIndex_(rows, 'email', p.email);
      if (other >= 0 && other !== idx) return { ok: false, code: 'invalid', error: 'Another profile already uses that email address.' };
      for (var k in p) row[k] = p[k];
      row.updated_at = now;
      writeRow_(sheet, idx, row);
      clearCache_();
      return { ok: true, mode: 'updated', id: row.id };
    }

    // New profile. One profile per email address.
    var existing = findIndex_(rows, 'email', p.email);
    if (existing >= 0) {
      sendEditLink_(rows[existing], 'existing');
      return { ok: false, code: 'exists', error: 'A profile with this email already exists. We just emailed your private edit link to ' + p.email + '.' };
    }
    var rec = {};
    for (var key in p) rec[key] = p[key];
    rec.id = 'm' + Utilities.getUuid().slice(0, 8);
    rec.edit_token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    rec.created_at = now;
    rec.updated_at = now;
    appendRow_(sheet, rec);
    clearCache_();
    sendEditLink_(rec, 'created');
    notifyAdmin_(rec);
    return { ok: true, mode: 'created', id: rec.id };
  } finally {
    lock.releaseLock();
  }
}

function getOwn_(body) {
  if (!body.token) return { ok: false, code: 'bad_token', error: 'Missing edit token.' };
  var rows = readRows_(getSheet_());
  var idx = findIndex_(rows, 'edit_token', String(body.token));
  if (idx < 0) return { ok: false, code: 'bad_token', error: 'This edit link is no longer valid. Request a new one below.' };
  var r = rows[idx], out = {};
  COLUMNS.forEach(function (c) { if (c !== 'edit_token') out[c] = r[c]; });
  return { ok: true, profile: out };
}

function requestLink_(body) {
  if (!passwordOk_(body.password)) return { ok: false, code: 'bad_password', error: 'Incorrect survey password.' };
  var email = String(body.email || '').trim().toLowerCase();
  var rows = readRows_(getSheet_());
  var idx = findIndex_(rows, 'email', email);
  if (idx >= 0) sendEditLink_(rows[idx], 'requested');
  // Same answer either way, so this can't be used to probe who has a profile.
  return { ok: true, message: 'If a profile exists for ' + email + ', its edit link is on its way.' };
}

function deleteProfile_(body) {
  if (!passwordOk_(body.password)) return { ok: false, code: 'bad_password', error: 'Incorrect survey password.' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = getSheet_();
    var rows = readRows_(sheet);
    var idx = findIndex_(rows, 'edit_token', String(body.token || ''));
    if (idx < 0) return { ok: false, code: 'bad_token', error: 'This edit link is no longer valid.' };
    sheet.deleteRow(idx + 2);
    clearCache_();
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// ---------- Validation ----------
function cleanProfile_(raw) {
  var p = {};
  function str(name, required) {
    var v = String(raw[name] == null ? '' : raw[name]).replace(/\s+/g, ' ').trim();
    if (name === 'bio') v = String(raw[name] || '').trim(); // keep paragraph breaks
    if (v.length > (MAX_LEN[name] || 200)) v = v.slice(0, MAX_LEN[name] || 200);
    if (required && !v) throw new Error(name);
    p[name] = v;
  }
  try {
    str('name', true); str('affiliation', true); str('position'); str('career_stage');
    str('bio'); str('website'); str('orcid'); str('email', true);
  } catch (missing) {
    return { error: 'Please fill in your ' + missing.message + '.' };
  }
  p.email = p.email.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) return { error: 'Please enter a valid email address.' };
  if (p.website && !/^https?:\/\//i.test(p.website)) {
    // Bare domains get https://; any other scheme (javascript:, data:, ...) is dropped.
    p.website = /^[a-z][a-z0-9+.-]*:/i.test(p.website) ? '' : 'https://' + p.website;
  }
  if (p.orcid) {
    var m = p.orcid.match(/(\d{4}-\d{4}-\d{4}-\d{3}[\dX])/i);
    if (!m) return { error: 'ORCID should look like 0000-0002-1825-0097.' };
    p.orcid = m[1].toUpperCase();
  }
  LIST_FIELDS.forEach(function (f) {
    var arr = raw[f];
    if (typeof arr === 'string') arr = arr.split(/[;,]/);
    if (!Array.isArray(arr)) arr = [];
    var seen = {}, out = [];
    arr.forEach(function (x) {
      var s = String(x || '').replace(/;/g, ',').replace(/\s+/g, ' ').trim().slice(0, MAX_ITEM_LEN);
      if (s && !seen[s.toLowerCase()] && out.length < MAX_LIST_ITEMS) { seen[s.toLowerCase()] = 1; out.push(s); }
    });
    p[f] = out;
  });
  if (!p.domains.length && !p.methods.length && !p.applications.length && !p.keywords.length) {
    return { error: 'Please choose at least one area of expertise or add a keyword.' };
  }
  p.show_email = raw.show_email === true || raw.show_email === 'true';
  return { profile: p };
}

function cleanOpportunity_(raw) {
  var p = {};
  function str(name, required) {
    var v = String(raw[name] == null ? '' : raw[name]).replace(/\s+/g, ' ').trim();
    if (name === 'description') v = String(raw[name] || '').trim();
    if (v.length > (OPPORTUNITY_MAX_LEN[name] || 200)) v = v.slice(0, OPPORTUNITY_MAX_LEN[name] || 200);
    if (required && !v) throw new Error(name);
    p[name] = v;
  }
  try {
    str('title', true); str('type', true); str('url'); str('description', true);
    str('contact_name', true); str('contact_email', true); str('affiliation');
  } catch (missing) {
    return { error: 'Please fill in ' + missing.message.replace(/_/g, ' ') + '.' };
  }
  p.contact_email = p.contact_email.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.contact_email)) return { error: 'Please enter a valid contact email address.' };
  if (p.url && !/^https?:\/\//i.test(p.url)) {
    p.url = /^[a-z][a-z0-9+.-]*:/i.test(p.url) ? '' : 'https://' + p.url;
  }
  p.deadline = cleanDate_(raw.deadline || '');
  p.visible_until = cleanDate_(raw.visible_until || '');
  if (!p.visible_until) return { error: 'Please choose how long the opportunity should remain visible.' };
  if (dateValue_(p.visible_until) < dateValue_(today_())) return { error: 'The visibility date cannot be in the past.' };
  if (p.deadline && dateValue_(p.deadline) < dateValue_(today_())) return { error: 'The deadline cannot be in the past.' };
  return { opportunity: p };
}

function cleanDate_(value) {
  var v = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
}

function passwordOk_(given) {
  var expected = PropertiesService.getScriptProperties().getProperty('SURVEY_PASSWORD') || 'AI4Methane';
  var ok = String(given || '') === expected;
  if (!ok) Utilities.sleep(800); // slow down guessing
  return ok;
}

// ---------- Sheet helpers ----------
function getSheet_() {
  var props = PropertiesService.getScriptProperties();
  var ss;
  var id = props.getProperty('SHEET_ID');
  if (id) {
    ss = SpreadsheetApp.openById(id);
  } else {
    ss = SpreadsheetApp.getActiveSpreadsheet(); // when the script is opened from the Sheet
    if (!ss) ss = SpreadsheetApp.create('AI4Methane Expertise Survey (responses)');
    props.setProperty('SHEET_ID', ss.getId());
  }
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(COLUMNS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, sheet.getMaxRows(), COLUMNS.length).setNumberFormat('@'); // store everything as plain text
    sheet.getRange(1, 1, 1, COLUMNS.length).setFontWeight('bold');
  } else {
    // A category added to the code after the sheet was created gets a new column at the end.
    var header = headerOf_(sheet);
    var missing = COLUMNS.filter(function (c) { return header.indexOf(c) < 0; });
    if (missing.length) {
      var start = header.length + 1;
      sheet.getRange(1, start, 1, missing.length).setValues([missing]).setFontWeight('bold');
      sheet.getRange(1, start, sheet.getMaxRows(), missing.length).setNumberFormat('@');
    }
  }
  return sheet;
}

function getOpportunitySheet_() {
  var ss = getSheet_().getParent();
  var sheet = ss.getSheetByName(OPPORTUNITY_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(OPPORTUNITY_SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(OPPORTUNITY_COLUMNS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, sheet.getMaxRows(), OPPORTUNITY_COLUMNS.length).setNumberFormat('@');
    sheet.getRange(1, 1, 1, OPPORTUNITY_COLUMNS.length).setFontWeight('bold');
  } else {
    var header = headerOf_(sheet);
    var missing = OPPORTUNITY_COLUMNS.filter(function (c) { return header.indexOf(c) < 0; });
    if (missing.length) {
      var start = header.length + 1;
      sheet.getRange(1, start, 1, missing.length).setValues([missing]).setFontWeight('bold');
      sheet.getRange(1, start, sheet.getMaxRows(), missing.length).setNumberFormat('@');
    }
  }
  return sheet;
}

function readRows_(sheet) {
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var header = headerOf_(sheet);
  var values = sheet.getRange(2, 1, last - 1, header.length).getValues();
  return values.map(function (v) {
    var o = {};
    header.forEach(function (h, i) { o[h] = v[i]; });
    LIST_FIELDS.forEach(function (f) {
      o[f] = String(o[f] || '').split(';').map(function (s) { return s.trim(); }).filter(String);
    });
    o.show_email = o.show_email === true || String(o.show_email).toUpperCase() === 'TRUE';
    o.email = String(o.email || '').toLowerCase();
    return o;
  });
}

function headerOf_(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String).filter(String);
}

// Cells in the sheet's own column order, so hand-reordered or added columns stay aligned.
function toCells_(rec, header) {
  return header.map(function (c) {
    if (COLUMNS.indexOf(c) < 0) return rec[c] == null ? '' : rec[c]; // a column you added by hand: keep its value
    var v = rec[c];
    if (LIST_FIELDS.indexOf(c) >= 0) v = (v || []).join('; ');
    if (c === 'show_email') return !!v;
    v = v == null ? '' : String(v);
    if (/^[=+\-@]/.test(v)) v = "'" + v; // never let a response become a formula
    return v;
  });
}

function appendRow_(sheet, rec) { sheet.appendRow(toCells_(rec, headerOf_(sheet))); }
function writeRow_(sheet, idx, rec) {
  var header = headerOf_(sheet);
  sheet.getRange(idx + 2, 1, 1, header.length).setValues([toCells_(rec, header)]);
}

function findIndex_(rows, field, value) {
  if (!value) return -1;
  for (var i = 0; i < rows.length; i++) if (String(rows[i][field]) === value) return i;
  return -1;
}

function readOpportunityRows_(sheet) {
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var header = headerOf_(sheet);
  var values = sheet.getRange(2, 1, last - 1, header.length).getValues();
  return values.map(function (v) {
    var o = {};
    header.forEach(function (h, i) { o[h] = normalizeCell_(v[i]); });
    return o;
  });
}

function normalizeCell_(value) {
  if (value instanceof Date) return Utilities.formatDate(value, timezone_(), 'yyyy-MM-dd');
  return String(value == null ? '' : value);
}

function toOpportunityCells_(rec, header) {
  return header.map(function (c) {
    var v = rec[c] == null ? '' : String(rec[c]);
    if (/^[=+\-@]/.test(v)) v = "'" + v;
    return v;
  });
}

function appendOpportunityRow_(sheet, rec) {
  sheet.appendRow(toOpportunityCells_(rec, headerOf_(sheet)));
}

// ---------- Public feed ----------
function publicProfiles_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(CACHE_KEY);
  if (hit) return JSON.parse(hit);
  var rows = readRows_(getSheet_());
  var out = rows.map(function (r) {
    var o = {};
    PUBLIC_FIELDS.forEach(function (f) { o[f] = r[f]; });
    if (r.updated_at instanceof Date) o.updated_at = r.updated_at.toISOString();
    if (r.show_email) o.email = r.email;
    return o;
  });
  out.sort(function (a, b) { return lastName_(a.name).localeCompare(lastName_(b.name)); });
  try { cache.put(CACHE_KEY, JSON.stringify(out), CACHE_SECONDS); } catch (e) { /* too large to cache; fine */ }
  return out;
}

function clearCache_() { CacheService.getScriptCache().remove(CACHE_KEY); }
function opportunityCacheKey_() { return OPPORTUNITY_CACHE_KEY + '_' + today_(); }
function clearOpportunitiesCache_() { CacheService.getScriptCache().remove(opportunityCacheKey_()); }
function lastName_(n) { var parts = String(n || '').trim().split(/\s+/); return parts[parts.length - 1] || ''; }

function publicOpportunities_() {
  var sheet = getOpportunitySheet_();
  if (cleanupExpiredOpportunities_(sheet)) clearOpportunitiesCache_();
  var cache = CacheService.getScriptCache();
  var today = today_();
  var cacheKey = opportunityCacheKey_();
  var hit = cache.get(cacheKey);
  if (hit) return JSON.parse(hit);
  var out = readOpportunityRows_(sheet).filter(function (r) {
    return r.visible_until && dateValue_(r.visible_until) >= dateValue_(today);
  }).map(function (r) {
    var o = {};
    OPPORTUNITY_PUBLIC_FIELDS.forEach(function (f) { o[f] = r[f] || ''; });
    return o;
  });
  out.sort(function (a, b) {
    var ad = a.deadline || a.visible_until;
    var bd = b.deadline || b.visible_until;
    return dateValue_(ad) - dateValue_(bd) || String(b.posted_at).localeCompare(String(a.posted_at));
  });
  try { cache.put(cacheKey, JSON.stringify(out), 10 * 60); } catch (e) { /* too large to cache; fine */ }
  return out;
}

function cleanupExpiredOpportunities_(sheet) {
  sheet = sheet || getOpportunitySheet_();
  var header = headerOf_(sheet);
  var visibleCol = header.indexOf('visible_until');
  if (visibleCol < 0 || sheet.getLastRow() < 2) return false;
  var todayValue = dateValue_(today_());
  var values = sheet.getRange(2, visibleCol + 1, sheet.getLastRow() - 1, 1).getValues();
  var removed = false;
  for (var i = values.length - 1; i >= 0; i--) {
    var visibleUntil = normalizeCell_(values[i][0]);
    if (visibleUntil && dateValue_(visibleUntil) < todayValue) {
      sheet.deleteRow(i + 2);
      removed = true;
    }
  }
  return removed;
}

function timezone_() {
  return Session.getScriptTimeZone() || 'America/New_York';
}

function today_() {
  return Utilities.formatDate(new Date(), timezone_(), 'yyyy-MM-dd');
}

function dateValue_(s) {
  var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return 0;
  return Number(m[1] + m[2] + m[3]);
}

// ---------- Email ----------
function editUrl_(rec) {
  var site = PropertiesService.getScriptProperties().getProperty('SITE_URL') || '';
  if (site && site.slice(-1) !== '/') site += '/';
  return site + 'survey.html?edit=' + encodeURIComponent(rec.edit_token);
}

function sendEditLink_(rec, reason) {
  var url = editUrl_(rec);
  var intro = {
    created: 'Thanks for adding your expertise to the AI⁴Methane directory. Your profile is now live.',
    existing: 'Someone (probably you) tried to create a new AI⁴Methane expertise profile with this email address, but you already have one.',
    requested: 'Here is the edit link you asked for.'
  }[reason] || '';
  var body =
    'Hi ' + rec.name + ',\n\n' + intro + '\n\n' +
    'Use this private link whenever you want to update or remove your profile:\n' + url + '\n\n' +
    'Keep this link to yourself: anyone who has it (and the survey password) can edit your profile. ' +
    'If you lose it, you can request a new copy from the survey page.\n\n' +
    'If you did not expect this email, you can ignore it, or use the link to delete the profile.\n\n' +
    '— AI⁴Methane';
  MailApp.sendEmail({ to: rec.email, subject: 'Your AI⁴Methane expertise profile', body: body, name: 'AI⁴Methane' });
}

function notifyAdmin_(rec) {
  var admin = PropertiesService.getScriptProperties().getProperty('ADMIN_EMAIL');
  if (!admin) return;
  try {
    MailApp.sendEmail({
      to: admin,
      subject: 'New AI⁴Methane expertise profile: ' + rec.name,
      body: rec.name + ' (' + rec.affiliation + ', ' + rec.email + ') added a profile.\n\nResponses sheet: ' +
        SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID')).getUrl(),
      name: 'AI⁴Methane'
    });
  } catch (e) { /* notification is optional */ }
}

function notifyAdminOpportunity_(rec) {
  var admin = PropertiesService.getScriptProperties().getProperty('ADMIN_EMAIL');
  if (!admin) return;
  try {
    MailApp.sendEmail({
      to: admin,
      subject: 'New AI⁴Methane opportunity: ' + rec.title,
      body: rec.contact_name + ' (' + rec.affiliation + ', ' + rec.contact_email + ') posted an opportunity.\n\n' +
        rec.title + '\nVisible until: ' + rec.visible_until + '\nDeadline: ' + (rec.deadline || 'Not listed') +
        '\n\nResponses sheet: ' + SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID')).getUrl(),
      name: 'AI⁴Methane'
    });
  } catch (e) { /* notification is optional */ }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
