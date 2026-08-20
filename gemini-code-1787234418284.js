const API_TOKEN = 'YOUR_FOOTBALL_DATA_ORG_API_KEY'; // Free from football-data.org
const SHEET_PREDICTIONS = 'Predictions';
const SHEET_LEADERBOARD = 'Leaderboard';
const ADMIN_EMAIL = 'your-email@example.com';

// 1. Webhook endpoint to receive submissions from the Drag & Drop page
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PREDICTIONS);
    
    // Append: Timestamp, Name, Email, Team 1, Team 2, ... Team 20
    const row = [new Date(), data.name, data.email, ...data.rankings];
    sheet.appendRow(row);
    
    // Send confirmation email to user
    if (data.email) {
      const body = `Hi ${data.name},\n\nYour Premier League predictions have been received!\n\n` +
                   data.rankings.map((t, idx) => `${idx + 1}. ${t}`).join('\n') +
                   `\n\nGood luck!`;
      MailApp.sendEmail(data.email, 'Premier League Prediction Confirmation', body);
    }
    
    return ContentService.createTextOutput(JSON.stringify({ status: 'success' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// 2. Monthly Scheduled Scoring Function
function runMonthlyScoring() {
  // Fetch current Premier League standings
  const url = 'https://api.football-data.org/v4/competitions/PL/standings';
  const response = UrlFetchApp.fetch(url, {
    headers: { 'X-Auth-Token': API_TOKEN }
  });
  const json = JSON.parse(response.getContentText());
  const standings = json.standings[0].table; // Array of team standings
  
  // Map team names to current positions (1-20)
  const actualPositions = {};
  standings.forEach(item => {
    actualPositions[item.team.name] = item.position;
  });

  // Read predictions
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PREDICTIONS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const entries = data.slice(1);
  
  const results = [];

  entries.forEach(entry => {
    const name = entry[1];
    const predictions = entry.slice(3, 23);
    let totalScore = 0;

    predictions.forEach((teamName, predictedIndex) => {
      const predictedPos = predictedIndex + 1;
      const actualPos = actualPositions[teamName] || 10; // Fallback if name variation
      totalScore += Math.abs(predictedPos - actualPos);
    });

    results.push({ name: name, score: totalScore });
  });

  // Sort lowest score (best) to highest
  results.sort((a, b) => a.score - b.score);

  // Format Leaderboard Message
  let message = `🏆 Premier League Prediction Table Update 🏆\n\n`;
  results.forEach((r, idx) => {
    message += `${idx + 1}. ${r.name} — ${r.score} pts\n`;
  });

  // Send Notification to Admin
  MailApp.sendEmail(ADMIN_EMAIL, 'Monthly PL Prediction Standings', message);
}