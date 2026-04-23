/**
 * KCM Project Tracker — Google Sheets backend
 *
 * Web app that exposes the same data shape as data.json over HTTPS.
 * The static tracker calls doGet() to pull and doPost() to push.
 *
 * Tabs (one per entity):
 *   Meta, Verticals, Workstreams, ExpenseTypes, Statuses, Priorities,
 *   Owners, MilestoneSets, Projects, Milestones, Tasks, Initiatives,
 *   InitiativeMilestones, InitiativeTasks, WeeklyLedger, MonthlyPlan
 *
 * Setup (one-time):
 *   1. Run setup()           — creates all tabs with headers
 *   2. Run seed()            — populates from SEED_JSON in Seed.gs
 *   3. Deploy → New deployment → Web app
 *      Execute as: Me. Who has access: Anyone with the link (org domain).
 *   4. Copy the Web app URL into the tracker's Settings panel.
 */

// ----- Schemas (column order is the wire format) ---------------------------

var SCHEMAS = {
  Meta:            ['key', 'value'],
  Verticals:       ['name'],
  Workstreams:     ['name'],
  ExpenseTypes:    ['name'],
  Statuses:        ['name'],
  Priorities:      ['name'],
  Owners:          ['name'],
  MilestoneSets:   ['vertical', 'milestone'],

  Projects: [
    'id', 'name', 'short_name', 'vertical', 'stage', 'counterparty',
    'lead_owner', 'total_budget', 'deployed_to_date', 'last_update', 'next_action'
  ],

  Milestones: [
    'project_id', 'id', 'name', 'target_date', 'status', 'owner', 'notes'
  ],

  Tasks: [
    'project_id', 'id', 'workstream', 'name', 'owner', 'status', 'priority',
    'start', 'end', 'percent_complete', 'budget', 'actual', 'info_needed_from',
    'due_date', 'counterparty', 'next_action', 'last_update', 'notes'
  ],

  Initiatives: ['project_id', 'id', 'name'],

  InitiativeMilestones: [
    'project_id', 'initiative_id', 'id', 'name', 'target_date',
    'status', 'owner', 'notes'
  ],

  InitiativeTasks: [
    'project_id', 'initiative_id', 'id', 'name', 'owner', 'status',
    'priority', 'start', 'end', 'percent_complete', 'notes'
  ],

  WeeklyLedger: [
    'id', 'week_of', 'project_id', 'expense_type', 'workstream',
    'amount', 'description', 'status'
  ],

  MonthlyPlan: [
    'id', 'month', 'project_id', 'category', 'planned', 'actual', 'notes'
  ]
};

// Order matters: list tab names in display order.
var TAB_ORDER = [
  'Meta', 'Verticals', 'Workstreams', 'ExpenseTypes', 'Statuses', 'Priorities',
  'Owners', 'MilestoneSets', 'Projects', 'Milestones', 'Tasks', 'Initiatives',
  'InitiativeMilestones', 'InitiativeTasks', 'WeeklyLedger', 'MonthlyPlan'
];

// Numeric columns — coerced to Number on read.
var NUMERIC_FIELDS = {
  total_budget: true, deployed_to_date: true,
  budget: true, actual: true, percent_complete: true,
  amount: true, planned: true
};

// ----- Setup ---------------------------------------------------------------

/** Create all tabs with headers (idempotent — safe to re-run). */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  TAB_ORDER.forEach(function (tab) {
    var sheet = ss.getSheetByName(tab) || ss.insertSheet(tab);
    var headers = SCHEMAS[tab];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#1a3a5c')
      .setFontColor('#ffffff');
    // Trim extra columns beyond schema
    var maxCols = sheet.getMaxColumns();
    if (maxCols > headers.length) {
      sheet.deleteColumns(headers.length + 1, maxCols - headers.length);
    }
  });
  // Re-order tabs to canonical order
  TAB_ORDER.forEach(function (tab, i) {
    ss.getSheetByName(tab).activate();
    ss.moveActiveSheet(i + 1);
  });
  // Delete the default Sheet1 if it's still hanging around
  var s1 = ss.getSheetByName('Sheet1');
  if (s1 && TAB_ORDER.indexOf('Sheet1') === -1) ss.deleteSheet(s1);
  SpreadsheetApp.getActive().toast('Tabs created. Run seed() next.', 'KCM Tracker', 5);
}

/** Wipe all data rows (keeps headers). Run before re-seeding. */
function clearAllData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  TAB_ORDER.forEach(function (tab) {
    var sheet = ss.getSheetByName(tab);
    if (!sheet) return;
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
    }
  });
  SpreadsheetApp.getActive().toast('All data cleared.', 'KCM Tracker', 3);
}

/** Read SEED_JSON (defined in Seed.gs) and write to tabs. */
function seed() {
  if (typeof SEED_JSON === 'undefined' || !SEED_JSON) {
    throw new Error('SEED_JSON is not defined. Make sure Seed.gs is in the project.');
  }
  var data = JSON.parse(SEED_JSON);
  writeData(data);
  SpreadsheetApp.getActive().toast('Seeded from SEED_JSON.', 'KCM Tracker', 5);
}

// ----- HTTP endpoints ------------------------------------------------------

function doGet(e) {
  try {
    var data = readData();
    return jsonResponse({ ok: true, data: data });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (!body || !body.data) throw new Error('Missing "data" in POST body');
    writeData(body.data);
    return jsonResponse({ ok: true, savedAt: new Date().toISOString() });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ----- Read (sheets → data.json shape) -------------------------------------

function readData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  function rows(tab) {
    var sheet = ss.getSheetByName(tab);
    if (!sheet) return [];
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 2) return [];
    var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    var headers = SCHEMAS[tab];
    return values.map(function (row) {
      // Skip rows where every cell is blank
      var allBlank = row.every(function (v) { return v === '' || v === null; });
      if (allBlank) return null;
      var obj = {};
      headers.forEach(function (h, i) {
        var v = row[i];
        if (v instanceof Date) {
          v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
        }
        if (NUMERIC_FIELDS[h] && v !== '' && v !== null && !isNaN(v)) {
          v = Number(v);
        }
        if (v === null) v = '';
        obj[h] = v;
      });
      return obj;
    }).filter(function (r) { return r !== null; });
  }

  // Meta is key/value
  var meta = {};
  rows('Meta').forEach(function (r) {
    var v = r.value;
    if (r.key === 'horizon_weeks' && v !== '' && !isNaN(v)) v = Number(v);
    meta[r.key] = v;
  });

  // MilestoneSets: long-form rows → { vertical: [milestone, ...] }
  var msets = {};
  rows('MilestoneSets').forEach(function (r) {
    if (!r.vertical) return;
    if (!msets[r.vertical]) msets[r.vertical] = [];
    msets[r.vertical].push(r.milestone);
  });

  // Pluck name-only taxonomies
  function names(tab) { return rows(tab).map(function (r) { return r.name; }); }

  // Projects + their nested children
  var projectsRaw = rows('Projects');
  var milestonesByProject = groupBy(rows('Milestones'), 'project_id');
  var tasksByProject = groupBy(rows('Tasks'), 'project_id');
  var initiativesRaw = rows('Initiatives');
  var initMsByProject = groupBy(rows('InitiativeMilestones'), 'project_id');
  var initTsByProject = groupBy(rows('InitiativeTasks'), 'project_id');

  var projects = projectsRaw.map(function (p) {
    var proj = {
      id: p.id,
      name: p.name,
      short_name: p.short_name,
      vertical: p.vertical,
      stage: p.stage,
      counterparty: p.counterparty,
      lead_owner: p.lead_owner,
      total_budget: p.total_budget,
      deployed_to_date: p.deployed_to_date,
      last_update: p.last_update,
      next_action: p.next_action,
      milestones: stripField(milestonesByProject[p.id] || [], 'project_id'),
      tasks: stripField(tasksByProject[p.id] || [], 'project_id')
    };
    var inits = initiativesRaw.filter(function (i) { return i.project_id === p.id; });
    if (inits.length) {
      proj.initiatives = inits.map(function (i) {
        var iMs = (initMsByProject[p.id] || []).filter(function (m) { return m.initiative_id === i.id; });
        var iTs = (initTsByProject[p.id] || []).filter(function (t) { return t.initiative_id === i.id; });
        return {
          id: i.id,
          name: i.name,
          milestones: stripFields(iMs, ['project_id', 'initiative_id']),
          tasks: stripFields(iTs, ['project_id', 'initiative_id'])
        };
      });
    }
    return proj;
  });

  return {
    meta: meta,
    taxonomies: {
      verticals: names('Verticals'),
      workstreams: names('Workstreams'),
      expense_types: names('ExpenseTypes'),
      statuses: names('Statuses'),
      priorities: names('Priorities'),
      owners: names('Owners'),
      milestone_sets: msets
    },
    projects: projects,
    weekly_ledger: rows('WeeklyLedger'),
    monthly_plan: rows('MonthlyPlan')
  };
}

function groupBy(arr, key) {
  return arr.reduce(function (acc, item) {
    var k = item[key];
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {});
}

function stripField(arr, field) {
  return arr.map(function (it) {
    var copy = {};
    Object.keys(it).forEach(function (k) { if (k !== field) copy[k] = it[k]; });
    return copy;
  });
}

function stripFields(arr, fields) {
  return arr.map(function (it) {
    var copy = {};
    Object.keys(it).forEach(function (k) {
      if (fields.indexOf(k) === -1) copy[k] = it[k];
    });
    return copy;
  });
}

// ----- Write (data.json shape → sheets) ------------------------------------

function writeData(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  function ensureSheet(tab) {
    var sheet = ss.getSheetByName(tab);
    if (!sheet) {
      sheet = ss.insertSheet(tab);
      var headers = SCHEMAS[tab];
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, headers.length)
        .setFontWeight('bold').setBackground('#1a3a5c').setFontColor('#ffffff');
    }
    return sheet;
  }

  function writeRows(tab, items) {
    var sheet = ensureSheet(tab);
    var headers = SCHEMAS[tab];
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
    }
    if (!items.length) return;
    var rows = items.map(function (it) {
      return headers.map(function (h) {
        var v = it[h];
        return v === undefined || v === null ? '' : v;
      });
    });
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  // Meta — flatten { firm: ..., updated: ... } into [{key, value}, ...]
  var metaRows = [];
  Object.keys(data.meta || {}).forEach(function (k) {
    metaRows.push({ key: k, value: data.meta[k] });
  });
  writeRows('Meta', metaRows);

  var tax = data.taxonomies || {};
  writeRows('Verticals',    (tax.verticals    || []).map(function (n) { return { name: n }; }));
  writeRows('Workstreams',  (tax.workstreams  || []).map(function (n) { return { name: n }; }));
  writeRows('ExpenseTypes', (tax.expense_types|| []).map(function (n) { return { name: n }; }));
  writeRows('Statuses',     (tax.statuses     || []).map(function (n) { return { name: n }; }));
  writeRows('Priorities',   (tax.priorities   || []).map(function (n) { return { name: n }; }));
  writeRows('Owners',       (tax.owners       || []).map(function (n) { return { name: n }; }));

  var msetRows = [];
  Object.keys(tax.milestone_sets || {}).forEach(function (vertical) {
    (tax.milestone_sets[vertical] || []).forEach(function (m) {
      msetRows.push({ vertical: vertical, milestone: m });
    });
  });
  writeRows('MilestoneSets', msetRows);

  var projectRows = (data.projects || []).map(function (p) {
    return {
      id: p.id, name: p.name, short_name: p.short_name, vertical: p.vertical,
      stage: p.stage, counterparty: p.counterparty, lead_owner: p.lead_owner,
      total_budget: p.total_budget, deployed_to_date: p.deployed_to_date,
      last_update: p.last_update, next_action: p.next_action
    };
  });
  writeRows('Projects', projectRows);

  var msRows = [], tsRows = [], iRows = [], iMsRows = [], iTsRows = [];
  (data.projects || []).forEach(function (p) {
    (p.milestones || []).forEach(function (m) {
      msRows.push(Object.assign({ project_id: p.id }, m));
    });
    (p.tasks || []).forEach(function (t) {
      tsRows.push(Object.assign({ project_id: p.id }, t));
    });
    (p.initiatives || []).forEach(function (init) {
      iRows.push({ project_id: p.id, id: init.id, name: init.name });
      (init.milestones || []).forEach(function (m) {
        iMsRows.push(Object.assign({ project_id: p.id, initiative_id: init.id }, m));
      });
      (init.tasks || []).forEach(function (t) {
        iTsRows.push(Object.assign({ project_id: p.id, initiative_id: init.id }, t));
      });
    });
  });
  writeRows('Milestones',           msRows);
  writeRows('Tasks',                tsRows);
  writeRows('Initiatives',          iRows);
  writeRows('InitiativeMilestones', iMsRows);
  writeRows('InitiativeTasks',      iTsRows);

  writeRows('WeeklyLedger', data.weekly_ledger || []);
  writeRows('MonthlyPlan',  data.monthly_plan  || []);
}

// Object.assign polyfill for older Apps Script runtimes
if (typeof Object.assign !== 'function') {
  Object.assign = function (target) {
    for (var i = 1; i < arguments.length; i++) {
      var src = arguments[i];
      if (src) Object.keys(src).forEach(function (k) { target[k] = src[k]; });
    }
    return target;
  };
}
