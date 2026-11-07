# Wishing Wealth Tracker

Track the ticker list from [WishingWealthBlog][1], simulate trades from a
$10,000 virtual portfolio, email yourself changes and daily PnL, and view a
simple dashboard. Runs as a single Next.js app on Vercel.

Key points
- Stack: Next.js (App Router) + Drizzle ORM + Neon (Vercel Postgres) + Resend
- Scheduling: Vercel Cron calls a single heartbeat route
- Prices: Scraped from TradingView symbol pages
- Auth: Email OTP (cryptographically generated), no NextAuth
- Trading: Equal-weight portfolio, rebalance at next market open, daily close
  valuation, fractional shares, zero fees (MVP)

-------------------------------------------------------------------------------

Goals

- Scrape [WishingWealthBlog][1] multiple times per day to read a known section
  that lists stock tickers.
- Detect immediate changes in that section (no multi-scrape confirmation).
- Generate buy/sell decisions based on presence/absence of tickers.
- Maintain a virtual portfolio seeded with $10,000 USD.
- Rebalance at the next US market open to equal-weight all currently listed
  tickers; sell those no longer listed.
- Track daily and cumulative PnL and overall equity.
- Email:
  - Change alerts when tickers are added/removed
  - Daily digest after close with net worth and percent change
- Provide a passwordless OTP login and a simple dashboard to see current
  positions, equity curve, and historical performance of tickers (including
  past holdings no longer held).

-------------------------------------------------------------------------------

System architecture

- Next.js app (Node runtime)
  - UI: Dashboard pages
  - API:
    - Auth (request OTP, verify OTP)
    - Cron heartbeat (orchestrates scraping, rebalance, close valuation)
    - Read-only endpoints for dashboard data
- Database: Neon (Vercel Postgres) via Drizzle ORM (serverless driver)
- Email: Resend for OTPs, change alerts, and daily digest
- Scheduler: Vercel Cron → calls one heartbeat route on a frequent schedule
- Price source: TradingView symbol pages for daily open/close scraping

High-level data flow (MVP simplified)
1) Scrape blog and extract tickers in application code.
2) Diff extracted tickers vs current open positions.
3) Compute equal-weight targets and directly update positions and cash.
4) Fetch prices for involved tickers; upsert into prices_daily.
5) Compute and store portfolio_values for dashboard charts.

-------------------------------------------------------------------------------

Scheduling and time windows (MVP)

- Run the job however you prefer (manual, local scheduler, or Vercel Cron later).
- No idempotency guards in DB; ensure your runner doesn’t double-execute.

-------------------------------------------------------------------------------

Authentication (OTP)

- No NextAuth; a random 6-digit code is emailed via Resend and stored only as an
  HMAC on the user's row.
- Codes are short-lived (4 minutes), single use and allow 5 attempts; an address
  gets at most 10 codes a day.
- Only whitelisted email(s) may request OTPs.
- On successful verification, set a signed, httpOnly session cookie.

-------------------------------------------------------------------------------

Scraping: Wishing Wealth Blog

- Source URL: https://www.wishingwealthblog.com/ (or a specific page that
  consistently lists tickers).
- The tickers are in a known container; configure a CSS selector via env.
- Extraction rules:
  - Restrict parsing to the specified container only.
  - Recognize tickers as uppercase 1–5 letters with optional “.X” suffix
    (e.g., BRK.B). Optionally allow a leading “$”.
  - Do not use multi-scrape confirmation (changes are immediate).
- On each scrape:
  - Persist a snapshot record (URL, fetchedAt, content hash).
  - Extract the ticker set and persist it.
  - Compute added and removed tickers vs the last known set and create signals.
  - If changed, send a change alert email with added/removed (and optionally
    the latest known net worth and % change if available).
- Be polite: identify a custom User-Agent, space out requests, follow robots.txt
  and site ToS. Use conditional GET and caching where feasible.

-------------------------------------------------------------------------------

Prices: TradingView page scrape

- For each US ticker, fetch the TradingView symbol page
  (example: https://www.tradingview.com/symbols/NYSE-HWM/).
- Extract the daily open and close for a given date.
- Mapping symbols to pages:
  - Assume US equities; attempt resolution across common exchanges (NYSE,
    NASDAQ, AMEX). Choose a deterministic rule (e.g., try in priority order).
  - Handle dot tickers (e.g., BRK.B) according to TradingView’s path format.
- Caching:
  - Cache daily prices (symbol, date) in the database.
  - Avoid refetching the same day’s data once stored.
- Fallbacks:
  - If open isn’t available at rebalance time, defer order fills or use the
    earliest available daily open data for that trading day.
  - If close isn’t available at close-time window, retry later within the
    window; otherwise mark as pending and recompute PnL when data arrives.
- Compliance:
  - Respect TradingView’s ToS and robots.txt. Add backoff and minimal load.
  - Be prepared for markup changes; isolate parsing and provide clear errors.

-------------------------------------------------------------------------------

Trading rules and valuation

- Currency: USD
- Starting cash: $10,000
- Positions: fractional shares allowed
- Fees/slippage: none (MVP)
- Rebalance:
  - At next market open after detecting the current ticker set, hold an
    equal-weight allocation across all listed tickers.
  - Target weight per symbol = 1 / N (N = count of current tickers).
  - Translate target weights to target dollar amounts using current equity
    (cash + last known market value) and fill orders at that day’s open price.
  - Symbols no longer present are sold in full at that day’s open.
- Valuation:
  - After market close, value positions using that day’s close.
  - Store daily equity, cash, daily PnL, and cumulative PnL.
- Corporate actions:
  - Prefer adjusted prices if available. If only unadjusted are available,
    note potential discrepancies.

-------------------------------------------------------------------------------

Email notifications (Resend)

- Change alert (triggered immediately on set change):
  - Subject with counts: e.g., “List changed (+X, -Y)”
  - Body lists added and removed tickers
  - If available, include current net worth and today’s percent change
- Daily digest (after close):
  - Net worth
  - Daily percent change
  - Cumulative percent since inception
  - Count of current holdings
- Keep content concise and readable on mobile.

-------------------------------------------------------------------------------

Dashboard (Next.js)

- Overview:
  - Current net worth, cash, daily and total PnL
  - Current holdings table (symbol, qty, cost basis, market value, PnL)
- Equity curve:
  - Time series of portfolio equity
- Positions history:
  - Closed positions with entry/exit dates and returns
- Ticker detail:
  - Per-ticker performance while held
- Audit:
  - Recent scrapes, current/previous ticker sets, last emails sent
- Access:
  - OTP-protected routes (server-side verification of the session cookie)

-------------------------------------------------------------------------------

API surface (MVP)

- Portfolio (read-only)
  - GET /api/portfolio/summary
  - GET /api/portfolio/values?range=...
  - GET /api/positions/open
  - GET /api/positions/closed
  - GET /api/prices/latest?symbol=...
  - GET /api/prices/range?symbol=...&from=...&to=...
// Auth and cron endpoints can be added later.

-------------------------------------------------------------------------------

Data model (conceptual)

- users
  - id, email (unique), createdAt
- portfolios
  - id, name, baseCurrency (USD), initialCash, createdAt
- positions
  - id, portfolioId, symbol, qty, avgCost, openedAt, closedAt
- orders
  - id, portfolioId, symbol, side (BUY/SELL), qty, targetWeight, status, ts
- fills
  - id, orderId, filledQty, price, filledAt, fees
- portfolio_values
  - id, portfolioId, date, equity, cash, pnlDay, pnlTotal
- page_snapshots
  - id, url, fetchedAt, contentHash
- ticker_sets
  - id, snapshotId (optional), symbols (JSON array), extractedAt
- ticker_signals
  - id, symbol, type (BUY/SELL), detectedAt
- prices_daily
  - id, symbol, date, open (optional), close (optional), adjClose (optional),
    volume (optional), source
  - unique (symbol, date)

Notes
- Use decimal-safe types for monetary fields.
- Add indexes on portfolioId/date and portfolioId/symbol as needed.

-------------------------------------------------------------------------------

Environment configuration

- DATABASE_URL: Neon (Vercel Postgres) URL
- RESEND_API_KEY
- ALERT_EMAIL: destination for alerts/digests
- AUTH_ALLOWED_EMAILS: comma-separated list of allowed logins
- SESSION_SECRET: secret for signing JWT/session cookies
- OTP_SECRET: secret for hashing the stored login codes
- CRON_SECRET: shared secret for the heartbeat endpoint

-------------------------------------------------------------------------------

constants.ts

```ts
export default {
    OTP_TTL_SECONDS: 240,
    OTP_MAX_ATTEMPTS: 5,
    OTP_MAX_SENDS: 10,
    OTP_SEND_WINDOW_HOURS: 24,
    OTP_EMAIL_VALID_MINUTES: 2,
    SOURCE_URL: "https://www.wishingwealthblog.com/",
} as const;
```

-------------------------------------------------------------------------------

Cron configuration (Vercel)

- Define a single heartbeat cron that runs frequently (e.g., every 10 minutes).
- Heartbeat decides which job to run based on ET time windows.
- Gate each job with a unique key in cron_runs to avoid duplicate execution.

Example schedule (description)
- Heartbeat: */10 * * * *
- Optional weekly maintenance job for symbol resolution updates.

-------------------------------------------------------------------------------

Operational guidelines

- Politeness and compliance
  - Respect the blog and TradingView ToS and robots.txt.
  - Use a custom User-Agent and conservative frequency.
  - Backoff and retry with jitter; avoid hammering sources.
- Idempotency
  - All cron-triggered jobs must be idempotent.
  - Use the cron_runs table to prevent double execution in the same window.
- Error handling and observability
  - Structured logs with enough context (job, window, symbols count).
  - Record failures and last success timestamps for each job.
- Data integrity
  - Monetary math with decimals; never use floats for cash/equity.
  - Ensure (symbol, date) uniqueness for daily prices.
- Security
  - httpOnly, Secure cookies; sameSite Lax or Strict.
  - Limit login-code sends and attempts; throttle scraping endpoints.
  - Store login codes only as an HMAC, and use each code once.

-------------------------------------------------------------------------------

Acceptance criteria

- Scraping detects added/removed tickers reliably from the configured section.
- Change alerts are sent within the next scrape window after a change appears.
- Rebalance generates orders that bring the portfolio to equal weight by using
  that day’s open and updates positions and cash correctly.
- Daily valuation uses that day’s close and persists equity, pnlDay, pnlTotal.
- The daily digest reflects net worth and daily percent change matching stored
  values.
- Dashboard shows:
  - Current holdings with quantities, cost basis, and market value
  - Equity curve over time
  - Closed positions with returns
  - History of ticker sets and recent scrapes
- All cron jobs are idempotent and run at most once per window.

-------------------------------------------------------------------------------

Setup (overview)

- Requirements: Node 24 (see `.nvmrc`), a Neon database (Vercel Postgres), Resend account.
- Steps:
  1) Configure environment variables (.env.local) as listed above.
  2) Create database schema with Drizzle (generate migrations, then apply).
  3) Implement route handlers for auth, cron heartbeat, and portfolio reads.
  4) Deploy to Vercel; add Cron entries; set env vars in Vercel.
  5) Configure a sending domain in Resend for production emails.
- Local dev:
  - Run Next.js dev server and use a local Postgres or a Neon branch.
  - Use a test email address for OTP and alerts.
- Checks: `npm run check` (Biome), `npm run typecheck`, `npm run scrape:test`,
  and `npm run test:smoke` (Playwright, against a local build with a throwaway
  Postgres and stand-ins; see `playwright.config.ts`).

-------------------------------------------------------------------------------

Limitations and future work

- TradingView markup may change; keep the scraper isolated and easy to update.
- Add a US market holiday calendar to skip trading/valuation on holidays.
- Support slippage/fees modeling and multiple portfolios.
- Provide CSV export and additional alerts (Slack/Discord webhooks).
- Consider switching to an official market data API if scraping becomes brittle.

-------------------------------------------------------------------------------

Notes

- This project is for research/education; it is not financial advice.
- Always review and comply with the terms of the websites you scrape.

[1]: wishingwealthblog.com
-------------------------------------------------------------------------------

### Detailed Postgres schema (DDL + indexes)

The following SQL designs a scalable, normalized schema optimized for the app’s workflows: OTP auth, scraping & ticker tracking, daily prices, portfolio rebalancing at open, and daily valuation at close. Money and quantities use high-precision numerics. Time is stored in timestamptz (UTC). Idempotency and performance are ensured with proper uniqueness constraints and indexes.

Notes
- Monetary and quantity fields: numeric(20,8)
- Partial unique index for one open position per (portfolio, symbol).
- Unique index ensures one daily price per (symbol, date).

```sql
-- Enable useful extensions (safe to run repeatedly)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";    -- case-insensitive text (emails, tickers)

-- Domain enums
DO $$ BEGIN
  CREATE TYPE order_side AS ENUM ('BUY','SELL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE order_status AS ENUM ('PENDING','PARTIALLY_FILLED','FILLED','CANCELLED','REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE signal_type AS ENUM ('BUY','SELL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE cron_job_type AS ENUM ('HEARTBEAT','SCRAPE','REBALANCE','CLOSE_VALUE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE cron_status AS ENUM ('SUCCESS','FAILED','SKIPPED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE email_type AS ENUM ('OTP','ALERT','DIGEST');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE email_status AS ENUM ('QUEUED','SENT','DELIVERED','FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Users and sessions ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       citext NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Optional DB-backed sessions for revocation/audit (cookie is still httpOnly & signed)
CREATE TABLE IF NOT EXISTS sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  issued_at    timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  user_agent   text,
  ip           inet,
  UNIQUE (user_id, id)
);
CREATE INDEX IF NOT EXISTS sessions_active_idx ON sessions (user_id, expires_at) WHERE revoked_at IS NULL;

-- Symbol catalog & mapping ----------------------------------------------------
CREATE TABLE IF NOT EXISTS symbols (
  id          bigserial PRIMARY KEY,
  ticker      citext NOT NULL,
  exchange    text NOT NULL DEFAULT '',  -- empty string for unknown/US composite
  country     text,
  is_active   boolean NOT NULL DEFAULT true,
  first_seen  date DEFAULT (now()::date),
  CONSTRAINT symbols_ticker_exchange_key UNIQUE (ticker, exchange)
);
CREATE INDEX IF NOT EXISTS symbols_ticker_idx ON symbols (ticker);

-- Alias mapping omitted for MVP. Use `symbols.ticker` directly.

-- TradingView symbol resolution: For MVP, resolve the slug per request without caching.

-- Daily prices ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prices_daily (
  id          bigserial PRIMARY KEY,
  symbol_id   bigint NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
  date        date NOT NULL,
  open        numeric(20,8),
  close       numeric(20,8),
  adj_close   numeric(20,8),
  volume      bigint,
  source      text NOT NULL DEFAULT 'tradingview',
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prices_daily_symbol_date_key UNIQUE (symbol_id, date)
);
CREATE INDEX IF NOT EXISTS prices_daily_symbol_date_desc_idx ON prices_daily (symbol_id, date DESC);

-- Scraping artifacts omitted for MVP. Do extraction in application code.

-- Portfolios, positions, orders, fills ---------------------------------------
CREATE TABLE IF NOT EXISTS portfolios (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           text NOT NULL DEFAULT 'Main',
  base_currency  text NOT NULL DEFAULT 'USD',
  initial_cash   numeric(20,8) NOT NULL DEFAULT 0,
  cash_current   numeric(20,8) NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS portfolios_user_idx ON portfolios (user_id);

CREATE TABLE IF NOT EXISTS positions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id uuid NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  symbol_id    bigint NOT NULL REFERENCES symbols(id) ON DELETE RESTRICT,
  qty          numeric(20,8) NOT NULL CHECK (qty >= 0),
  avg_cost     numeric(20,8) NOT NULL CHECK (avg_cost >= 0),
  opened_at    timestamptz NOT NULL DEFAULT now(),
  closed_at    timestamptz,
  realized_pnl numeric(20,8) NOT NULL DEFAULT 0
);
-- One open position per (portfolio, symbol)
CREATE UNIQUE INDEX IF NOT EXISTS positions_open_unique
  ON positions (portfolio_id, symbol_id) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS positions_portfolio_closed_idx ON positions (portfolio_id, closed_at NULLS FIRST);

CREATE TABLE IF NOT EXISTS orders (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id       uuid NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  symbol_id          bigint NOT NULL REFERENCES symbols(id) ON DELETE RESTRICT,
  side               order_side NOT NULL,
  qty                numeric(20,8) NOT NULL CHECK (qty > 0),
  target_weight      numeric(10,8) CHECK (target_weight >= 0),
  intended_fill_date date NOT NULL,            -- trading day open
  status             order_status NOT NULL DEFAULT 'PENDING',
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orders_unique_intent UNIQUE (portfolio_id, symbol_id, intended_fill_date, side)
);
CREATE INDEX IF NOT EXISTS orders_portfolio_status_idx ON orders (portfolio_id, status);

CREATE TABLE IF NOT EXISTS fills (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  filled_qty  numeric(20,8) NOT NULL CHECK (filled_qty > 0),
  price       numeric(20,8) NOT NULL CHECK (price >= 0),
  fees        numeric(20,8) NOT NULL DEFAULT 0 CHECK (fees >= 0),
  filled_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fills_order_idx ON fills (order_id);

CREATE TABLE IF NOT EXISTS portfolio_values (
  id           bigserial PRIMARY KEY,
  portfolio_id uuid NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  date         date NOT NULL,                      -- trading day
  equity       numeric(20,8) NOT NULL,
  cash         numeric(20,8) NOT NULL,
  pnl_day      numeric(20,8) NOT NULL,
  pnl_total    numeric(20,8) NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portfolio_values_unique_day UNIQUE (portfolio_id, date)
);
CREATE INDEX IF NOT EXISTS portfolio_values_portfolio_date_idx ON portfolio_values (portfolio_id, date DESC);

-- Cron/idempotency/email audit tables omitted for MVP.
```

#### Common queries (building blocks)

Ticker sets and changes
```sql
-- Latest and previous ticker set, with added/removed symbols
WITH latest_two AS (
  SELECT id, symbols, extracted_at,
         row_number() OVER (ORDER BY extracted_at DESC) rn
  FROM ticker_sets
  ORDER BY extracted_at DESC
  LIMIT 2
), curr AS (
  SELECT symbols FROM latest_two WHERE rn = 1
), prev AS (
  SELECT symbols FROM latest_two WHERE rn = 2
), added AS (
  SELECT x::text AS symbol
  FROM curr, LATERAL jsonb_array_elements_text(curr.symbols) AS x
  EXCEPT
  SELECT y::text
  FROM prev, LATERAL jsonb_array_elements_text(prev.symbols) AS y
), removed AS (
  SELECT y::text AS symbol
  FROM prev, LATERAL jsonb_array_elements_text(prev.symbols) AS y
  EXCEPT
  SELECT x::text
  FROM curr, LATERAL jsonb_array_elements_text(curr.symbols) AS x
)
SELECT 'added' AS change, symbol FROM added
UNION ALL
SELECT 'removed' AS change, symbol FROM removed
ORDER BY change, symbol;
```

Symbols and prices
```sql
-- Upsert a symbol (no exchange known)
INSERT INTO symbols (ticker)
VALUES ('AAPL')
ON CONFLICT ON CONSTRAINT symbols_ticker_exchange_key
DO NOTHING
RETURNING id;

-- Upsert a daily price (idempotent for a day)
INSERT INTO prices_daily (symbol_id, date, open, close, volume, source)
VALUES ($1, $2, $3, $4, $5, 'tradingview')
ON CONFLICT (symbol_id, date)
DO UPDATE SET open = EXCLUDED.open,
              close = EXCLUDED.close,
              volume = COALESCE(EXCLUDED.volume, prices_daily.volume),
              adj_close = COALESCE(EXCLUDED.adj_close, prices_daily.adj_close);

-- Latest close price per symbol (for current MV)
SELECT p.symbol_id, p.close, p.date
FROM prices_daily p
JOIN (
  SELECT symbol_id, max(date) AS max_date
  FROM prices_daily
  GROUP BY symbol_id
) m ON p.symbol_id = m.symbol_id AND p.date = m.max_date;
```

Rebalance (MVP, all in application code)
```sql
-- No DB orders/fills; compute targets in code and update positions and cash directly.
```

Daily valuation and dashboard
```sql
-- Compute market value for open positions using latest close
WITH last_close AS (
  SELECT p.symbol_id, p.close, p.date
  FROM prices_daily p
  JOIN (
    SELECT symbol_id, max(date) AS max_date FROM prices_daily GROUP BY symbol_id
  ) m ON p.symbol_id = m.symbol_id AND p.date = m.max_date
)
SELECT pos.portfolio_id, pos.symbol_id, pos.qty, pos.avg_cost,
       lc.close AS last_close,
       (pos.qty * lc.close) AS market_value
FROM positions pos
JOIN last_close lc ON lc.symbol_id = pos.symbol_id
WHERE pos.closed_at IS NULL;

-- Insert daily portfolio value (idempotent per day)
INSERT INTO portfolio_values (portfolio_id, date, equity, cash, pnl_day, pnl_total)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (portfolio_id, date)
DO UPDATE SET equity = EXCLUDED.equity,
              cash = EXCLUDED.cash,
              pnl_day = EXCLUDED.pnl_day,
              pnl_total = EXCLUDED.pnl_total;

-- Portfolio summary (latest row)
SELECT pv.*
FROM portfolio_values pv
WHERE pv.portfolio_id = $1
ORDER BY pv.date DESC
LIMIT 1;

-- Open holdings for UI
SELECT s.ticker, pos.qty, pos.avg_cost,
       lc.close AS last_close,
       (pos.qty * lc.close) AS market_value,
       ((lc.close - pos.avg_cost) / NULLIF(pos.avg_cost,0)) AS return_pct
FROM positions pos
JOIN symbols s ON s.id = pos.symbol_id
JOIN (
  SELECT p.symbol_id, p.close
  FROM prices_daily p
  JOIN (
    SELECT symbol_id, max(date) AS max_date FROM prices_daily GROUP BY symbol_id
  ) m ON p.symbol_id = m.symbol_id AND p.date = m.max_date
) lc ON lc.symbol_id = pos.symbol_id
WHERE pos.portfolio_id = $1 AND pos.closed_at IS NULL
ORDER BY market_value DESC NULLS LAST;
```

Operational helpers
```sql
-- Email log insert after provider call
INSERT INTO email_logs (type, to_email, subject, body, provider_id, status, error)
VALUES ($1::email_type, $2, $3, $4, $5, $6::email_status, $7);
```

Implementation guidance
- Keep monetary arithmetic in the application using decimal-safe libraries; the DB stores high-precision numerics and enforces non-negativity.
- Perform order fills and cash updates inside a single transaction to preserve invariants: cash after fills = previous cash - sum(fills.qty * price + fees) + sum(sell proceeds).
- The partial unique index on `positions` ensures at most one open position per `(portfolio_id, symbol_id)`.
- `cron_runs.run_key` should be deterministic per window (e.g., `YYYY-MM-DD-open/close`) to guarantee idempotency.
- Prices can be backfilled; `ON CONFLICT (symbol_id, date)` makes upserts safe.

-------------------------------------------------------------------------------

### Authentication flow (MVP - Email OTP)

Overview
- Passwordless login with a random 6-digit code (`src/server/auth/login-code.ts`).
- Allowed emails are managed via env.AUTH_ALLOWED_EMAILS.
- Limits come from `src/server/constants.ts`: a code lasts `OTP_TTL_SECONDS`
  (240) and allows `OTP_MAX_ATTEMPTS` (5); an address gets `OTP_MAX_SENDS` (10)
  codes per `OTP_SEND_WINDOW_HOURS` (24). The email says the code is valid for
  `OTP_EMAIL_VALID_MINUTES` (2).
- The code is stored only as HMAC-SHA256(OTP_SECRET, `email:code`) on the
  user's row, and a new code replaces the previous one.
- tRPC batching is off, so each request carries one call.

User journey
1) Enter email on login page.
2) Frontend calls tRPC `authRouter.sendOtp` with `{ email }`.
3) Backend checks `email` against `env.AUTH_ALLOWED_EMAILS`.
   - If not allowed → reject with a message.
4) If allowed → create the user if needed, generate a random code and store its
   hash, expiry and attempt count, within the send limit.
   - Over the limit → 429 "Too many codes requested. Try again later.", and no email.
   - Compose email using react-email template.
   - Send via Resend using `env.RESEND_API_KEY`.
5) tRPC `sendOtp` returns success; UI then displays an input for the OTP and a Continue button.
   - If the call failed, UI surfaces the error.
6) User submits code → frontend calls tRPC `authRouter.verifyOtp` with `{ email, code }`.
7) Backend re-validates allowed email, spends one attempt on the pending code,
   then compares hashes in constant time.
   - If valid: the code is used up, a `sessions` row (DB) is created, and an
     httpOnly, Secure cookie is set.
   - If invalid, expired, used up or out of attempts: "Invalid or expired code".
8) User is considered logged in; protected routes check for a valid session cookie and active DB session.

Database interactions for auth
```sql
-- sendOtp: create the user by email (case-insensitive citext)
INSERT INTO users (email) VALUES ($1) ON CONFLICT (email) DO NOTHING;

-- then store the new code, unless the address has had 10 in the window (no row back)
-- <window over> = otp_send_window_start IS NULL OR otp_send_window_start <= now() - interval '24 hours'
UPDATE users
SET otp_code_hash = $2, otp_code_expires_at = now() + interval '240 seconds', otp_code_attempts = 0,
    otp_send_window_start = CASE WHEN <window over> THEN now() ELSE otp_send_window_start END,
    otp_send_count = CASE WHEN <window over> THEN 1 ELSE otp_send_count + 1 END
WHERE email = $1 AND (<window over> OR otp_send_count < 10)
RETURNING id;

-- verifyOtp: spend an attempt first, then compare, then use the code up
UPDATE users SET otp_code_attempts = otp_code_attempts + 1
WHERE email = $1 AND otp_code_hash IS NOT NULL AND otp_code_expires_at > now()
  AND otp_code_attempts < 5
RETURNING id, otp_code_hash;

-- Create session for user
INSERT INTO sessions (user_id, issued_at, expires_at, user_agent, ip)
VALUES ($1, now(), now() + interval '30 days', $2, $3)
RETURNING id, expires_at;
```

Cookie guidance
- Name: `session` (or similar), `httpOnly`, `Secure` (in production), `sameSite` = Lax/Strict.
- Value: a signed token carrying the DB session id (or a short JWT referencing it). Sign with `env.SESSION_SECRET`.
- On logout: set `revoked_at` for the session row; clear cookie.

Security considerations (MVP)
- Login codes are limited per address (attempts and sends, above); rely on the
  allowed-list and strong secrets otherwise.
- Enforce minimal PII exposure in responses; don’t echo codes.
- Normalize emails to lowercase; `citext` already provides case-insensitivity.

-------------------------------------------------------------------------------

### UI components (shadcn/ui plan)

We will use shadcn/ui to compose accessible, themeable UI primitives on top of Radix and Tailwind. Components will be added gradually (Button, Input, Label, Form, Dialog, Sheet, Table, Tabs, Toast) and organized under `src/components/ui/*` with local ownership (copy-in model).

Why this choice
- **Consistency**: Opinionated tokens and variants drive a cohesive visual language across pages.
- **Accessibility**: Built on Radix primitives with strong a11y defaults baked in.
- **Customizability**: Source lives in-repo; design tokens and variants are fully editable without forking a package.
- **Velocity**: Strong baseline for common patterns (forms, modals, toasts) to ship faster.
- **Theming**: Works cleanly with Tailwind, CSS variables, and dark mode.

Potential drawbacks (and mitigations)
- **Code ownership**: Components are vendored into the repo (not a dependency). This increases code surface area.
  - Mitigation: Keep a small curated set; document local edits; avoid unnecessary drift from upstream patterns.
- **Upgrades not automatic**: No package updates; must manually pull changes if needed.
  - Mitigation: Track shadcn/ui releases only for components we use; copy diffs selectively.
- **Bundle size creep**: Unused components/styles can accumulate.
  - Mitigation: Import only what we need; delete unused components; leverage Next.js tree-shaking.

Initial component set for this project
- **Form primitives**: Button, Input, Label, Textarea, Select, Checkbox, Form (zod-integrated patterns in app code).
- **Feedback**: Toast, Alert/Callout.
- **Overlays**: Dialog, Drawer/Sheet for simple flows.
- **Navigation**: Tabs (for dashboard sections), Breadcrumb (optional), DropdownMenu.
- **Data display**: Table for positions/values, Badge, Skeleton for loading states.

Guidelines
- **Composition-first**: Wrap base shadcn/ui components to encode project-specific variants in `src/components/ui/*` and export named abstractions for feature areas when helpful (e.g., `PortfolioTable`).
- **Accessibility**: Preserve Radix props; avoid removing aria attributes; test keyboard flows in Dialog/Sheet.
- **Styling**: Prefer variant props over ad-hoc class strings; centralize shared tokens (spacing, radius, colors).
- **Forms**: Use zod for validation, server actions or tRPC mutations for submission, and shadcn form patterns for status/field errors.

-------------------------------------------------------------------------------

### Design principles & styles

Core brand color
- The primary and only accent color is green. We use Emerald/Lime hues for emphasis and state (links, buttons, toasts, focus) and never use purple.
- Suggested palette (Tailwind):
  - Accent: emerald-500 (primary), emerald-400 (hover), emerald-600 (active)
  - Sub-accent: lime-400 for subtle highlights

Principles
- Minimal, high-contrast surfaces: dark canvas (neutral-950) with subtle frosted panels; respect prefers-color-scheme.
- Focus clarity: visible focus rings (white on dark), sufficient contrast ratios.
- Motion restraint: tasteful transitions (colors/opacity), avoid large parallax.
- Hierarchy through type and spacing; keep border radii consistent (md–xl).

Component styling rules
- Buttons: primary = white text on emerald-500; hover = emerald-400; destructive uses semantic reds (only if needed).
- Inputs: neutral borders and backgrounds with clear focus ring; placeholder low-contrast.
- Overlays: glassmorphic (blur + low-opacity white) with subtle borders.
- Charts/tables: use green for positive deltas; neutrals otherwise.

Do nots
- Do not introduce purple or unrelated accent colors.
- Avoid noisy gradients; prefer 1–2 stop emerald/lime gradients only.
