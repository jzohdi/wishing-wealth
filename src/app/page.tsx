import Link from "next/link";
import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db";
import {
  users,
  portfolios,
  positions,
  symbols,
  pricesDaily,
} from "@/server/db/schema";
import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import constants from "@/server/constants";
import { EquityLineChart } from "@/components/ui/equity-line-chart";
import { RefreshPricesButton } from "@/components/ui/refresh-prices-button";

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-neutral-950 text-white">
        <div className="container flex flex-col items-center justify-center gap-6 px-4 py-16">
          <h1 className="font-extrabold text-5xl tracking-tight sm:text-[5rem]">
            Wishing Wealth Tracker
          </h1>
          <p className="text-white/80">Equal-weight portfolio tracker</p>
          <Link
            className="rounded bg-white/10 px-4 py-2 hover:bg-white/20"
            href="/login"
          >
            Login
          </Link>
        </div>
      </main>
    );
  }

  // Resolve userId
  const userRow = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, user.email))
    .limit(1);
  const userId = userRow[0]?.id;
  if (!userId) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-neutral-950 text-white">
        <div className="container flex flex-col items-center justify-center gap-6 px-4 py-16">
          <h1 className="font-extrabold text-5xl tracking-tight sm:text-[5rem]">
            Wishing Wealth Tracker
          </h1>
          <p className="text-white/80">No account found for {user.email}</p>
        </div>
      </main>
    );
  }

  // Get default portfolio for user
  const pf = await db
    .select({ id: portfolios.id, cash: portfolios.cashCurrent })
    .from(portfolios)
    .where(eq(portfolios.userId, userId))
    .limit(1);
  const portfolioId = pf[0]?.id;
  const cashCurrent = Number(pf[0]?.cash ?? 0);

  // Load open positions with symbols
  const open = portfolioId
    ? await db
        .select({
          id: positions.id,
          symbolId: positions.symbolId,
          qty: positions.qty,
          avgCost: positions.avgCost,
          ticker: symbols.ticker,
        })
        .from(positions)
        .innerJoin(symbols, eq(positions.symbolId, symbols.id))
        .where(
          and(
            eq(positions.portfolioId, portfolioId),
            isNull(positions.closedAt)
          )
        )
    : [];

  const symbolIds = open.map((p) => p.symbolId);
  let latestClose: Record<string, number> = {};
  if (symbolIds.length > 0) {
    const rows = await db
      .select({
        symbolId: pricesDaily.symbolId,
        date: pricesDaily.date,
        close: pricesDaily.close,
      })
      .from(pricesDaily)
      .where(inArray(pricesDaily.symbolId, symbolIds))
      .orderBy(pricesDaily.symbolId, desc(pricesDaily.date));
    const map: Record<string, number> = {};
    for (const r of rows) {
      const k = String(r.symbolId);
      if (map[k] !== undefined) continue;
      if (r.close == null) continue;
      map[k] = Number(r.close);
    }
    latestClose = map;
  }

  const positionsView = open.map((p) => {
    const qty = Number(p.qty);
    const avg = Number(p.avgCost);
    const last = latestClose[String(p.symbolId)];
    const price: number = Number.isFinite(last as number)
      ? (last as number)
      : avg;
    const mv = qty * price;
    const cost = qty * avg;
    const pnl = mv - cost;
    const pnlPct = cost !== 0 ? (pnl / cost) * 100 : 0;
    const stopTriggered = price + 1e-9 < avg * constants.STOP_LOSS_MULTIPLIER;
    return {
      id: p.id,
      ticker: String(p.ticker).toUpperCase(),
      qty,
      avg,
      price,
      mv,
      pnl,
      pnlPct,
      stopTriggered,
    };
  });

  // Build equity series (one point per day). If no stored history, synthesize today from current state.
  const values = portfolioId
    ? await db
        .select({ date: pricesDaily.date })
        .from(pricesDaily)
        .where(inArray(pricesDaily.symbolId, symbolIds))
        .orderBy(pricesDaily.date)
    : [];

  // Use portfolioValues if present in the future; for now aggregate by day from latest closes available per day.
  // Fallback to single-point current equity for today.
  const byDate = new Map<string, number>();
  if (symbolIds.length > 0) {
    // Pull daily closes for these symbols and aggregate to an equity estimate: cash + sum(qty * close)
    const priceRows = await db
      .select({
        symbolId: pricesDaily.symbolId,
        date: pricesDaily.date,
        close: pricesDaily.close,
      })
      .from(pricesDaily)
      .where(inArray(pricesDaily.symbolId, symbolIds))
      .orderBy(pricesDaily.date);
    const qtyBySymbol = new Map<string, number>(
      open.map((p) => [String(p.symbolId), Number(p.qty)])
    );
    for (const r of priceRows) {
      if (r.close == null) continue;
      const day = String(r.date);
      const qty = qtyBySymbol.get(String(r.symbolId)) ?? 0;
      const add = qty * Number(r.close);
      byDate.set(day, (byDate.get(day) ?? 0) + add);
    }
  }

  let equitySeries: { date: string; equity: number }[] = Array.from(
    byDate.entries()
  )
    .map(([date, mv]) => ({ date, equity: cashCurrent + mv }))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (equitySeries.length === 0) {
    const mv = positionsView.reduce((s, r) => s + r.mv, 0);
    equitySeries = [
      { date: new Date().toISOString().slice(0, 10), equity: cashCurrent + mv },
    ];
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-white">
      <div className="container mx-auto max-w-6xl px-4 py-10">
        <div className="mb-8">
          <h1 className="font-extrabold text-4xl tracking-tight">
            Wishing Wealth Tracker
          </h1>
          <p className="text-sm text-emerald-400">Logged in as {user.email}</p>
        </div>

        {/* KPIs */}
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(() => {
            const equityNow =
              positionsView.reduce((s, r) => s + r.mv, 0) + cashCurrent;
            const gainers = positionsView.filter((r) => r.pnl >= 0).length;
            const losers = positionsView.filter((r) => r.pnl < 0).length;
            const stops = positionsView.filter((r) => r.stopTriggered).length;
            return (
              <>
                <KpiCard label="Equity" value={formatCurrency(equityNow)} />
                <KpiCard label="Cash" value={formatCurrency(cashCurrent)} />
                <KpiCard label="Gainers" value={`${gainers}`} />
                <KpiCard
                  label="Stops flagged"
                  value={`${stops}`}
                  tone={stops > 0 ? "warn" : "ok"}
                />
              </>
            );
          })()}
        </div>

        {/* Equity line chart */}
        <div className="mb-8">
          <div className="mb-3 flex items-center justify-between">
            <div />
            <RefreshPricesButton />
          </div>
          <EquityLineChart data={equitySeries} />
        </div>

        <div className="grid grid-cols-1 gap-8">
          <section className="rounded-xl border border-white/10 bg-white/5 p-4 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold text-emerald-400">
              Open positions
            </h2>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-white/70">
                  <tr>
                    <th className="px-2 py-2 text-left">Ticker</th>
                    <th className="px-2 py-2 text-right">Qty</th>
                    <th className="px-2 py-2 text-right">Avg Cost</th>
                    <th className="px-2 py-2 text-right">Last</th>
                    <th className="px-2 py-2 text-right">Market Value</th>
                    <th className="px-2 py-2 text-right">Unrealized PnL</th>
                    <th className="px-2 py-2 text-right">Stop</th>
                  </tr>
                </thead>
                <tbody>
                  {positionsView.map((r) => (
                    <tr key={r.id} className="border-t border-white/10">
                      <td className="px-2 py-2 font-semibold">{r.ticker}</td>
                      <td className="px-2 py-2 text-right">
                        {formatNumber(r.qty, 4)}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {formatCurrency(r.avg)}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {formatCurrency(r.price)}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {formatCurrency(r.mv)}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <span
                          className={
                            r.pnl >= 0 ? "text-emerald-400" : "text-red-400"
                          }
                        >
                          {formatCurrency(r.pnl)} ({r.pnlPct.toFixed(2)}%)
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right">
                        {r.stopTriggered ? (
                          <span className="rounded bg-red-500/10 px-2 py-0.5 text-xs text-red-300">
                            below{" "}
                            {Math.round(constants.STOP_LOSS_MULTIPLIER * 100)}%
                          </span>
                        ) : (
                          <span className="text-white/40">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {positionsView.length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-2 py-6 text-center text-white/60"
                      >
                        No open positions
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        {/* Blocked tickers (cooldown) */}
        <BlockedTickers userEmail={user.email} />
      </div>
    </main>
  );
}

function KpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn";
}) {
  const color = tone === "warn" ? "text-red-300" : "text-emerald-300";
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 shadow-sm">
      <div className="text-xs uppercase tracking-wide text-white/60">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}

async function BlockedTickers({ userEmail }: { userEmail: string }) {
  // Determine user's portfolio
  const userRow = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, userEmail))
    .limit(1);
  const userId = userRow[0]?.id;
  if (!userId) return null;
  const pf = await db
    .select({ id: portfolios.id })
    .from(portfolios)
    .where(eq(portfolios.userId, userId))
    .limit(1);
  const portfolioId = pf[0]?.id;
  if (!portfolioId) return null;

  // Recently closed losers within cooldown
  const now = new Date();
  const cutoff = new Date(now.getTime());
  cutoff.setUTCDate(cutoff.getUTCDate() - constants.REENTRY_COOLDOWN_DAYS);
  const recentClosed = await db
    .select({
      symbolId: positions.symbolId,
      closedAt: positions.closedAt,
      realizedPnl: positions.realizedPnl,
      ticker: symbols.ticker,
    })
    .from(positions)
    .innerJoin(symbols, eq(positions.symbolId, symbols.id))
    .where(
      and(
        eq(positions.portfolioId, portfolioId),
        // closed after cutoff
        gte(positions.closedAt, cutoff),
        lt(positions.realizedPnl, sql`0`)
      )
    )
    .orderBy(desc(positions.closedAt));

  if (recentClosed.length === 0) return null;

  // Unique by symbol
  const seen = new Set<string>();
  const items = recentClosed.filter((r) => {
    const k = String(r.symbolId);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return (
    <section className="mt-8 rounded-xl border border-white/10 bg-white/5 p-4 shadow-sm">
      <h2 className="mb-3 text-lg font-semibold text-emerald-400">
        Blocked tickers (cooldown)
      </h2>
      <div className="text-sm text-white/70">
        <div className="mb-2 text-white/60">
          Preventing re-entry for {constants.REENTRY_COOLDOWN_DAYS} days after a
          loss
        </div>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((r) => (
            <li
              key={String(r.symbolId)}
              className="flex items-center justify-between rounded-md border border-white/10 bg-white/5 px-3 py-2"
            >
              <span className="font-semibold">
                {String(r.ticker).toUpperCase()}
              </span>
              <span className="text-xs text-white/60">
                closed {String(r.closedAt)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);
}

function formatNumber(n: number, digits = 2) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

// Equity chart removed
