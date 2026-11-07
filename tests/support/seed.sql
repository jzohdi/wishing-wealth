-- Smoke-test seed: synthetic data only, never production data. tests/support/local.ts applies it after the migration.
-- 5 on-page symbols (4 with 2-3 days of prices, ZZZT with none) and 3 historical ones. No users or sessions.
-- AAPL's newest price date (2025-11-04) is older than MSFT's (2025-11-05): the "Last Update" KPI shows the
-- alphabetically first ticker's date, so it should read 2025-11-04.
INSERT INTO wishing_wealth_symbols (ticker, exchange, "isOnPage", "firstSeen", "lastSeen") VALUES
  ('AAPL',  'NASDAQ', true,  '2025-10-20', '2025-11-05'),
  ('BRK.B', 'NYSE',   true,  '2025-10-27', '2025-11-05'),
  ('MSFT',  'NASDAQ', true,  '2025-10-13', '2025-11-05'),
  ('NVDA',  'NASDAQ', true,  '2025-11-03', '2025-11-05'),
  ('ZZZT',  'NYSE',   true,  '2025-11-05', '2025-11-05'),
  ('OLDA',  'NYSE',   false, '2025-09-01', '2025-10-15'),
  ('OLDB',  'NASDAQ', false, '2025-08-01', '2025-10-30'),
  ('OLDC',  'AMEX',   false, '2025-07-01', '2025-09-20');

INSERT INTO wishing_wealth_prices_daily ("symbolId", date, close, source)
SELECT s.id, v.d::date, v.c::numeric, 'seed'
FROM (VALUES
  ('AAPL',  '2025-11-03', '225.10'),
  ('AAPL',  '2025-11-04', '227.40'),
  ('BRK.B', '2025-11-04', '1230.00'),
  ('BRK.B', '2025-11-05', '1234.50'),
  ('MSFT',  '2025-11-03', '410.00'),
  ('MSFT',  '2025-11-04', '412.30'),
  ('MSFT',  '2025-11-05', '415.75'),
  ('NVDA',  '2025-11-04', '198.12'),
  ('NVDA',  '2025-11-05', '201.00'),
  ('OLDA',  '2025-10-15', '55.55')
) AS v(t, d, c)
JOIN wishing_wealth_symbols s ON s.ticker = v.t;
