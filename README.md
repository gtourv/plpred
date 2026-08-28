# PL prediction game

A static Premier League prediction results dashboard with Google Sheets as the database and a Codex-run biweekly score update.

## What is included

- `index.html` — the public GitHub Pages results dashboard. It shows the leaderboard, latest table, and one- or two-person prediction comparisons.
- `google-apps-script.gs` — a small Google Apps Script bridge. It accepts new predictions, serves a public read-only results view without email addresses, and handles authenticated read/write requests from the score runner. It does not score predictions and does not send WhatsApp messages.
- `codex-plpred-monthly.mjs` — the score runner. It reads predictions through the bridge, fetches the live Premier League table from football-data.org, calculates scores and analysis, writes `Current_Standings` and `Leaderboard`, and sends the WhatsApp update through CallMeBot.

## One-time Google setup

1. Open [script.google.com](https://script.google.com/) and create a standalone Apps Script project.
2. Paste the contents of `google-apps-script.gs` into the project.
3. Open **Project Settings → Script properties** and add:

   - `SPREADSHEET_ID` — your Google Sheet ID.
   - `GATEWAY_TOKEN` — generate a long random value. This protects reads and result writes from the scheduled runner.
   - `SEASON` — `2026/27` for the current contest. This is optional while using the default, but set it explicitly for future seasons.

4. Deploy it with **Deploy → New deployment → Web app**:

   - Execute as: **Me**
   - Who has access: **Anyone**

5. Copy the web app URL. The public dashboard uses the URL with `?view=public`; the private score runner uses the same URL with the gateway token.
6. Make sure the spreadsheet has these tabs: `Predictions`, `Current_Standings`, and `Leaderboard`.

When the Apps Script code changes, use **Deploy → Manage deployments → Edit → New version → Deploy**. The existing `/exec` URL stays the same.

The public dashboard receives only names, predictions, scores, standings, and update timestamps. Email addresses are omitted from the public response. The gateway token, football-data.org key, and CallMeBot key never go to the browser. The public submission endpoint remains in the bridge for historical compatibility, but the GitHub Pages entry point is now read-only.

For a future season, preserve this season by copying the Google Sheet and Apps Script project, then change `SPREADSHEET_ID` and `SEASON` in the copied project's Script properties. Deploy the copied project as its own web app, update `PUBLIC_GATEWAY_URL` in `index.html`, and update the private runner environment with the new web app URL and season. This keeps the old season's page and results intact.

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

The Codex scheduled task runs that normal command every other Monday at 8:00 AM Eastern time.

## GitHub Pages

Enable **Settings → Pages → Deploy from a branch → main → / (root)**. The repository can remain public because the source contains no private keys. If you make the repository private, GitHub Pages availability depends on the GitHub plan and organization settings.
