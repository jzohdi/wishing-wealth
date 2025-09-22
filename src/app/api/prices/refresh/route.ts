import { NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { portfolios, positions, symbols, users } from "@/server/db/schema";
import { and, eq, isNull } from "drizzle-orm";
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
            return NextResponse.json({ ok: false, error: "No user" }, {
                status: 400,
            });
        }

        const pf = await db
            .select({ id: portfolios.id })
            .from(portfolios)
            .where(eq(portfolios.userId, userId))
            .limit(1);
        const portfolioId = pf[0]?.id;
        if (!portfolioId) {
            return NextResponse.json({ ok: false, error: "No portfolio" }, {
                status: 400,
            });
        }

        // Load open positions and associated tickers/exchanges
        const open = await db
            .select({
                ticker: symbols.ticker,
                exchange: symbols.exchange,
            })
            .from(positions)
            .innerJoin(symbols, eq(positions.symbolId, symbols.id))
            .where(
                and(
                    eq(positions.portfolioId, portfolioId),
                    isNull(positions.closedAt),
                ),
            );

        const dedup = open.filter((t, i, self) =>
            self.findIndex((x) =>
                x.ticker === t.ticker && x.exchange === t.exchange
            ) === i
        );

        const results = await updatePricesForSymbols(dedup);

        return NextResponse.json({ ok: true, updated: results.length });
    } catch (err) {
        console.error("[prices.refresh] Error", { err });
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}
