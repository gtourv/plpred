const PREDICTIONS_TAB = 'Predictions';
const CURRENT_STANDINGS_TAB = 'Current_Standings';
const LEADERBOARD_TAB = 'Leaderboard';

function doPost(e) {
  try {
    const payload = parsePayload_(e);
    const action = payload.action || 'submit_prediction';

    if (action === 'sync_results') {
      requireGatewayToken_(payload.token);
      syncResults_(payload);
      return json_({ ok: true, action: action });
    }

    savePrediction_(payload);
    return json_({ ok: true, action: 'submit_prediction' });
  } catch (error) {
    return json_({ ok: false, error: error.message }, 400);
  }
}

function doGet(e) {
  try {
    requireGatewayToken_(e && e.parameter ? e.parameter.token : '');
    const spreadsheet = openSpreadsheet_();

    return json_({
      ok: true,
      predictions: readPredictions_(spreadsheet.getSheetByName(PREDICTIONS_TAB)),
      currentStandings: readRows_(spreadsheet.getSheetByName(CURRENT_STANDINGS_TAB)),
      leaderboard: readRows_(spreadsheet.getSheetByName(LEADERBOARD_TAB)),
    });
  } catch (error) {
    return json_({ ok: false, error: error.message }, 400);
  }
}

function savePrediction_(payload) {
  const name = String(payload.name || '').trim();
  const email = String(payload.email || '').trim();
  const season = String(payload.season || '2026/27').trim();
  const rankings = Array.isArray(payload.rankings) ? payload.rankings.map(String) : [];

  if (name.length < 2 || name.length > 80) throw new Error('Name is required.');
  if (email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error('A valid email is required.');
  if (rankings.length !== 20 || new Set(rankings).size !== 20) {
    throw new Error('Place every club exactly once.');
  }

  const spreadsheet = openSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(PREDICTIONS_TAB);
  if (!sheet) throw new Error('Missing Predictions tab.');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    ensurePredictionsHeader_(sheet);
    const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 24)).getValues()[0];
    const hasSeasonColumn = headers.some(function (header) {
      return String(header).trim().toLowerCase() === 'season';
    });
    const row = hasSeasonColumn
      ? [new Date(), name, email, season].concat(rankings)
      : [new Date(), name, email].concat(rankings);
    sheet.appendRow(row);
  } finally {
    lock.releaseLock();
  }
}

function syncResults_(payload) {
  const spreadsheet = openSpreadsheet_();
  const standings = Array.isArray(payload.currentStandings) ? payload.currentStandings : [];
  const leaderboard = Array.isArray(payload.leaderboard) ? payload.leaderboard : [];

  replaceRows_(spreadsheet.getSheetByName(CURRENT_STANDINGS_TAB), [
    ['Updated At', 'Season', 'Position', 'Team', 'Played', 'Won', 'Drawn', 'Lost', 'Goals For', 'Goals Against', 'Goal Difference', 'Points'],
  ].concat(standings.map(function (row) {
    return [
      payload.updatedAt || new Date().toISOString(), payload.season || '2026/27', row.position, row.team,
      row.played, row.won, row.drawn, row.lost, row.goalsFor, row.goalsAgainst, row.goalDifference, row.points,
    ];
  })));

  replaceRows_(spreadsheet.getSheetByName(LEADERBOARD_TAB), [
    ['Updated At', 'Season', 'Rank', 'Name', 'Email', 'Score', 'Biggest Miss', 'Best Call'],
  ].concat(leaderboard.map(function (row) {
    return [payload.updatedAt || new Date().toISOString(), payload.season || '2026/27', row.rank, row.name, row.email, row.score, row.biggestMiss, row.bestCall];
  })));
}

function readPredictions_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(function (header) { return String(header).trim().toLowerCase(); });
  const nameIndex = findHeader_(headers, ['name', 'predictor']);
  const emailIndex = findHeader_(headers, ['email', 'e-mail']);
  const seasonIndex = findHeader_(headers, ['season']);
  const timestampIndex = findHeader_(headers, ['timestamp', 'submitted at', 'date']);
  const teamIndexes = teamColumnIndexes_(headers);

  return values.slice(1).filter(function (row) {
    return row.some(function (value) { return value !== ''; });
  }).map(function (row) {
    const rankings = teamIndexes.length === 20
      ? teamIndexes.slice().sort(function (a, b) { return a.position - b.position; }).map(function (item) { return String(row[item.index] || '').trim(); })
      : row.slice(3, 23).map(function (team) { return String(team || '').trim(); });
    return {
      timestamp: timestampIndex >= 0 ? String(row[timestampIndex] || '') : '',
      name: nameIndex >= 0 ? String(row[nameIndex] || '').trim() : String(row[1] || '').trim(),
      email: emailIndex >= 0 ? String(row[emailIndex] || '').trim() : String(row[2] || '').trim(),
      season: seasonIndex >= 0 ? String(row[seasonIndex] || '2026/27').trim() : '2026/27',
      rankings: rankings,
    };
  }).filter(function (entry) {
    return entry.name && entry.rankings.length === 20;
  });
}

function teamColumnIndexes_(headers) {
  return headers.map(function (header, index) {
    const match = header.match(/^(?:team\s*)?(\d+)(?:st|nd|rd|th)?$/);
    return match ? { index: index, position: Number(match[1]) } : null;
  }).filter(function (item) {
    return item && item.position >= 1 && item.position <= 20;
  });
}

function readRows_(sheet) {
  if (!sheet || sheet.getLastRow() < 1) return [];
  return sheet.getDataRange().getValues();
}

function replaceRows_(sheet, rows) {
  if (!sheet) throw new Error('Missing destination tab.');
  sheet.clearContents();
  if (rows.length) sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
}

function ensurePredictionsHeader_(sheet) {
  if (sheet.getLastRow() > 0) return;
  sheet.getRange(1, 1, 1, 24).setValues([[
    'Timestamp', 'Name', 'Email', 'Season', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th', '13th', '14th', '15th', '16th', '17th', '18th', '19th', '20th',
  ]]);
}

function findHeader_(headers, names) {
  for (var i = 0; i < names.length; i += 1) {
    const index = headers.indexOf(names[i]);
    if (index >= 0) return index;
  }
  return -1;
}

function parsePayload_(e) {
  const raw = e && e.postData && e.postData.contents
    ? e.postData.contents
    : e && e.parameter && e.parameter.payload
      ? e.parameter.payload
      : '{}';
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error('Request body must be valid JSON.');
  }
}

function openSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('SPREADSHEET_ID is not configured.');
  return SpreadsheetApp.openById(id);
}

function requireGatewayToken_(provided) {
  const expected = PropertiesService.getScriptProperties().getProperty('GATEWAY_TOKEN');
  if (!expected || provided !== expected) throw new Error('Unauthorized.');
}

function json_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}
