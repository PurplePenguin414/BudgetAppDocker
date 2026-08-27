# Budget Dashboard

A self-hosted, interactive personal finance dashboard. Track monthly income and
expenses, debt payoff, retirement accounts, savings goals, a dedicated
settlement/savings account, recurring bills, and year-over-year trends — all
in your own Docker container, with your data staying on your own server.

## Features

- **Monthly dashboard** — log income and expenses by category, see a 50/30/20
  (needs/wants/savings) breakdown, budget targets vs. actual spend per
  category, month-over-month comparison, and category trend charts. Toggle
  between light and dark mode from the nav bar.
- **Averages page** — average monthly income/spending across all logged
  months (the current, in-progress month is excluded so it doesn't skew the
  numbers), plus a per-category "expected spend" comparison.
- **Debt tracker** — log a balance per debt each month and watch a payoff
  trend chart. Set an optional "debt-free by" target date per debt to see a
  projected payoff date and an on-track/behind indicator, based on your
  actual average paydown pace. Includes an optional "dedicated account"
  tracker (deposits/withdrawals, useful for debt settlement programs) with an
  auto-calculated expected balance.
- **Savings & net worth** — total money saved over time, the ability to
  dedicate portions of it to specific purposes with optional target amounts
  and progress bars, a withdrawal log, and a net worth snapshot
  (assets − debt).
- **Retirement accounts** — track balance, your contributions, and employer
  match per account, logged as often as you get paid (not limited to once a
  month). Shows an auto-calculated "expected balance" (last balance +
  contributions logged) so you don't have to do the math. Set an optional
  goal per account — either a dollar target or a percent-of-income target —
  and see your progress for the year.
- **Goals overview** — a single glance page pulling together every goal
  you've set across Savings, Retirement, and Debt, plus your net worth.
- **Yearly review** — a full year rolled up into one view.
- **Bills & subscriptions** — track recurring bills either by a fixed day of
  the month (e.g. rent on the 1st) or a rolling cycle (e.g. "roughly every 30
  days"), grouped by category with annualized cost breakdowns and a
  category-percentage view.
- **CSV/JSON export** — download all your data at any time.
- **Mobile home screen widgets** (optional) — two included
  [Scriptable](https://scriptable.app/) widget scripts show your current
  month's snapshot or your average monthly budget right on your iPhone home
  screen, without opening the app.
- Single-password login, all data stored locally in a SQLite file you
  control.

## Requirements

- A server or machine with [Docker](https://docs.docker.com/get-docker/) and
  Docker Compose installed (a small VPS works fine).
- Node.js is **not** required on the host — everything runs inside the
  container.

## Setup

1. **Clone this repo** onto your server:
   ```bash
   git clone <this-repo-url> budget-dashboard
   cd budget-dashboard
   ```

2. **Create your environment file:**
   ```bash
   cp .env.example .env
   ```

3. **Generate a password hash** for logging into the dashboard. This runs
   inside a temporary Docker container, so you don't need Node installed
   locally:
   ```bash
   docker run --rm -v ${PWD}:/app -w /app node:20-slim sh -c "npm install --omit=dev && node hash-password.js 'Test123!'"
   ```
   Copy the printed hash into `.env` as `APP_PASSWORD_HASH`.

   **Important:** because bcrypt hashes contain `$` characters, and Docker
   Compose interpolates `$VAR`-style syntax even inside values loaded from
   `.env`, you need to **double every `$` in the hash** before pasting it in
   (`$2a$10$abc...` becomes `$$2a$$10$$abc...`). Otherwise Compose will
   silently mangle it and your password won't work.

4. **Set a session secret** in `.env` (any long random string works):
   ```bash
   openssl rand -hex 32
   ```
   Paste the result into `.env` as `SESSION_SECRET`.

5. **Set your timezone** — see [Important values to change](#important-values-to-change)
   below. This matters for bill due-date calculations and the "current
   month" logic throughout the app.

6. **Build and start the container:**
   ```bash
   docker compose build && docker compose up -d
   ```

7. Visit `http://<your-server-ip>:3011` (or whatever port you've mapped — see
   below) and log in with the password you hashed in step 3.

To put this behind a real domain with HTTPS, put a reverse proxy (Apache,
Nginx, Caddy, etc.) in front of it and point it at `127.0.0.1:3011`, then use
[Let's Encrypt](https://letsencrypt.org/)/certbot for a certificate. That
setup is outside the scope of this repo since it depends on your own hosting
environment.

## Important values to change

These are the settings you'll likely want to review or change before/after
your first deploy:

| What | Where | Why |
|---|---|---|
| **Password hash** | `.env` → `APP_PASSWORD_HASH` | Required. This is your login password (hashed). See step 3 above — remember to double the `$` characters. |
| **Session secret** | `.env` → `SESSION_SECRET` | Required. Keeps login sessions secure. Any random string works. |
| **Timezone** | `Dockerfile` → `ENV TZ=America/New_York` | Change to your own timezone (e.g. `America/Chicago`, `Europe/London`). This affects "today," bill due dates, the "mark charged today" button, and which month is treated as "current" (and therefore excluded from averages/yearly totals). Must match a valid [IANA timezone name](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones). |
| **Port** | `docker-compose.yml` → `"127.0.0.1:3011:3000"` | The `3011` is the port on your host machine. Change it if that port is already in use, or if you're running multiple instances. |
| **Container name** | `docker-compose.yml` → `container_name: budget-dashboard` | Cosmetic — change if you want a different name in `docker ps`. |
| **Default categories** | `server.js` → search for `incomeDefaults` and `expenseDefaults` | These are just starting points, seeded once on first run. You can add, rename, or delete categories entirely from within the app afterward — no code changes needed for day-to-day use. |
| **Debts / retirement accounts** | Debt and Retirement pages in the app | Both start empty on a fresh install, since everyone's are different. Add your own with the "+ add" links on each page. |
| **Widget key** *(optional)* | `.env` → `WIDGET_API_KEY` | Only needed if you want to use the mobile home screen widgets. See [Mobile widgets](#mobile-widgets-optional) below. |

Everything else — categories, debts, retirement accounts, bills, savings
goals, budget targets — is meant to be configured from within the app itself
once it's running, not by editing code.

## Mobile widgets (optional)

Two scripts are included for [Scriptable](https://scriptable.app/) (a free
iOS app that runs JavaScript-based home screen widgets):

- **`BudgetWidget.js`** — this month's income/expenses/net, savings rate, and
  every budget-target category with logged spending, color-coded by how
  close you are to the target.
- **`AvgBudgetWidget.js`** — your average monthly income/expenses/net and top
  spending categories, based on all completed months.

Both are adaptive — they look right whether you place them as a Small,
Medium, or Large widget.

To use them:

1. Set `WIDGET_API_KEY` in `.env` to any random string (e.g.
   `openssl rand -hex 24`), then rebuild the container.
2. Open Scriptable on your phone, create a new script, and paste in the
   contents of one of the two files.
3. Edit the `WIDGET_URL` and `WIDGET_KEY` constants near the top of the
   script to point at your own deployment and the key you set in step 1.
4. Add the script as a home screen widget (long-press your home screen → `+`
   → Scriptable → pick a size → select the script).

## Data & backups

All data lives in a SQLite file at `./data/budget.db` on the host (mounted
into the container via `docker-compose.yml`). Back this file up
periodically — it's the only copy of your data. The app also has a built-in
**Export** button (top of the dashboard) for a JSON or CSV download at any
time.

A simple daily backup via cron is a good idea:
```bash
# /root/backup-budget-db.sh
#!/bin/bash
SRC="/opt/budget-dashboard/data/budget.db"
DEST_DIR="/root/budget-backups"
DATE=$(date +%Y%m%d)
mkdir -p "$DEST_DIR"
cp "$SRC" "$DEST_DIR/budget-$DATE.db"
find "$DEST_DIR" -name "budget-*.db" -mtime +30 -delete
```
Then add it to crontab: `0 3 * * * /root/backup-budget-db.sh`

## Updating

After pulling new code:
```bash
git pull
docker compose build && docker rm -f budget-dashboard && docker compose up -d
```
Database migrations (if any) run automatically on container startup and only
ever add or rename things — they won't delete your existing data.

**If you change any file in `public/`** (a `.js` or `.css` file), bump its
cache-busting version query string in every HTML file that references it
(e.g. `nav.js?v=1` → `nav.js?v=2`). Browsers cache these aggressively, and
without a version bump you may not see your changes even after a successful
deploy and hard refresh.

## Tech stack

Node.js + Express, better-sqlite3, vanilla HTML/CSS/JS on the frontend (no
build step), Chart.js for charts, all running in a single Docker container.
