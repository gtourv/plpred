const GATEWAY_URL = process.env.PLPRED_SHEET_GATEWAY_URL;
const GATEWAY_TOKEN = process.env.PLPRED_SHEET_GATEWAY_TOKEN;
const FOOTBALL_DATA_API_KEY = process.env.FOOTBALL_DATA_API_KEY;
const CALLMEBOT_PHONE = process.env.CALLMEBOT_PHONE;
const CALLMEBOT_API_KEY = process.env.CALLMEBOT_API_KEY;
const SEASON = process.env.PLPRED_SEASON || '2026/27';
const TIMEZONE = process.env.PLPRED_TIMEZONE || 'America/New_York';
const DRY_RUN = process.argv.includes('--dry-run');

const REQUIRED = {
  PLPRED_SHEET_GATEWAY_URL: GATEWAY_URL,
  PLPRED_SHEET_GATEWAY_TOKEN: GATEWAY_TOKEN,
  FOOTBALL_DATA_API_KEY,
  CALLMEBOT_PHONE,
  CALLMEBOT_API_KEY,
};

for (const [name, value] of Object.entries(REQUIRED)) {
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
}

const CLUB_ALIASES = new Map([
  ['arsenal', 'Arsenal'], ['aston villa', 'Aston Villa'], ['afc bournemouth', 'Bournemouth'], ['bournemouth', 'Bournemouth'],
  ['brentford', 'Brentford'], ['brighton', 'Brighton'], ['brighton and hove albion', 'Brighton'], ['brighton hove albion', 'Brighton'],
  ['chelsea', 'Chelsea'], ['coventry city', 'Coventry City'], ['crystal palace', 'Crystal Palace'], ['everton', 'Everton'],
  ['fulham', 'Fulham'], ['hull city', 'Hull City'], ['ipswich town', 'Ipswich Town'], ['leeds united', 'Leeds United'],
  ['liverpool', 'Liverpool'], ['manchester city', 'Manchester City'], ['manchester united', 'Manchester United'],
  ['newcastle united', 'Newcastle United'], ['nottingham forest', 'Nottingham Forest'], ['sunderland', 'Sunderland'],
  ['tottenham hotspur', 'Tottenham Hotspur'],
]);

const REFERENCE_BASELINES = [
  {
    name: 'Last year + promoted bottom',
    rankings: [
      'Arsenal', 'Manchester City', 'Manchester United', 'Aston Villa', 'Liverpool',
      'Bournemouth', 'Sunderland', 'Brighton', 'Brentford', 'Chelsea', 'Fulham',
      'Newcastle United', 'Everton', 'Leeds United', 'Crystal Palace', 'Nottingham Forest',
      'Tottenham Hotspur', 'Coventry City', 'Ipswich Town', 'Hull City',
    ],
  },
  {
    name: 'Wage bill ranking',
    rankings: [
      'Liverpool', 'Manchester City', 'Arsenal', 'Manchester United', 'Tottenham Hotspur',
      'Aston Villa', 'Chelsea', 'Newcastle United', 'Crystal Palace', 'Nottingham Forest',
      'Bournemouth', 'Everton', 'Fulham', 'Leeds United', 'Brighton', 'Sunderland',
      'Brentford', 'Ipswich Town', 'Hull City', 'Coventry City',
    ],
  },
];

function normalizeClub(value) {
  const normalized = String(value || '').toLowerCase().replace(/\b(fc|afc)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  if (CLUB_ALIASES.has(normalized)) return CLUB_ALIASES.get(normalized);
  for (const [alias, canonical] of CLUB_ALIASES.entries()) {
    if (normalized.includes(alias) || alias.includes(normalized)) return canonical;
  }
  return String(value || '').trim();
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!response.ok) throw new Error(`Request failed (${response.status}) for ${new URL(url).hostname}.`);
  return body;
}

async function readSheetSnapshot() {
  const url = new URL(GATEWAY_URL);
  url.searchParams.set('token', GATEWAY_TOKEN);
  const snapshot = await requestJson(url);
  if (!snapshot.ok) throw new Error('Google Sheet gateway returned an error.');
  return snapshot;
}

async function readStandings() {
  const url = 'https://api.football-data.org/v4/competitions/PL/standings?standingType=TOTAL';
  const body = await requestJson(url, { headers: { 'X-Auth-Token': FOOTBALL_DATA_API_KEY } });
  const table = body.standings?.find((standing) => standing.type === 'TOTAL')?.table || body.standings?.[0]?.table;
  if (!Array.isArray(table) || table.length === 0) throw new Error('football-data.org returned no Premier League standings.');
  return table.map((item) => ({
    position: item.position,
    team: normalizeClub(item.team?.name || item.team?.shortName),
    played: item.played ?? 0,
    won: item.won ?? 0,
    drawn: item.draw ?? 0,
    lost: item.lost ?? 0,
    goalsFor: item.goalsFor ?? 0,
    goalsAgainst: item.goalsAgainst ?? 0,
    goalDifference: item.goalDifference ?? 0,
    points: item.points ?? 0,
  }));
}

function sheetColumnIndex(headers, names) {
  for (const name of names) {
    const index = headers.indexOf(name);
    if (index >= 0) return index;
  }
  return -1;
}

function participantKey(name) {
  return String(name || '').trim().toLowerCase();
}

function readPreviousLeaderboard(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return [];
  if (!Array.isArray(rows[0])) return rows.filter((row) => row && row.name && row.rank);

  const headers = rows[0].map((header) => String(header).trim().toLowerCase());
  const rankIndex = sheetColumnIndex(headers, ['rank', 'place']);
  const nameIndex = sheetColumnIndex(headers, ['name', 'participant name', 'predictor']);
  const seasonIndex = sheetColumnIndex(headers, ['season']);
  if (rankIndex < 0 || nameIndex < 0) return [];

  return rows.slice(1).filter((row) => row.some((value) => value !== '')).map((row) => ({
    rank: Number(row[rankIndex]) || 0,
    name: String(row[nameIndex] || '').trim(),
    season: seasonIndex >= 0 ? String(row[seasonIndex] || '').trim() : SEASON,
  })).filter((row) => row.name && row.rank > 0 && row.season === SEASON);
}

function positionLabel(position) {
  const value = Number(position);
  const suffix = value % 100 >= 11 && value % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[value % 10] || 'th');
  return `${value}${suffix}`;
}

function scoreRanking(rankings, actualPositions) {
  return rankings.reduce((total, teamName, index) => {
    const actual = actualPositions.get(normalizeClub(teamName));
    return actual ? total + Math.abs(index + 1 - actual) : total;
  }, 0);
}

function scoreReferenceBaselines(standings) {
  const actualPositions = new Map(standings.map((row) => [normalizeClub(row.team), row.position]));
  return REFERENCE_BASELINES.map((baseline) => ({
    name: baseline.name,
    score: scoreRanking(baseline.rankings, actualPositions),
  }));
}

function scorePredictions(predictions, standings, previousLeaderboard = []) {
  const actualPositions = new Map(standings.map((row) => [normalizeClub(row.team), row.position]));
  const teamErrors = new Map();
  const calls = new Map();
  const previousRanks = new Map(previousLeaderboard.map((entry) => [participantKey(entry.name), Number(entry.rank)]));
  const scored = predictions.map((prediction) => {
    const misses = [];
    let score = 0;
    for (let index = 0; index < prediction.rankings.length; index += 1) {
      const team = normalizeClub(prediction.rankings[index]);
      const predicted = index + 1;
      const actual = actualPositions.get(team);
      if (!actual) continue;
      const delta = Math.abs(predicted - actual);
      score += delta;
      misses.push({ team, predicted, actual, delta });
      const aggregate = teamErrors.get(team) || { team, actual, total: 0, entries: 0, misses: 0 };
      aggregate.total += delta;
      aggregate.entries += 1;
      if (delta > 0) aggregate.misses += 1;
      teamErrors.set(team, aggregate);
      const key = `${team}|${predicted}`;
      calls.set(key, (calls.get(key) || 0) + 1);
    }
    misses.sort((a, b) => b.delta - a.delta);
    return { ...prediction, score, misses, biggestMiss: misses[0] || null };
  }).sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));

  const ranked = scored.map((entry, index) => {
    const currentRank = index + 1;
    const previousRank = previousRanks.get(participantKey(entry.name)) || null;
    return {
      ...entry,
      currentRank,
      previousRank,
      movement: previousRank === null ? null : previousRank - currentRank,
    };
  });
  const commonErrors = [...teamErrors.values()].sort((a, b) => b.total - a.total).slice(0, 3);
  const movements = ranked.filter((entry) => entry.movement !== null);
  const biggestClimber = movements.filter((entry) => entry.movement > 0).sort((a, b) => b.movement - a.movement || a.currentRank - b.currentRank)[0] || null;
  const biggestDrop = movements.filter((entry) => entry.movement < 0).sort((a, b) => a.movement - b.movement || b.currentRank - a.currentRank)[0] || null;

  return {
    scored: ranked,
    commonErrors,
    biggestClimber,
    biggestDrop,
    hasPreviousLeaderboard: previousRanks.size > 0,
  };
}

function formatDate() {
  return new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, dateStyle: 'long' }).format(new Date());
}

function formatTies(scored) {
  const groups = new Map();
  scored.forEach((entry) => {
    const group = groups.get(entry.score) || [];
    group.push(entry.name);
    groups.set(entry.score, group);
  });
  const tie = [...groups.entries()].find(([, names]) => names.length > 1);
  if (!tie) return '';
  const [score, names] = tie;
  const label = names.length === 2 ? `${names[0]} and ${names[1]}` : `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`;
  return `${label} are tied on ${score}`;
}

function formatTeamStory(commonErrors) {
  if (!commonErrors.length) return '';
  const [lead, ...rest] = commonErrors;
  const missCount = lead.misses === lead.entries && lead.entries > 1
    ? 'Every prediction missed'
    : `${lead.misses} of ${lead.entries} predictions missed`;
  let story = `${lead.team} are the room's biggest blind spot: ${missCount} their current ${positionLabel(lead.actual)}-place finish`;
  if (rest.length) {
    const names = rest.map((error) => error.team);
    const followUp = names.length === 2 ? `${names[0]} and ${names[1]}` : `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`;
    story += `. ${followUp} were the next-biggest collective misses`;
  }
  return `${story}.`;
}

function formatMovement(analysis) {
  if (!analysis.hasPreviousLeaderboard) {
    return "This update sets the movement baseline. Next time we'll see who made the biggest climb and who took the biggest tumble.";
  }
  if (!analysis.biggestClimber && !analysis.biggestDrop) {
    return 'The leaderboard held steady this round; no one changed places.';
  }
  const parts = [];
  if (analysis.biggestClimber) {
    const places = Math.abs(analysis.biggestClimber.movement);
    parts.push(`${analysis.biggestClimber.name} made the biggest climb, moving up ${places} place${places === 1 ? '' : 's'} to ${positionLabel(analysis.biggestClimber.currentRank)}`);
  }
  if (analysis.biggestDrop) {
    const places = Math.abs(analysis.biggestDrop.movement);
    parts.push(`${analysis.biggestDrop.name} had the biggest drop, falling ${places} place${places === 1 ? '' : 's'} to ${positionLabel(analysis.biggestDrop.currentRank)}`);
  }
  return `${parts.join('. ')}.`;
}

function formatMessage(analysis) {
  const { scored, commonErrors, referenceBaselines } = analysis;
  const winner = scored[0];
  const runnerUp = scored[1];
  const loser = scored[scored.length - 1];
  const lines = [`🏆 PL prediction update — ${SEASON}`, formatDate(), '', 'THE LEADERBOARD'];
  scored.forEach((entry, index) => lines.push(`${index + 1}. ${entry.name} — ${entry.score}`));
  lines.push('', 'REFERENCE BASELINES (not entrants; lower is better)');
  referenceBaselines.forEach((baseline) => lines.push(`${baseline.name} — ${baseline.score}`));
  lines.push('', 'THE READ');
  if (winner && runnerUp) {
    const gap = runnerUp.score - winner.score;
    lines.push(gap > 0
      ? `${winner.name} is up top, ${gap} point${gap === 1 ? '' : 's'} clear of ${runnerUp.name}.`
      : `${winner.name} and ${runnerUp.name} are level at the top.`);
  }
  const tieStory = formatTies(scored);
  if (tieStory) lines.push(`${tieStory}, while the middle of the table is still wide open.`);
  const teamStory = formatTeamStory(commonErrors);
  if (teamStory) lines.push(teamStory);
  lines.push(formatMovement(analysis));
  if (loser) {
    const margin = winner ? loser.score - winner.score : 0;
    const lastPlace = scored.filter((entry) => entry.score === loser.score).length > 1 ? 'tied for last' : 'bringing up the rear';
    const gap = margin > 0 ? `, ${margin} points behind ${winner.name}` : '';
    lines.push(`${loser.name} is ${lastPlace}${gap}. That's not a title race; that's a separate division—and the promotion campaign is not going well.`);
  }
  return lines.join('\n');
}

async function syncResults(analysis, standings) {
  const leaderboard = analysis.scored.map((entry, index) => ({
    rank: index + 1,
    name: entry.name,
    email: entry.email,
    score: entry.score,
    biggestMiss: entry.biggestMiss ? `${entry.biggestMiss.team} ${entry.biggestMiss.predicted}→${entry.biggestMiss.actual} (${entry.biggestMiss.delta})` : '',
    bestCall: entry.misses.length ? entry.misses.slice().sort((a, b) => a.delta - b.delta)[0].team : '',
  }));
  await requestJson(GATEWAY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'sync_results', token: GATEWAY_TOKEN, season: SEASON, updatedAt: new Date().toISOString(), currentStandings: standings, leaderboard }),
  });
}

async function sendWhatsApp(message) {
  const url = new URL('https://api.callmebot.com/whatsapp.php');
  url.search = new URLSearchParams({ phone: CALLMEBOT_PHONE, text: message, apikey: CALLMEBOT_API_KEY }).toString();
  const response = await fetch(url);
  if (!response.ok) throw new Error(`CallMeBot request failed (${response.status}).`);
}

async function main() {
  const [snapshot, standings] = await Promise.all([readSheetSnapshot(), readStandings()]);
  const predictions = Array.isArray(snapshot.predictions) ? snapshot.predictions.filter((entry) => entry.rankings?.length === 20) : [];
  if (predictions.length === 0) throw new Error('No complete predictions were found in the Predictions tab.');
  const previousLeaderboard = readPreviousLeaderboard(snapshot.leaderboard);
  const analysis = {
    ...scorePredictions(predictions, standings, previousLeaderboard),
    referenceBaselines: scoreReferenceBaselines(standings),
  };
  const message = formatMessage(analysis);

  if (DRY_RUN) {
    console.log(message);
    return;
  }

  await syncResults(analysis, standings);
  await sendWhatsApp(message);
  console.log(`Updated ${analysis.scored.length} predictions and sent the monthly WhatsApp report.`);
}

main().catch((error) => {
  console.error(`Monthly PL prediction run failed: ${error.message}`);
  process.exitCode = 1;
});
