import { NextResponse } from "next/server";

import { env } from "@/env";
import { fetchTickersFromSource } from "@/server/scrape/tickers";
import { db } from "@/server/db";
import {
    portfolios,
    positions,
    pricesDaily,
    symbols,
    users,
} from "@/server/db/schema";
import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { makePlan } from "@/server/portfolio/make-plan";
import { getExchanges } from "@/server/scrape/trading-view";
import { updatePricesForSymbols } from "@/server/stock-market/update-prices";
import { executePlan } from "@/server/portfolio/execute-plan";
import React from "react";
import { render } from "@react-email/render";
import { sendEmail } from "@/lib/resend";
import { ChangeSummaryEmail } from "../../../../emails/change-summary";
import constants from "@/server/constants";

async function ensureSymbols(
    tickers: { ticker: string; exchange: string; url: string }[],
) {
    if (tickers.length === 0) return;
    // Upsert by (ticker, exchange="")
    await Promise.all(
        tickers.map(async ({ ticker, exchange }) => {
            try {
                await db
                    .insert(symbols)
                    .values({ ticker, exchange })
                    .onConflictDoNothing({
                        target: [symbols.ticker, symbols.exchange],
                    });
            } catch {}
        }),
    );
}

async function ensureDefaultPortfolio(): Promise<{ portfolioId: string }> {
    const existing = await db.select({ id: portfolios.id }).from(portfolios)
        .limit(1);
    if (existing[0]) return { portfolioId: existing[0].id };

    // Ensure a user exists
    const insertedUser = await db
        .insert(users)
        .values({ email: env.ALERT_EMAIL })
        .onConflictDoNothing({ target: users.email })
        .returning({ id: users.id });
    let userId = insertedUser[0]?.id;
    if (!userId) {
        const u = await db.select({ id: users.id }).from(users).where(
            eq(users.email, env.ALERT_EMAIL),
        ).limit(1);
        userId = u[0]!.id;
    }

    const created = await db
        .insert(portfolios)
        .values({
            userId,
            name: "Main",
            baseCurrency: "USD",
            initialCash: String(constants.STARTING_CASH),
            cashCurrent: String(constants.STARTING_CASH),
        })
        .returning({ id: portfolios.id });
    return { portfolioId: created[0]!.id };
}

async function getLatestCloseMap(
    symbolIds: bigint[],
): Promise<Record<string, number>> {
    if (symbolIds.length === 0) return {};
    // For each symbol_id, pick the latest date row
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
        const key = String(r.symbolId);
        if (map[key] !== undefined) continue;
        if (r.close == null) continue;
        map[key] = Number(r.close);
    }
    return map;
}

function sum(values: number[]) {
    let s = 0;
    for (const v of values) s += v;
    return s;
}

async function updateAllPrices(
    portfolioId: string,
    tickersOnPage: { ticker: string; exchange: string }[],
) {
    const openPos = await db
        .select({
            id: positions.id,
            symbolId: positions.symbolId,
            qty: positions.qty,
            avgCost: positions.avgCost,
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
    // update all open positions and all new tickers
    const allTickers = openPos.map((p) => ({
        ticker: p.ticker,
        exchange: p.exchange,
    })).concat(tickersOnPage);

    const deduped = allTickers.filter((t, i, self) =>
        self.findIndex((t2) =>
            t2.ticker === t.ticker && t2.exchange === t.exchange
        ) === i
    );
    await updatePricesForSymbols(deduped);
    return openPos;
}

export async function GET(req: Request) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return new Response("Unauthorized", {
            status: 401,
        });
    }

    // 1) Scrape tickers
    console.log("[cron] Starting scrape flow");
    const tickers = await fetchTickersFromSource();
    console.log("[cron] Tickers scraped", { count: tickers.length });

    console.log("[cron] Resolving exchanges for tickers");
    const withExchanges = await getExchanges(tickers);
    console.log("[cron] Exchanges resolved", { count: withExchanges.length });

    // ensure that we know about the ticker symbols in the database, still unsure if we need this.
    console.log("[cron] Ensuring symbols in DB");
    await ensureSymbols(withExchanges);
    console.log("[cron] Symbols ensured");

    // Batch resolve symbol rows in one query, filter client-side
    const allRows = await db
        .select({
            id: symbols.id,
            ticker: symbols.ticker,
            exchange: symbols.exchange,
        })
        .from(symbols);
    const wanted = new Set(
        withExchanges.map((x) => `${x.ticker}::${x.exchange}`),
    );
    const symbolRows = allRows
        .filter((r) => wanted.has(`${r.ticker}::${r.exchange}`))
        .map((r) => ({ id: r.id, ticker: r.ticker }));

    // 2) Ensure portfolio
    console.log("[cron] Ensuring default portfolio");
    const { portfolioId } = await ensureDefaultPortfolio();
    console.log("[cron] Portfolio ready", { portfolioId });

    // 3) Load current open positions
    console.log("[cron] Updating prices for open + page tickers");
    const openPositions = await updateAllPrices(portfolioId, withExchanges);
    console.log("[cron] Prices updated", {
        openPositions: openPositions.length,
    });

    const targetSymbolIds = symbolRows.map((r) => r.id);
    console.log("[cron] Loading latest close prices");
    const latestClose = await getLatestCloseMap(targetSymbolIds);
    console.log("[cron] Latest close map ready", {
        keys: Object.keys(latestClose).length,
    });

    // Equity = cash + Σ(qty * price) (use latest close when available)
    const cashRow = await db.select({ cash: portfolios.cashCurrent }).from(
        portfolios,
    ).where(eq(portfolios.id, portfolioId)).limit(1);
    const cashCurrent = Number(cashRow[0]?.cash ?? 0);

    const openBySymbol = new Map<
        string,
        { id: string; qty: number; avgCost: number }
    >();
    for (const p of openPositions) {
        openBySymbol.set(String(p.symbolId), {
            id: p.id,
            qty: Number(p.qty),
            avgCost: Number(p.avgCost),
        });
    }
    // Compute blocked symbols based on recent realized losses (cooldown)
    const blockedSymbolIds = new Set<string>();
    try {
        const now = new Date();
        const cutoff = new Date(now.getTime());
        cutoff.setUTCDate(
            cutoff.getUTCDate() - constants.REENTRY_COOLDOWN_DAYS,
        );
        // Find recently closed positions with realized loss
        const recentClosed = await db
            .select({
                symbolId: positions.symbolId,
                closedAt: positions.closedAt,
                realizedPnl: positions.realizedPnl,
            })
            .from(positions)
            .where(
                and(
                    eq(positions.portfolioId, portfolioId),
                    // closedAt after cutoff (NULLs are excluded by this comparison)
                    gte(positions.closedAt, cutoff),
                    lt(positions.realizedPnl, sql`0`),
                ),
            )
            .orderBy(desc(positions.closedAt));
        for (const row of recentClosed) {
            blockedSymbolIds.add(String(row.symbolId));
        }
        console.log("[cron] Blocked symbols (cooldown)", {
            count: blockedSymbolIds.size,
        });
    } catch (err) {
        console.warn("[cron] Failed to compute blocked symbols", { err });
    }

    console.log("[cron] Making rebalance plan");
    const { plan } = makePlan({
        // Use only tickers that resolved to symbolIds to avoid mismatches
        tickers: symbolRows.map((r) => r.ticker),
        symbolRows,
        openPositions: openPositions.map((p) => ({
            id: p.id,
            symbolId: p.symbolId,
            qty: Number(p.qty),
            avgCost: Number(p.avgCost),
        })),
        latestCloseBySymbolId: latestClose,
        cashCurrent,
        blockedSymbolIds,
        stopLossMultiplier: constants.STOP_LOSS_MULTIPLIER,
    });
    console.log("[cron] Plan ready", { actions: plan.length });

    // 4) Apply plan (simplified): adjust positions and cash
    await executePlan(portfolioId, plan, cashCurrent, openBySymbol);

    // Email summary (best-effort)
    try {
        const subject = `Wishing Wealth: ${
            plan.filter((p) => Math.abs(p.qtyDelta) > 1e-9).length
        } change(s) applied`;
        const runAt = new Date().toISOString();
        const html = await render(
            React.createElement(ChangeSummaryEmail, {
                plan,
                runAt,
            }),
        );
        await sendEmail({ to: env.ALERT_EMAIL, subject, html });
        console.log("[executePlan] Summary email sent");
    } catch (err) {
        console.warn("[executePlan] Failed to send summary email", { err });
    }

    return NextResponse.json({ ok: true, tickers, applied: plan.length });
}
