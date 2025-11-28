import { db } from "@/server/db";
import { pricesDaily, symbols } from "@/server/db/schema";
import { getPrice } from "@/server/scrape/trading-view";
import { eq } from "drizzle-orm";

export type TickerInput = { ticker: string; exchange: string };

function toEtDateString(d: Date): string {
	// Get America/New_York calendar date (YYYY-MM-DD)
	const fmt = new Intl.DateTimeFormat("en-CA", {
		timeZone: "America/New_York",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	});
	// en-CA outputs YYYY-MM-DD
	return fmt.format(d);
}

type TickerPrice = {
	ticker: string;
	exchange: string;
	symbolId: bigint;
	price: number;
	date: string;
};

async function ensureSymbolsExist(inputs: TickerInput[]) {
	if (inputs.length === 0) {
		return { normalized: [], symbolIdCache: new Map<string, bigint>() };
	}
	const normalized = inputs.map(({ ticker, exchange }) => ({
		ticker: ticker.trim().toUpperCase(),
		exchange: exchange.trim().toUpperCase(),
	}));

	// Ensure all exist in DB (optional, since schema requires exchange)
	for (const { ticker, exchange } of normalized) {
		await db
			.insert(symbols)
			.values({ ticker, exchange })
			.onConflictDoNothing({
				target: [symbols.ticker, symbols.exchange],
			});
	}

	// Batch resolve ids, then filter client-side to avoid complex IN over two columns
	const ids = new Map<string, bigint>();
	const rows = await db
		.select({
			id: symbols.id,
			ticker: symbols.ticker,
			exchange: symbols.exchange,
		})
		.from(symbols);
	for (const r of rows) {
		const key = `${r.ticker}::${r.exchange}`;
		ids.set(key, r.id);
	}
	const symbolIdCache = new Map<string, bigint>();
	for (const { ticker, exchange } of normalized) {
		const key = `${ticker}::${exchange}`;
		const id = ids.get(key);
		if (!id) {
			throw new Error(`Symbol not found after ensure: ${ticker} ${exchange}`);
		}
		symbolIdCache.set(key, id);
	}
	return { normalized, symbolIdCache };
}

export async function updatePricesForSymbols(inputs: TickerInput[]) {
	const results: Array<TickerPrice> = [];
	if (inputs.length === 0) {
		return results;
	}
	const { normalized, symbolIdCache } = await ensureSymbolsExist(inputs);

	const date = toEtDateString(new Date());

	// Fetch prices and upsert into prices_daily
	for (const { ticker, exchange } of normalized) {
		try {
			const price = await getPrice({ ticker, exchange });
			const symbolId = symbolIdCache.get(`${ticker}::${exchange}`)!;

			await db
				.insert(pricesDaily)
				.values({
					symbolId,
					date,
					close: String(price),
					source: "scraper",
				})
				.onConflictDoUpdate({
					target: [pricesDaily.symbolId, pricesDaily.date],
					set: {
						close: String(price),
						source: "scraper",
					},
				});

			results.push({ ticker, exchange, symbolId, price, date });
		} catch (err) {
			console.warn(`Price update failed for ${ticker} ${exchange}`, err);
			continue;
		}
	}

	return results;
}
