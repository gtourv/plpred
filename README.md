# PL prediction game

A static Premier League prediction results dashboard with Google Sheets as the database and a Codex-run weekly check that records completed odd matchweeks.

## What is included

- `index.html` — the public GitHub Pages results dashboard. It shows the leaderboard, historical score graph, latest table, and one- or two-person prediction comparisons.
- `google-apps-script.gs` — a small Google Apps Script bridge. It accepts new predictions, serves a public read-only results view without email addresses, and handles authenticated read/write requests from the score runner. It does not score predictions and does not send WhatsApp messages.
- `codex-plpred-monthly.mjs` — the score runner. It reads predictions through the bridge, fetches date-based Premier League table snapshots from football-data.org, calculates scores and analysis, writes `Current_Standings`, `Leaderboard`, and append-only `Leaderboard_History`, and sends the WhatsApp update through CallMeBot.

## Reference baselines

The public dashboard includes two reference predictions alongside the entrant comparisons. They are scored against the latest `Current_Standings` in the browser, but are not included in the entrant leaderboard, group similarity analysis, or team-pick distributions:

- **Last year + promoted bottom** — the 2025/26 Premier League finish for clubs that stayed up, followed by Coventry City, Ipswich Town, and Hull City in their Championship finish order.
- **Wage bill ranking** — a dated 2026/27 ranking of estimated gross fixed player payroll after the summer transfer deadline. The dashboard records the source and date checked; figures come from FBref's squad-wage table, which uses Capology data. Wage figures are estimates, exclude bonuses and non-playing staff, and are intentionally frozen as a season reference rather than refreshed during every score check.

Both reference scores are also included in every WhatsApp report, after the entrant leaderboard and before the narrative read. They remain comparison points only and never affect entrant rankings or movement.

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
6. Make sure the spreadsheet has these tabs: `Predictions`, `Current_Standings`, and `Leaderboard`. The updated bridge creates `Leaderboard_History` automatically if it is missing.

When the Apps Script code changes, use **Deploy → Manage deployments → Edit → New version → Deploy**. The existing `/exec` URL stays the same.

The public dashboard receives only names, predictions, scores, standings, and update timestamps. Email addresses are omitted from the public response. The gateway token, football-data.org key, and CallMeBot key never go to the browser. The public submission endpoint remains in the bridge for historical compatibility, but the GitHub Pages entry point is now read-only.

The dashboard keeps the last successful public snapshot in the browser's local storage. It renders that snapshot immediately on later visits while checking Apps Script in the background, retries a failed request once, and shows a stale-results notice if the latest request still cannot connect. The bridge also keeps a sanitized public snapshot in Apps Script `CacheService`, refreshed by the scheduled runner, so normal dashboard reads do not repeatedly open the spreadsheet. After deploying the current `google-apps-script.gs`, run the score runner once to warm that server-side cache. The Apps Script public endpoint currently responds through Google's redirecting web-app host, so a few seconds of latency and occasional cold-start/transient failures are expected; the dashboard's 20-second timeout, retry, and cached fallback are designed for that behavior.

For a future season, preserve this season by copying the Google Sheet and Apps Script project, then change `SPREADSHEET_ID` and `SEASON` in the copied project's Script properties. Deploy the copied project as its own web app, update `PUBLIC_GATEWAY_URL` in `index.html`, and update the private runner environment with the new web app URL and season. This keeps the old season's page and results intact.

## Backfill the initial graph

After the updated Apps Script has been deployed, run a dry run first. It reconstructs Week 1, Week 3, and Week 5 from official date-based standings snapshots and does not write to Sheets or send WhatsApp:

```bash
set -a
source /Users/greggtourville/Documents/Codex/private/plpred.env
set +a
node codex-plpred-monthly.mjs --backfill-history --dry-run
```

When the preview shows the expected checkpoint scores, run the same command without `--dry-run`:

```bash
node codex-plpred-monthly.mjs --backfill-history
```

This writes only history rows; it does not send a retroactive WhatsApp message. The write is idempotent, so rerunning it will not duplicate a checkpoint. The dashboard graph reads sanitized history rows and never receives email addresses.

## Local test of the score runner

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

The Codex scheduled task wakes every Monday at 8:00 AM Eastern time. The runner finds the latest fully completed odd matchweek, where all ten fixtures are finished. If there is no new odd matchweek checkpoint, it changes nothing and sends no WhatsApp message. This naturally handles postponements, international breaks, and weeks with no new completed checkpoint.

## GitHub Pages

Enable **Settings → Pages → Deploy from a branch → main → / (root)**. The repository can remain public because the source contains no private keys. If you make the repository private, GitHub Pages availability depends on the GitHub plan and organization settings.
