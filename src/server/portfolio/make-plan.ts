import constants from "../constants";

export type SymbolRow = { id: bigint; ticker: string };
export type OpenPosition = {
    id: string;
    symbolId: bigint;
    qty: number;
    avgCost: number;
    openedAt: Date;
};
export type PlanItem = {
    ticker: string;
    symbolId: bigint;
    action: "BUY" | "SELL" | "HOLD";
    qtyDelta: number;
    price: number;
};

function sum(values: number[]) {
    let s = 0;
    for (const v of values) s += v;
    return s;
}

export function makePlan(args: {
    tickers: string[];
    symbolRows: SymbolRow[];
    openPositions: OpenPosition[];
    latestCloseBySymbolId: Record<string, number>;
    cashCurrent: number;
    blockedSymbolIds?: Set<string>;
    stopLossMultiplier?: number;
}) {
    const {
        tickers,
        symbolRows,
        openPositions,
        latestCloseBySymbolId,
        cashCurrent,
        blockedSymbolIds,
        stopLossMultiplier,
    } = args;

    const symbolIdByTicker = new Map<string, bigint>(
        symbolRows.map((r) => [r.ticker, r.id]),
    );

    // Market value of open positions using latest close when available (fallback to avgCost)
    const mv = sum(
        openPositions.map((p) =>
            Number(p.qty) *
            (latestCloseBySymbolId[String(p.symbolId)] ?? Number(p.avgCost))
        ),
    );
    const equity = cashCurrent + mv;

    const targetSymbolIds = symbolRows.map((r) => r.id);
    const N = targetSymbolIds.length || 1;
    const targetPerSymbol = equity / N;

    const openBySymbol = new Map<
        string,
        { id: string; qty: number; avgCost: number; openedAt: Date }
    >();
    for (const p of openPositions) {
        openBySymbol.set(String(p.symbolId), {
            id: p.id,
            qty: Number(p.qty),
            avgCost: Number(p.avgCost),
            openedAt: p.openedAt,
        });
    }

    // Determine stop-loss triggers (price below avgCost * multiplier)
    const enforcedStopLossIds = new Set<string>();
    const multiplier = stopLossMultiplier ?? constants.STOP_LOSS_MULTIPLIER;
    for (const p of openPositions) {
        const key = String(p.symbolId);
        const price = latestCloseBySymbolId[key];
        if (price === undefined) continue;
        const avg = Number(p.avgCost);
        // Same ET day guard: do not stop-loss sell on the same day position was opened
        const openedEt = toEtDateString(p.openedAt);
        const todayEt = toEtDateString(new Date());
        const isSameDay = openedEt === todayEt;
        if (!isSameDay && price + 1e-9 < avg * multiplier) {
            enforcedStopLossIds.add(key);
        }
    }

    const plan: PlanItem[] = [];
    console.log(
        "[plan] Rebalancing disabled. Sells first, then cash-driven buys.",
    );

    // 1) Stop-loss sells
    for (const p of openPositions) {
        const key = String(p.symbolId);
        if (!enforcedStopLossIds.has(key)) continue;
        const price = latestCloseBySymbolId[key];
        if (price === undefined) continue;
        plan.push({
            ticker: symbolRows.find((r) => r.id === p.symbolId)?.ticker ?? "",
            symbolId: p.symbolId,
            action: "SELL",
            qtyDelta: -Number(p.qty),
            price,
        });
    }

    // Symbols no longer present → sell all
    for (const p of openPositions) {
        if (!tickers.some((t) => symbolIdByTicker.get(t) === p.symbolId)) {
            const price = latestCloseBySymbolId[String(p.symbolId)] ??
                Number(p.avgCost);
            // Same-day guard
            const openedEt = toEtDateString(
                openBySymbol.get(String(p.symbolId))!.openedAt,
            );
            const todayEt = toEtDateString(new Date());
            if (openedEt === todayEt) {
                continue;
            }
            plan.push({
                ticker: symbolRows.find((r) => r.id === p.symbolId)?.ticker ??
                    "",
                symbolId: p.symbolId,
                action: "SELL",
                qtyDelta: -Number(p.qty),
                price,
            });
        }
    }

    // 3) Cash usage: compute cash after sells
    const cashAfterSells = cashCurrent + plan
        .filter((i) => i.action === "SELL")
        .reduce((s, i) => s + Math.abs(i.qtyDelta) * i.price, 0);

    // 4) New tickers to buy first (using only available cash)
    const openSet = new Set<string>(
        openPositions.map((p) => String(p.symbolId)),
    );
    const newSymbols: Array<{ sid: bigint; ticker: string; price: number }> =
        [];
    for (const t of tickers) {
        const sid = symbolIdByTicker.get(t);
        if (!sid) continue;
        const key = String(sid);
        if (openSet.has(key)) continue; // already held
        if (blockedSymbolIds?.has(key) === true) continue; // respect cooldown/blocks
        const price = latestCloseBySymbolId[key];
        if (!price) continue;
        newSymbols.push({ sid, ticker: t, price });
    }

    if (newSymbols.length > 0 && cashAfterSells > 0) {
        const per = cashAfterSells / newSymbols.length;
        for (const n of newSymbols) {
            const qty = per / n.price;
            if (qty <= 1e-9) continue;
            plan.push({
                ticker: n.ticker,
                symbolId: n.sid,
                action: "BUY",
                qtyDelta: qty,
                price: n.price,
            });
        }
    } else if (newSymbols.length === 0 && cashAfterSells > 0) {
        // No new tickers to buy: distribute cash equally among remaining open positions in basket
        const recipients: Array<
            { sid: bigint; ticker: string; price: number }
        > = [];
        for (const p of openPositions) {
            const key = String(p.symbolId);
            if (enforcedStopLossIds.has(key)) continue; // being sold
            if (!tickers.some((t) => symbolIdByTicker.get(t) === p.symbolId)) {
                continue; // out of basket
            }
            const price = latestCloseBySymbolId[key] ?? Number(p.avgCost);
            if (!price) continue;
            const ticker = symbolRows.find((r) =>
                r.id === p.symbolId
            )?.ticker ?? "";
            recipients.push({ sid: p.symbolId, ticker, price });
        }
        if (recipients.length > 0) {
            const per = cashAfterSells / recipients.length;
            for (const r of recipients) {
                const qty = per / r.price;
                if (qty <= 1e-9) continue;
                plan.push({
                    ticker: r.ticker,
                    symbolId: r.sid,
                    action: "BUY",
                    qtyDelta: qty,
                    price: r.price,
                });
            }
        }
    }

    console.log("[plan] Plan built", { items: plan.length });
    return { equity, targetPerSymbol, plan };
}

function toEtDateString(d: Date): string {
    const fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });
    return fmt.format(d);
}
