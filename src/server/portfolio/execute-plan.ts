import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { portfolios, positions } from "../db/schema";
import type { PlanItem } from "./make-plan";

export async function executePlan(
    portfolioId: string,
    plan: PlanItem[],
    cashCurrent: number,
    openBySymbol: Map<string, { id: string; qty: number; avgCost: number }>,
) {
    console.log("[executePlan] Executing plan", { actions: plan.length });
    const actionable: PlanItem[] = [];
    await db.transaction(async (tx) => {
        let cash = cashCurrent;
        for (const item of plan) {
            if (Math.abs(item.qtyDelta) < 1e-9) {
                console.log("[executePlan] SKIP HOLD", {
                    symbolId: String(item.symbolId),
                    ticker: item.ticker,
                });
                continue;
            }
            const isBuy = item.qtyDelta > 0;

            // Upsert position or update
            const sid = item.symbolId;
            const existing = openBySymbol.get(String(sid));
            if (isBuy) {
                const execQty = item.qtyDelta; // positive
                const notional = Math.abs(execQty) * item.price;
                cash -= notional;
                console.log("[executePlan] BUY", {
                    symbolId: String(sid),
                    ticker: item.ticker,
                    qty: execQty,
                    price: item.price,
                    notional,
                    cashAfter: cash,
                });
                actionable.push(item);
                if (!existing) {
                    await tx.insert(positions).values({
                        portfolioId,
                        symbolId: sid,
                        qty: String(execQty),
                        avgCost: String(item.price),
                    });
                    openBySymbol.set(String(sid), {
                        id: "", // not used after this point in this flow
                        qty: Number(execQty),
                        avgCost: Number(item.price),
                    });
                } else {
                    const newQty = existing.qty + execQty;
                    const newAvg = (existing.qty * existing.avgCost +
                        execQty * item.price) / newQty;
                    await tx
                        .update(positions)
                        .set({ qty: String(newQty), avgCost: String(newAvg) })
                        .where(eq(positions.id, existing.id));
                    openBySymbol.set(String(sid), {
                        id: existing.id,
                        qty: newQty,
                        avgCost: newAvg,
                    });
                }
            } else {
                if (!existing) {
                    console.warn(
                        "[executePlan] SELL with no existing position",
                        {
                            symbolId: String(sid),
                            ticker: item.ticker,
                            requested: item.qtyDelta,
                        },
                    );
                    continue;
                }
                const sellQty = Math.min(existing.qty, Math.abs(item.qtyDelta));
                const notional = sellQty * item.price;
                cash += notional;
                const realized = (item.price - existing.avgCost) * sellQty;
                const newQty = existing.qty - sellQty;
                console.log("[executePlan] SELL", {
                    symbolId: String(sid),
                    ticker: item.ticker,
                    qty: -sellQty,
                    price: item.price,
                    notional,
                    realized,
                    cashAfter: cash,
                    closing: newQty <= 1e-9,
                });
                actionable.push({ ...item, qtyDelta: -sellQty });
                if (newQty <= 1e-9) {
                    await tx.update(positions)
                        .set({
                            closedAt: new Date(),
                            realizedPnl: sql`${positions.realizedPnl} + ${
                                String(
                                    realized,
                                )
                            }`,
                        })
                        .where(eq(positions.id, existing.id));
                    openBySymbol.delete(String(sid));
                } else {
                    await tx.update(positions)
                        .set({
                            qty: String(newQty),
                            realizedPnl: sql`${positions.realizedPnl} + ${
                                String(
                                    realized,
                                )
                            }`,
                        })
                        .where(eq(positions.id, existing.id));
                    openBySymbol.set(String(sid), {
                        id: existing.id,
                        qty: newQty,
                        avgCost: existing.avgCost,
                    });
                }
            }
        }
        await tx.update(portfolios)
            .set({ cashCurrent: String(cash) })
            .where(eq(portfolios.id, portfolioId));
        console.log("[executePlan] Portfolio cash updated", {
            portfolioId,
            cash,
        });
    });
    console.log("[executePlan] Done");
}
