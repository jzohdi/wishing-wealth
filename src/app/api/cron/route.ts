import { render } from "@react-email/render";
import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import React from "react";

import { env } from "@/env";
import { sendEmail } from "@/lib/resend";
import { db } from "@/server/db";
import { pricesDaily, symbols } from "@/server/db/schema";
import { scrapeWishingWealthBlog } from "@/server/scrape/tickers";
import { getExchanges } from "@/server/scrape/trading-view";
import { updatePricesForSymbols } from "@/server/stock-market/update-prices";
import { StatusEmail } from "../../../../emails/change-summary";

type TickerChange = {
	ticker: string;
	exchange: string;
	type: "added" | "removed";
};

async function detectTickerChanges({
	scrapedTickers,
}: {
	scrapedTickers: { ticker: string; exchange: string }[];
}): Promise<{
	added: TickerChange[];
	removed: TickerChange[];
}> {
	// Get all symbols currently marked as on page
	const currentOnPage = await db
		.select({
			id: symbols.id,
			ticker: symbols.ticker,
			exchange: symbols.exchange,
		})
		.from(symbols)
		.where(eq(symbols.isOnPage, true));

	const currentSet = new Set(
		currentOnPage.map((s) => `${s.ticker}::${s.exchange}`),
	);
	const scrapedSet = new Set(
		scrapedTickers.map((s) => `${s.ticker}::${s.exchange}`),
	);

	const added: TickerChange[] = [];
	const removed: TickerChange[] = [];

	// Find added tickers (in scraped but not in current)
	for (const scraped of scrapedTickers) {
		const key = `${scraped.ticker}::${scraped.exchange}`;
		if (!currentSet.has(key)) {
			added.push({ ...scraped, type: "added" });
		}
	}

	// Find removed tickers (in current but not in scraped)
	for (const current of currentOnPage) {
		const key = `${current.ticker}::${current.exchange}`;
		if (!scrapedSet.has(key)) {
			removed.push({
				ticker: current.ticker,
				exchange: current.exchange,
				type: "removed",
			});
		}
	}

	return { added, removed };
}

async function updateSymbolsOnPageStatus({
	scrapedTickers,
}: {
	scrapedTickers: { ticker: string; exchange: string }[];
}): Promise<void> {
	const today = new Date().toISOString().split("T")[0];

	// First, mark all symbols as NOT on page
	await db.update(symbols).set({ isOnPage: false });

	// Then, upsert each scraped ticker and mark as on page
	for (const { ticker, exchange } of scrapedTickers) {
		await db
			.insert(symbols)
			.values({
				ticker: ticker.trim().toUpperCase(),
				exchange: exchange.trim().toUpperCase(),
				isOnPage: true,
				firstSeen: today,
				lastSeen: today,
			})
			.onConflictDoUpdate({
				target: [symbols.ticker, symbols.exchange],
				set: {
					isOnPage: true,
					lastSeen: today,
				},
			});
	}
}

export async function GET(req: Request) {
	const authHeader = req.headers.get("authorization");
	if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
		return new Response("Unauthorized", { status: 401 });
	}

	console.log("[cron] Starting scrape flow");

	// 1) Scrape GMI signal and tickers
	const { gmiSignal, gmiSince, tickers } = await scrapeWishingWealthBlog();
	console.log("[cron] Scraped data", {
		gmiSignal,
		gmiSince,
		tickerCount: tickers.length,
	});

	// 2) Resolve exchanges for tickers
	console.log("[cron] Resolving exchanges for tickers");
	const withExchanges = await getExchanges(tickers);
	console.log("[cron] Exchanges resolved", { count: withExchanges.length });

	// 3) Detect ticker changes before updating the database
	const { added, removed } = await detectTickerChanges({
		scrapedTickers: withExchanges,
	});
	console.log("[cron] Ticker changes detected", {
		added: added.length,
		removed: removed.length,
	});

	// 4) Update symbols on-page status
	await updateSymbolsOnPageStatus({ scrapedTickers: withExchanges });
	console.log("[cron] Symbols on-page status updated");

	// 5) Update prices for tickers currently on page
	console.log("[cron] Updating prices for on-page tickers");
	const priceResults = await updatePricesForSymbols(withExchanges);
	console.log("[cron] Prices updated", { count: priceResults.length });

	// 6) Get current tickers on page with their latest prices for email
	const tickersOnPage = await db
		.select({
			ticker: symbols.ticker,
			exchange: symbols.exchange,
		})
		.from(symbols)
		.where(eq(symbols.isOnPage, true));

	// Get latest prices for each ticker
	const tickerPrices: Array<{
		ticker: string;
		exchange: string;
		price: number | null;
	}> = [];

	for (const t of tickersOnPage) {
		const symbolRow = await db
			.select({ id: symbols.id })
			.from(symbols)
			.where(eq(symbols.ticker, t.ticker))
			.limit(1);

		if (symbolRow[0]) {
			const priceRow = await db
				.select({ close: pricesDaily.close })
				.from(pricesDaily)
				.where(eq(pricesDaily.symbolId, symbolRow[0].id))
				.orderBy(sql`${pricesDaily.date} DESC`)
				.limit(1);

			tickerPrices.push({
				ticker: t.ticker,
				exchange: t.exchange,
				price: priceRow[0]?.close ? Number(priceRow[0].close) : null,
			});
		}
	}

	// 7) Send status email
	try {
		const runAt = new Date().toISOString();
		const hasChanges = added.length > 0 || removed.length > 0;
		const subject = `GMI: ${gmiSignal ?? "UNKNOWN"}${hasChanges ? ` | ${added.length} added, ${removed.length} removed` : ""}`;

		const html = await render(
			React.createElement(StatusEmail, {
				gmiSignal,
				gmiSince,
				tickersAdded: added,
				tickersRemoved: removed,
				currentTickers: tickerPrices,
				runAt,
			}),
		);

		await sendEmail({ to: env.ALERT_EMAIL, subject, html });
		console.log("[cron] Status email sent");
	} catch (err) {
		console.warn("[cron] Failed to send status email", { err });
	}

	return NextResponse.json({
		ok: true,
		gmiSignal,
		gmiSince,
		tickerCount: tickers.length,
		added: added.length,
		removed: removed.length,
	});
}
