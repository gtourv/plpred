# PL prediction game

A static drag-and-drop Premier League prediction form with Google Sheets as the database and a Codex-run monthly score update.

## What is included

- `index.html` — the public GitHub Pages form. It uses SortableJS for touch-friendly drag-and-drop ordering.
- `google-apps-script.gs` — a small Google Apps Script bridge. It accepts new predictions and authenticated read/write requests from the monthly runner. It does not score predictions and does not send WhatsApp messages.
- `codex-plpred-monthly.mjs` — the monthly runner. It reads predictions through the bridge, fetches the live Premier League table from football-data.org, calculates scores and analysis, writes `Current_Standings` and `Leaderboard`, and sends the WhatsApp update through CallMeBot.

## One-time Google setup

1. Open [script.google.com](https://script.google.com/) and create a standalone Apps Script project.
2. Paste the contents of `google-apps-script.gs` into the project.
3. Open **Project Settings → Script properties** and add:

   - `SPREADSHEET_ID` — your Google Sheet ID.
   - `GATEWAY_TOKEN` — generate a long random value. This protects reads and result writes from the scheduled runner.

4. Deploy it with **Deploy → New deployment → Web app**:

   - Execute as: **Me**
   - Who has access: **Anyone**

5. Copy the web app URL. In `index.html`, replace `PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE` with that URL.
6. Make sure the spreadsheet has these tabs: `Predictions`, `Current_Standings`, and `Leaderboard`.

The public page never receives the gateway token, football-data.org key, or CallMeBot key. The public submission endpoint only accepts a prediction payload. The token is required for the monthly runner's read and result-sync calls.

## Local test of the monthly runner

Create a private environment file outside this repository. Do not commit it:

```text
PLPRED_SHEET_GATEWAY_URL=https://script.google.com/macros/s/your-deployment-id/exec
PLPRED_SHEET_GATEWAY_TOKEN=your-gateway-token
FOOTBALL_DATA_API_KEY=your-football-data-key
CALLMEBOT_PHONE=your-international-phone-number
CALLMEBOT_API_KEY=your-callmebot-key
PLPRED_SEASON=2026/27
PLPRED_TIMEZONE=America/New_York
```

Then run a safe preview:

```bash
set -a
source /path/to/private/plpred.env
set +a
node codex-plpred-monthly.mjs --dry-run
```

`--dry-run` fetches and calculates the report but does not update Sheets or send WhatsApp. A normal run performs both writes and the WhatsApp send:

```bash
node codex-plpred-monthly.mjs
```

The Codex scheduled task runs that normal command on the first day of each month at 8:00 AM Eastern time.

## GitHub Pages

Enable **Settings → Pages → Deploy from a branch → main → / (root)** after the web app URL has been added to `index.html`. The repository can remain public because the source contains no private keys. If you make the repository private, GitHub Pages availability depends on the GitHub plan and organization settings.
