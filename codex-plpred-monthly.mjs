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

function scorePredictions(predictions, standings) {
  const actualPositions = new Map(standings.map((row) => [normalizeClub(row.team), row.position]));
  const teamErrors = new Map();
  const calls = new Map();
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
      const aggregate = teamErrors.get(team) || { team, total: 0, entries: 0, misses: 0 };
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

  const commonErrors = [...teamErrors.values()].sort((a, b) => b.total - a.total).slice(0, 3);
  const uniqueCalls = scored.flatMap((entry) => entry.misses.filter((miss) => calls.get(`${miss.team}|${miss.predicted}`) === 1).map((miss) => ({ ...miss, name: entry.name })))
    .sort((a, b) => b.delta - a.delta).slice(0, 4);
  const biggestChanges = scored.flatMap((entry) => entry.misses.map((miss) => ({ ...miss, name: entry.name })))
    .sort((a, b) => b.delta - a.delta).slice(0, 3);

  return { scored, commonErrors, uniqueCalls, biggestChanges };
}

function formatDate() {
  return new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, dateStyle: 'long' }).format(new Date());
}

function formatMessage(analysis) {
  const { scored, commonErrors, uniqueCalls, biggestChanges } = analysis;
  const winner = scored[0];
  const loser = scored[scored.length - 1];
  const lines = [`🏆 PL prediction update — ${SEASON}`, formatDate(), '', 'Scores (lower is better):'];
  scored.forEach((entry, index) => lines.push(`${index + 1}. ${entry.name} — ${entry.score}`));
  if (biggestChanges.length) {
    lines.push('', `Biggest swings: ${biggestChanges.map((miss) => `${miss.name}: ${miss.team} ${miss.predicted}→${miss.actual} (${miss.delta})`).join('; ')}`);
  }
  if (commonErrors.length) {
    lines.push('', `Common errors: ${commonErrors.map((error) => `${error.team} (${error.misses}/${error.entries} off; ${error.total} total places)`).join('; ')}`);
  }
  if (uniqueCalls.length) {
    lines.push('', `Unique calls: ${uniqueCalls.map((miss) => `${miss.name} had ${miss.team} ${miss.predicted}th`).join('; ')}`);
  }
  if (loser) {
    const margin = winner && loser.score - winner.score > 0 ? ` by ${loser.score - winner.score} places` : '';
    lines.push('', `🔥 Roast: ${loser.name} is currently bottom of the table${margin}. Even the spreadsheet is asking for a transfer window.`);
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
  const analysis = scorePredictions(predictions, standings);
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
