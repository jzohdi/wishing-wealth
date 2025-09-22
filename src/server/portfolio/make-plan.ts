import constants from "../constants";

export type SymbolRow = { id: bigint; ticker: string };
export type OpenPosition = {
    id: string;
    symbolId: bigint;
    qty: number;
    avgCost: number;
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
        { id: string; qty: number; avgCost: number }
    >();
    for (const p of openPositions) {
        openBySymbol.set(String(p.symbolId), {
            id: p.id,
            qty: Number(p.qty),
            avgCost: Number(p.avgCost),
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
        if (price + 1e-9 < avg * multiplier) {
            enforcedStopLossIds.add(key);
        }
    }

    const plan: PlanItem[] = [];
    console.log("[plan] Computing target per symbol", {
        targetPerSymbol: Number(targetPerSymbol.toFixed(2)),
    });

    for (const t of tickers) {
        const sid = symbolIdByTicker.get(t);
        if (!sid) continue;
        const key = String(sid);
        const price = latestCloseBySymbolId[key];
        if (!price) continue;
        const isBlocked = blockedSymbolIds?.has(key) === true;
        const stopLoss = enforcedStopLossIds.has(key);
        const desiredQty = isBlocked || stopLoss
            ? 0
            : (targetPerSymbol / price);
        const cur = openBySymbol.get(key);
        const delta = cur ? desiredQty - cur.qty : desiredQty;
        plan.push({
            ticker: t,
            symbolId: sid,
            action: Math.abs(delta) < 1e-9
                ? "HOLD"
                : delta > 0
                ? "BUY"
                : "SELL",
            qtyDelta: delta,
            price,
        });
    }

    // Symbols no longer present → sell all
    for (const p of openPositions) {
        if (!tickers.some((t) => symbolIdByTicker.get(t) === p.symbolId)) {
            const price = latestCloseBySymbolId[String(p.symbolId)] ??
                Number(p.avgCost);
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

    console.log("[plan] Plan built", { items: plan.length });
    return { equity, targetPerSymbol, plan };
}
