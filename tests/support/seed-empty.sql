-- The "empty" variant of the smoke-test seed, applied on top of seed.sql mid-run (users and sessions are kept).
-- No on-page symbols; 22 historical ones with distinct lastSeen dates inserted out of order, so the dashboard
-- must show the empty-state row, Historical Tickers = 22 and exactly 20 historical rows, newest lastSeen first.
DELETE FROM wishing_wealth_symbols;  -- prices_daily rows go with it (ON DELETE CASCADE)
INSERT INTO wishing_wealth_symbols (ticker, exchange, "isOnPage", "firstSeen", "lastSeen")
SELECT 'HIST' || lpad(n::text, 2, '0'), CASE WHEN n % 2 = 0 THEN 'NYSE' ELSE 'NASDAQ' END, false,
       date '2025-06-01' + n, date '2025-09-01' + ((n * 7) % 22)
FROM generate_series(1, 22) AS n;
