const PREDICTIONS_TAB = 'Predictions';
const CURRENT_STANDINGS_TAB = 'Current_Standings';
const LEADERBOARD_TAB = 'Leaderboard';
const DEFAULT_SEASON = '2026/27';

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
    if (e && e.parameter && e.parameter.view === 'public') {
      const publicSnapshot = readPublicSnapshot_();
      return e.parameter.callback ? jsonp_(publicSnapshot, e.parameter.callback) : json_(publicSnapshot);
    }

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

function readPublicSnapshot_() {
  const spreadsheet = openSpreadsheet_();
  const season = currentSeason_();
  const currentStandings = readPublicStandings_(spreadsheet.getSheetByName(CURRENT_STANDINGS_TAB));
  const leaderboard = readPublicLeaderboard_(spreadsheet.getSheetByName(LEADERBOARD_TAB), season);
  const predictions = readPublicPredictions_(spreadsheet.getSheetByName(PREDICTIONS_TAB));
  return {
    ok: true,
    season: season,
    updatedAt: latestUpdatedAt_(currentStandings, leaderboard),
    currentStandings: currentStandings,
    leaderboard: leaderboard,
    predictions: predictions,
  };
}

function readPublicPredictions_(sheet) {
  return readPredictions_(sheet).map(function (entry) {
    return {
      timestamp: entry.timestamp,
      name: entry.name,
      season: entry.season,
      rankings: entry.rankings,
    };
  });
}

function readPublicStandings_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(function (header) { return String(header).trim().toLowerCase(); });
  const positionIndex = findHeader_(headers, ['position', 'pos']);
  const teamIndex = findHeader_(headers, ['team', 'team name', 'club']);
  const updatedAtIndex = findHeader_(headers, ['updated at', 'last updated', 'timestamp']);
  const playedIndex = findHeader_(headers, ['played', 'games played']);
  const pointsIndex = findHeader_(headers, ['points', 'pts']);

  return values.slice(1).filter(function (row) {
    return row.some(function (value) { return value !== ''; });
  }).map(function (row, index) {
    return {
      updatedAt: updatedAtIndex >= 0 ? String(row[updatedAtIndex] || '') : '',
      position: positionIndex >= 0 ? Number(row[positionIndex]) || index + 1 : index + 1,
      team: teamIndex >= 0 ? String(row[teamIndex] || '').trim() : '',
      played: playedIndex >= 0 ? Number(row[playedIndex]) || 0 : 0,
      points: pointsIndex >= 0 ? Number(row[pointsIndex]) || 0 : 0,
    };
  }).filter(function (row) {
    return row.team;
  });
}

function readPublicLeaderboard_(sheet, fallbackSeason) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(function (header) { return String(header).trim().toLowerCase(); });
  const rankIndex = findHeader_(headers, ['rank', 'place']);
  const nameIndex = findHeader_(headers, ['name', 'participant name', 'predictor']);
  const scoreIndex = findHeader_(headers, ['score', 'total score', 'points']);
  const updatedAtIndex = findHeader_(headers, ['updated at', 'last updated', 'timestamp']);
  const seasonIndex = findHeader_(headers, ['season']);
  const biggestMissIndex = findHeader_(headers, ['biggest miss', 'biggest error']);
  const bestCallIndex = findHeader_(headers, ['best call']);

  return values.slice(1).filter(function (row) {
    return row.some(function (value) { return value !== ''; });
  }).map(function (row, index) {
    return {
      rank: rankIndex >= 0 ? Number(row[rankIndex]) || index + 1 : index + 1,
      name: nameIndex >= 0 ? String(row[nameIndex] || '').trim() : '',
      score: scoreIndex >= 0 && row[scoreIndex] !== '' ? Number(row[scoreIndex]) : null,
      updatedAt: updatedAtIndex >= 0 ? String(row[updatedAtIndex] || '') : '',
      season: seasonIndex >= 0 ? String(row[seasonIndex] || fallbackSeason).trim() : fallbackSeason,
      biggestMiss: biggestMissIndex >= 0 ? String(row[biggestMissIndex] || '').trim() : '',
      bestCall: bestCallIndex >= 0 ? String(row[bestCallIndex] || '').trim() : '',
    };
  }).filter(function (row) {
    return row.name;
  }).sort(function (a, b) {
    return a.rank - b.rank;
  });
}

function latestUpdatedAt_(standings, leaderboard) {
  const values = standings.concat(leaderboard).map(function (row) {
    return String(row.updatedAt || '').trim();
  }).filter(function (value) {
    return value;
  });
  if (!values.length) return '';
  return values.sort(function (a, b) {
    return new Date(b).getTime() - new Date(a).getTime();
  })[0];
}

function savePrediction_(payload) {
  const name = String(payload.name || '').trim();
  const email = String(payload.email || '').trim();
  const season = String(payload.season || currentSeason_()).trim();
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
      payload.updatedAt || new Date().toISOString(), payload.season || currentSeason_(), row.position, row.team,
      row.played, row.won, row.drawn, row.lost, row.goalsFor, row.goalsAgainst, row.goalDifference, row.points,
    ];
  })));

  replaceRows_(spreadsheet.getSheetByName(LEADERBOARD_TAB), [
    ['Updated At', 'Season', 'Rank', 'Name', 'Email', 'Score', 'Biggest Miss', 'Best Call'],
  ].concat(leaderboard.map(function (row) {
    return [payload.updatedAt || new Date().toISOString(), payload.season || currentSeason_(), row.rank, row.name, row.email, row.score, row.biggestMiss, row.bestCall];
  })));
}

function readPredictions_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const fallbackSeason = currentSeason_();
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
      season: seasonIndex >= 0 ? String(row[seasonIndex] || fallbackSeason).trim() : fallbackSeason,
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

function currentSeason_() {
  const configured = PropertiesService.getScriptProperties().getProperty('SEASON');
  return configured && configured.trim() ? configured.trim() : DEFAULT_SEASON;
}

function requireGatewayToken_(provided) {
  const expected = PropertiesService.getScriptProperties().getProperty('GATEWAY_TOKEN');
  if (!expected || provided !== expected) throw new Error('Unauthorized.');
}

function json_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

function jsonp_(body, callback) {
  if (!/^[A-Za-z_$][0-9A-Za-z_$]*(\.[A-Za-z_$][0-9A-Za-z_$]*)*$/.test(callback)) {
    throw new Error('Invalid callback.');
  }
  return ContentService.createTextOutput(callback + '(' + JSON.stringify(body) + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}
