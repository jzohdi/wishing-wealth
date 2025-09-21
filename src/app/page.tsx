import Link from "next/link";
import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db";
import {
  users,
  portfolios,
  positions,
  symbols,
  pricesDaily,
  portfolioValues,
} from "@/server/db/schema";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";

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
    return {
      id: p.id,
      ticker: String(p.ticker).toUpperCase(),
      qty,
      avg,
      price,
      mv,
      pnl,
      pnlPct,
    };
  });

  // Equity series from portfolio_values; fallback to single-point current equity
  const values = portfolioId
    ? await db
        .select({ date: portfolioValues.date, equity: portfolioValues.equity })
        .from(portfolioValues)
        .where(eq(portfolioValues.portfolioId, portfolioId))
        .orderBy(portfolioValues.date)
    : [];
  let equitySeries: { date: string; equity: number }[] = values
    .filter((v) => v.date && v.equity != null)
    .map((v) => ({
      date: String(v.date),
      equity: Number(v.equity),
    }));
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

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          <section className="lg:col-span-2 rounded-xl border border-white/10 bg-white/5 p-4 shadow-sm">
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
                    </tr>
                  ))}
                  {positionsView.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
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

          <section className="rounded-xl border border-white/10 bg-white/5 p-4 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold text-emerald-400">
              Equity over time
            </h2>
            <EquityChart series={equitySeries} />
            <div className="mt-3 text-xs text-white/60">
              <span>Points: {equitySeries.length}</span>
            </div>
          </section>
        </div>
      </div>
    </main>
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

function EquityChart({
  series,
}: {
  series: { date: string; equity: number }[];
}) {
  const width = 520;
  const height = 160;
  const pad = 12;
  const xs = series.map((_, i) => i);
  const ys = series.map((p) => p.equity);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanY = Math.max(1, maxY - minY);
  const maxX = Math.max(1, xs.length - 1);
  const points = xs
    .map((x, i) => {
      const yVal = ys[i] ?? minY;
      const nx = (x / maxX) * (width - pad * 2) + pad;
      const ny = height - ((yVal - minY) / spanY) * (height - pad * 2) - pad;
      return `${nx},${ny}`;
    })
    .join(" ");

  const last = ys[ys.length - 1] ?? 0;
  const first = ys[0] ?? 0;
  const delta = last - first;
  const deltaPct = first !== 0 ? (delta / first) * 100 : 0;

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="160">
        <defs>
          <linearGradient id="grad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
          </linearGradient>
        </defs>
        {series.length > 1 && (
          <>
            <polyline
              fill="none"
              stroke="#10b981"
              strokeWidth="2"
              points={points}
            />
            <polygon
              points={`${pad},${height - pad} ${points} ${width - pad},${height - pad}`}
              fill="url(#grad)"
              opacity="0.6"
            />
          </>
        )}
      </svg>
      <div className="mt-2 text-sm">
        <span className={delta >= 0 ? "text-emerald-400" : "text-red-400"}>
          {formatCurrency(delta)} ({deltaPct.toFixed(2)}%)
        </span>
        <span className="ml-2 text-white/60">
          from {series[0]?.date ?? "-"} to{" "}
          {series[series.length - 1]?.date ?? "-"}
        </span>
      </div>
    </div>
  );
}
