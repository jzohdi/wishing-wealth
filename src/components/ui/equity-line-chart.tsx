"use client";

import { useMemo, useState } from "react";
import {
	Area,
	AreaChart,
	CartesianGrid,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";

export type EquityPoint = { date: string; equity: number };

type RangeKey = "ALL" | "1W" | "1M" | "3M" | "YTD";

export function EquityLineChart({ data }: { data: EquityPoint[] }) {
	const [range, setRange] = useState<RangeKey>("ALL");

	const filtered = useMemo(() => {
		if (range === "ALL") return data;
		const last = data[data.length - 1];
		if (!last) return data;
		const end = toUtcDate(last.date);
		let start = new Date(end);
		if (range === "1W") start = addDays(end, -6);
		else if (range === "1M") start = addDays(end, -30);
		else if (range === "3M") start = addDays(end, -90);
		else if (range === "YTD")
			start = new Date(Date.UTC(end.getUTCFullYear(), 0, 1));
		return data.filter((d) => {
			const dt = toUtcDate(d.date);
			return dt >= start && dt <= end;
		});
	}, [data, range]);

	const formatted = useMemo(() => {
		return filtered.map((d) => ({ ...d, label: d.date }));
	}, [filtered]);

	const { delta, deltaPct, strokeColor } = useMemo(() => {
		const first = filtered[0]?.equity ?? 0;
		const last = filtered[filtered.length - 1]?.equity ?? first;
		const d = last - first;
		const p = first !== 0 ? (d / first) * 100 : 0;
		const stroke = d >= 0 ? "#10b981" : "#ef4444"; // emerald-500 or red-500
		return { delta: d, deltaPct: p, strokeColor: stroke };
	}, [filtered]);

	return (
		<div className="rounded-xl border border-white/10 bg-white/5 p-4 shadow-sm">
			<div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
				<div className="min-w-0">
					<h2 className="font-semibold text-base text-emerald-400 sm:text-lg">
						Net worth over time
					</h2>
					<p className="text-white/60 text-xs">
						One point per day. Today uses the latest available totals.
					</p>
				</div>
				<div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:gap-3">
					<div className="text-left sm:text-right">
						<div
							className={`font-semibold text-sm ${
								delta >= 0 ? "text-emerald-300" : "text-red-300"
							}`}
						>
							{formatCurrency(delta)} ({deltaPct.toFixed(2)}%)
						</div>
						<div className="text-[11px] text-white/50">Change in range</div>
					</div>
					<div className="flex flex-wrap items-center gap-1">
						{(
							[
								{ key: "ALL", label: "All" },
								{ key: "1W", label: "1W" },
								{ key: "1M", label: "1M" },
								{ key: "3M", label: "3M" },
								{ key: "YTD", label: "YTD" },
							] as { key: RangeKey; label: string }[]
						).map((opt) => {
							const active = range === opt.key;
							return (
								<button
									key={opt.key}
									type="button"
									onClick={() => setRange(opt.key)}
									className={`whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] transition-colors sm:px-2 sm:py-1 sm:text-xs ${
										active
											? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
											: "border-white/10 bg-white/5 text-white/60 hover:bg-white/10"
									}`}
									aria-pressed={active}
								>
									{opt.label}
								</button>
							);
						})}
					</div>
				</div>
			</div>
			<div className="h-56 w-full">
				<ResponsiveContainer width="100%" height="100%">
					<AreaChart
						data={formatted}
						margin={{ left: 0, right: 0, top: 8, bottom: 0 }}
					>
						<defs>
							<linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
								<stop offset="0%" stopColor={strokeColor} stopOpacity={0.45} />
								<stop offset="100%" stopColor={strokeColor} stopOpacity={0} />
							</linearGradient>
						</defs>
						<CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
						<XAxis
							dataKey="label"
							tickLine={false}
							axisLine={false}
							tick={{ fill: "#9CA3AF", fontSize: 12 }}
							minTickGap={32}
						/>
						<YAxis
							tickLine={false}
							axisLine={false}
							tick={{ fill: "#9CA3AF", fontSize: 12 }}
							width={64}
							tickFormatter={(v) => formatCurrencyShort(v)}
						/>
						<Tooltip
							cursor={{
								stroke: strokeColor,
								strokeOpacity: 0.15,
								strokeWidth: 2,
							}}
							contentStyle={{
								background: "rgba(17,24,39,0.85)",
								border: "1px solid rgba(255,255,255,0.12)",
								borderRadius: 12,
							}}
							formatter={(value: any) => [
								formatCurrency(value as number),
								"Equity",
							]}
							labelClassName="text-white/80"
						/>
						<Area
							type="monotone"
							dataKey="equity"
							stroke={strokeColor}
							strokeWidth={2}
							fill="url(#equityGradient)"
							dot={false}
							activeDot={{ r: 4, fill: strokeColor }}
						/>
					</AreaChart>
				</ResponsiveContainer>
			</div>
		</div>
	);
}

function toUtcDate(s: string): Date {
	const d = new Date(s);
	// Normalize to midnight UTC for safe comparisons
	return new Date(
		Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
	);
}

function addDays(d: Date, delta: number): Date {
	const out = new Date(d);
	out.setUTCDate(out.getUTCDate() + delta);
	return out;
}

function formatCurrencyShort(n: number) {
	const abs = Math.abs(n);
	if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
	if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
	if (abs >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
	return `$${n.toFixed(0)}`;
}

function formatCurrency(n: number) {
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
		maximumFractionDigits: 2,
	}).format(n);
}
