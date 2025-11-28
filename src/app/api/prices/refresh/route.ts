import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { symbols, users } from "@/server/db/schema";
import { updatePricesForSymbols } from "@/server/stock-market/update-prices";

export async function POST() {
	try {
		const user = await getCurrentUser();
		if (!user) {
			return new NextResponse("Unauthorized", { status: 401 });
		}

		const u = await db
			.select({ id: users.id })
			.from(users)
			.where(eq(users.email, user.email))
			.limit(1);
		const userId = u[0]?.id;
		if (!userId) {
			return NextResponse.json(
				{ ok: false, error: "No user" },
				{ status: 400 },
			);
		}

		// Refresh prices for all tickers currently on the page
		const tickersOnPage = await db
			.select({
				ticker: symbols.ticker,
				exchange: symbols.exchange,
			})
			.from(symbols)
			.where(eq(symbols.isOnPage, true));

		const results = await updatePricesForSymbols(tickersOnPage);

		return NextResponse.json({ ok: true, updated: results.length });
	} catch (err) {
		console.error("[prices.refresh] Error", { err });

		return new NextResponse("Internal Server Error", { status: 500 });
	}
}
