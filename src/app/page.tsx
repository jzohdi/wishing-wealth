import { desc, eq, sql } from "drizzle-orm";
import Link from "next/link";

import { RefreshPricesButton } from "@/components/ui/refresh-prices-button";
import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { pricesDaily, symbols } from "@/server/db/schema";

export default async function Home() {
	const user = await getCurrentUser();
	if (!user) {
		return (
			<main className="flex min-h-screen flex-col items-center justify-center bg-neutral-950 text-white">
				<div className="container flex flex-col items-center justify-center gap-6 px-4 py-16">
					<h1 className="font-extrabold text-5xl tracking-tight sm:text-[5rem]">
						Wishing Wealth Tracker
					</h1>
					<p className="text-white/80">GMI Signal & Ticker Tracker</p>
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

	// Get all tickers currently on the page
	const tickersOnPage = await db
		.select({
			id: symbols.id,
			ticker: symbols.ticker,
			exchange: symbols.exchange,
			firstSeen: symbols.firstSeen,
			lastSeen: symbols.lastSeen,
		})
		.from(symbols)
		.where(eq(symbols.isOnPage, true))
		.orderBy(symbols.ticker);

	// Get latest prices for each ticker
	const tickerData: Array<{
		id: bigint;
		ticker: string;
		exchange: string;
		firstSeen: string | null;
		lastSeen: string | null;
		price: number | null;
		priceDate: string | null;
	}> = [];

	for (const t of tickersOnPage) {
		const priceRow = await db
			.select({
				close: pricesDaily.close,
				date: pricesDaily.date,
			})
			.from(pricesDaily)
			.where(eq(pricesDaily.symbolId, t.id))
			.orderBy(desc(pricesDaily.date))
			.limit(1);

		tickerData.push({
			...t,
			price: priceRow[0]?.close ? Number(priceRow[0].close) : null,
			priceDate: priceRow[0]?.date ?? null,
		});
	}

	// Get count of all historical tickers (not currently on page)
	const historicalCount = await db
		.select({ count: sql<number>`count(*)` })
		.from(symbols)
		.where(eq(symbols.isOnPage, false));

	return (
		<main className="min-h-screen bg-neutral-950 text-white">
			<div className="container mx-auto max-w-6xl px-4 py-10">
				<div className="mb-8">
					<h1 className="font-extrabold text-4xl tracking-tight">
						Wishing Wealth Tracker
					</h1>
					<p className="text-emerald-400 text-sm">Logged in as {user.email}</p>
				</div>

				{/* KPIs */}
				<div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
					<KpiCard
						label="Tickers On Page"
						value={String(tickersOnPage.length)}
					/>
					<KpiCard
						label="Historical Tickers"
						value={String(historicalCount[0]?.count ?? 0)}
					/>
					<KpiCard
						label="Last Update"
						value={tickerData[0]?.priceDate ?? "Never"}
					/>
				</div>

				{/* Actions */}
				<div className="mb-8 flex items-center justify-end">
					<RefreshPricesButton />
				</div>

				{/* Current Tickers Table */}
				<section className="rounded-xl border border-white/10 bg-white/5 p-4 shadow-sm">
					<h2 className="mb-3 font-semibold text-emerald-400 text-lg">
						Current Tickers on wishingwealthblog.com
					</h2>
					<div className="overflow-x-auto">
						<table className="min-w-full text-sm">
							<thead className="text-white/70">
								<tr>
									<th className="px-2 py-2 text-left">Ticker</th>
									<th className="px-2 py-2 text-left">Exchange</th>
									<th className="px-2 py-2 text-right">Price</th>
									<th className="px-2 py-2 text-right">First Seen</th>
									<th className="px-2 py-2 text-right">Last Updated</th>
								</tr>
							</thead>
							<tbody>
								{tickerData.map((t) => (
									<tr key={String(t.id)} className="border-white/10 border-t">
										<td className="px-2 py-2 font-semibold">{t.ticker}</td>
										<td className="px-2 py-2 text-white/70">{t.exchange}</td>
										<td className="px-2 py-2 text-right">
											{t.price != null ? formatCurrency(t.price) : "—"}
										</td>
										<td className="px-2 py-2 text-right text-white/60">
											{t.firstSeen ?? "—"}
										</td>
										<td className="px-2 py-2 text-right text-white/60">
											{t.priceDate ?? "—"}
										</td>
									</tr>
								))}
								{tickerData.length === 0 && (
									<tr>
										<td
											colSpan={5}
											className="px-2 py-6 text-center text-white/60"
										>
											No tickers currently on the page. Run the cron job to
											populate.
										</td>
									</tr>
								)}
							</tbody>
						</table>
					</div>
				</section>

				{/* Historical Tickers Section */}
				<HistoricalTickers />
			</div>
		</main>
	);
}

function KpiCard({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-xl border border-white/10 bg-white/5 p-4 shadow-sm">
			<div className="text-white/60 text-xs uppercase tracking-wide">
				{label}
			</div>
			<div className="mt-1 font-semibold text-2xl text-emerald-300">
				{value}
			</div>
		</div>
	);
}

async function HistoricalTickers() {
	// Get tickers that are no longer on the page
	const historical = await db
		.select({
			id: symbols.id,
			ticker: symbols.ticker,
			exchange: symbols.exchange,
			firstSeen: symbols.firstSeen,
			lastSeen: symbols.lastSeen,
		})
		.from(symbols)
		.where(eq(symbols.isOnPage, false))
		.orderBy(desc(symbols.lastSeen))
		.limit(20);

	if (historical.length === 0) {
		return null;
	}

	return (
		<section className="mt-8 rounded-xl border border-white/10 bg-white/5 p-4 shadow-sm">
			<h2 className="mb-3 font-semibold text-emerald-400 text-lg">
				Historical Tickers (No Longer on Page)
			</h2>
			<div className="overflow-x-auto">
				<table className="min-w-full text-sm">
					<thead className="text-white/70">
						<tr>
							<th className="px-2 py-2 text-left">Ticker</th>
							<th className="px-2 py-2 text-left">Exchange</th>
							<th className="px-2 py-2 text-right">First Seen</th>
							<th className="px-2 py-2 text-right">Last Seen</th>
						</tr>
					</thead>
					<tbody>
						{historical.map((t) => (
							<tr key={String(t.id)} className="border-white/10 border-t">
								<td className="px-2 py-2 font-semibold text-white/70">
									{t.ticker}
								</td>
								<td className="px-2 py-2 text-white/50">{t.exchange}</td>
								<td className="px-2 py-2 text-right text-white/50">
									{t.firstSeen ?? "—"}
								</td>
								<td className="px-2 py-2 text-right text-white/50">
									{t.lastSeen ?? "—"}
								</td>
							</tr>
						))}
					</tbody>
				</table>
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
