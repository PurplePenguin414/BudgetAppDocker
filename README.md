# Budget Dashboard

A self-hosted, interactive personal budgeting dashboard. Track monthly income and
expenses, debt payoff, a dedicated settlement/savings account, recurring bills, and
year-over-year trends — all in your own Docker container, with your data staying on
your own server.

## Features

- **Monthly dashboard** — log income and expenses by category, see a 50/30/20
  (needs/wants/savings) breakdown, month-over-month comparison, and category trend
  charts.
- **Averages page** — see your average monthly income/spending across all logged
  months (current, in-progress month excluded so it doesn't skew the numbers).
- **Debt tracker** — log a balance per debt each month and watch a payoff trend
  chart. Includes an optional "dedicated account" tracker (deposits/withdrawals,
  useful for debt settlement programs) with an auto-calculated expected balance.
- **Savings & net worth** — see total money saved over time, dedicate portions of
  it to specific purposes, and a net worth snapshot (assets − debt).
- **Yearly review** — a full year rolled up into one view.
- **Bills & subscriptions** — track recurring bills either by a fixed day of the
  month (e.g. rent on the 1st) or a rolling cycle (e.g. "roughly every 30 days"),
  grouped by category with annualized cost breakdowns.
- **CSV/JSON export** — download all your data at any time.
- Single-password login, all data stored locally in a SQLite file you control.

## Requirements

- A server or machine with [Docker](https://docs.docker.com/get-docker/) and
  Docker Compose installed (a small VPS works fine).
- Node.js is **not** required on the host — everything runs inside the container.

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

3. **Generate a password hash** for logging into the dashboard. This runs inside
   a temporary Docker container, so you don't need Node installed locally:
   ```bash
   docker run --rm -v $(pwd):/app -w /app node:20-slim sh -c "npm install --omit=dev && node hash-password.js 'yourpassword'"
   ```
   Copy the printed hash into `.env` as `APP_PASSWORD_HASH`.

4. **Set a session secret** in `.env` (any long random string works):
   ```bash
   openssl rand -hex 32
   ```
   Paste the result into `.env` as `SESSION_SECRET`.

5. **Set your timezone** — see [Important values to change](#important-values-to-change)
   below. This matters for bill due-date calculations.

6. **Build and start the container:**
   ```bash
   docker compose build && docker compose up -d
   ```

7. Visit `http://<your-server-ip>:3011` (or whatever port you've mapped — see
   below) and log in with the password you hashed in step 3.

To put this behind a real domain with HTTPS, put a reverse proxy (Apache, Nginx,
Caddy, etc.) in front of it and point it at `127.0.0.1:3011`, then use
[Let's Encrypt](https://letsencrypt.org/)/certbot for a certificate. That setup is
outside the scope of this repo since it depends on your own hosting environment.

## Important values to change

These are the settings you'll likely want to review or change before/after your
first deploy:

| What | Where | Why |
|---|---|---|
| **Password hash** | `.env` → `APP_PASSWORD_HASH` | Required. This is your login password (hashed). See step 3 above. |
| **Session secret** | `.env` → `SESSION_SECRET` | Required. Keeps login sessions secure. Any random string works. |
| **Timezone** | `Dockerfile` → `ENV TZ=America/New_York` | Change to your own timezone (e.g. `America/Chicago`, `Europe/London`). This affects "today," bill due dates, and the "mark charged today" button. Must match a valid [IANA timezone name](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones). |
| **Port** | `docker-compose.yml` → `"127.0.0.1:3011:3000"` | The `3011` is the port on your host machine. Change it if that port is already in use, or if you're running multiple instances. |
| **Container name** | `docker-compose.yml` → `container_name: budget-dashboard` | Cosmetic — change if you want a different name in `docker ps`. |
| **Default categories** | `server.js` → search for `incomeDefaults` and `expenseDefaults` | These are just starting points, seeded once on first run. You can add, rename, or delete categories entirely from within the app afterward — no code changes needed for day-to-day use. |
| **Default debts** | `server.js` → search for `Debts table starts empty` | The debt tracker starts with no debts seeded, since everyone's are different. Add your own from the Debt page in the app (`+ add another debt`). |

Everything else — categories, debts, bills, savings goals, budget targets — is
meant to be configured from within the app itself once it's running, not by
editing code.

## Data & backups

All data lives in a SQLite file at `./data/budget.db` on the host (mounted into
the container via `docker-compose.yml`). Back this file up periodically — it's
the only copy of your data. The app also has a built-in **Export** button
(top of the dashboard) for a JSON or CSV download at any time.

## Updating

After pulling new code:
```bash
git pull
docker compose build && docker rm -f budget-dashboard && docker compose up -d
```
Database migrations (if any) run automatically on container startup and only
ever add or rename things — they won't delete your existing data.

## Tech stack

Node.js + Express, better-sqlite3, vanilla HTML/CSS/JS on the frontend (no build
step), Chart.js for charts, all running in a single Docker container.
