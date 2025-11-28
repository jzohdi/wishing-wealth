"use client";

import { Button } from "@/components/ui/button";
import { useState } from "react";

export function RefreshPricesButton() {
	const [loading, setLoading] = useState(false);
	const [message, setMessage] = useState<string | null>(null);

	async function handleClick() {
		try {
			setLoading(true);
			setMessage(null);
			const res = await fetch("/api/prices/refresh", { method: "POST" });
			if (!res.ok) {
				setMessage("Failed to refresh prices");
				return;
			}
			const json = (await res.json()) as { ok: boolean; updated?: number };
			if (json.ok) {
				setMessage(`${json.updated ?? 0} symbol(s) updated`);
				// Reload the current route's data for fresh PnL/mv calculations
				if (typeof window !== "undefined") {
					window.location.reload();
				}
			} else {
				setMessage("Failed to refresh prices");
			}
		} catch {
			setMessage("Failed to refresh prices");
		} finally {
			setLoading(false);
		}
	}

	return (
		<div className="flex items-center gap-3">
			<Button
				onClick={handleClick}
				disabled={loading}
				size="sm"
				variant="outline"
				className="cursor-pointer bg-emerald-500 text-white hover:bg-emerald-600"
			>
				{loading ? "Refreshing…" : "Refresh prices"}
			</Button>
			{message && <span className="text-white/60 text-xs">{message}</span>}
		</div>
	);
}
