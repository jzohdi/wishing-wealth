import constants from "@/server/constants";

export type ScrapedTicker = { ticker: string; url: string };
export type GmiSignal = "GREEN" | "RED";

export type ScrapeResult = {
	gmiSignal: GmiSignal | null;
	gmiSince: string | null;
	tickers: ScrapedTicker[];
};

function parseTickersFromHtml({ html }: { html: string }): ScrapedTicker[] {
	// Narrow to the GLB table to reduce false positives
	const tableMatch =
		/<table[^>]*class=["'][^"']*glb-table[^"']*["'][^>]*>([\s\S]*?)<\/table>/i.exec(
			html,
		);
	const scope = tableMatch ? tableMatch[1] : html;

	if (!scope) {
		return [];
	}

	const re =
		/<td[^>]*class=["'][^"']*col-1[^"']*["'][^>]*>\s*<a[^>]*href=["']([^"']+)["'][^>]*>([A-Z0-9.\-]{1,10})<\/a>/g;
	const map = new Map<string, string>();
	let m = re.exec(scope);
	while (m !== null) {
		const href = m[1]?.trim();
		const raw = m[2]?.trim();
		if (!href || !raw) {
			console.warn("Invalid ticker found", { href, raw });
			m = re.exec(scope);
			continue;
		}
		// Basic normalization: uppercase, remove leading $ if any (defensive)
		const t = raw.startsWith("$") ? raw.slice(1) : raw;
		if (/^[A-Z0-9.\-]{1,10}$/.exec(t)) {
			if (!map.has(t)) {
				map.set(t, href);
			}
		}
		m = re.exec(scope);
	}

	return Array.from(map.entries()).map(([ticker, url]) => ({ ticker, url }));
}

function parseGmiSignalFromHtml({ html }: { html: string }): {
	signal: GmiSignal | null;
	since: string | null;
} {
	// Look for the Current GMI Signal widget:
	// <h2 class="widget-title">Current GMI Signal</h2>
	// <div class="textwidget custom-html-widget">
	//   <h3 style="font-weight: bold">GREEN</h3>
	//   <small>since close on Nov 26, 2025</small>
	const widgetMatch =
		/<h2[^>]*class=["'][^"']*widget-title[^"']*["'][^>]*>Current GMI Signal<\/h2>\s*<div[^>]*class=["'][^"']*textwidget[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(
			html,
		);

	if (!widgetMatch || !widgetMatch[1]) {
		console.warn("[scrape] Could not find Current GMI Signal widget");

		return { signal: null, since: null };
	}

	const widgetContent = widgetMatch[1];

	// Extract signal value from <h3>
	const signalMatch = /<h3[^>]*>(GREEN|RED)<\/h3>/i.exec(widgetContent);
	const signal = signalMatch
		? (signalMatch[1]?.toUpperCase() as GmiSignal)
		: null;

	// Extract "since" date from <small>
	const sinceMatch = /<small>([^<]+)<\/small>/i.exec(widgetContent);
	const since = sinceMatch ? (sinceMatch[1]?.trim() ?? null) : null;

	return { signal, since };
}

export async function scrapeWishingWealthBlog(): Promise<ScrapeResult> {
	console.log("[scrape] Fetching source page", { url: constants.SOURCE_URL });
	const res = await fetch(constants.SOURCE_URL, {
		headers: {
			"user-agent": "WishingWealthBot/1.0 (+https://example.com)",
		},
		cache: "no-store",
	});

	if (!res.ok) {
		console.warn("[scrape] Source fetch failed", {
			url: constants.SOURCE_URL,
			status: res.status,
		});

		return { gmiSignal: null, gmiSince: null, tickers: [] };
	}

	const html = await res.text();

	const { signal: gmiSignal, since: gmiSince } = parseGmiSignalFromHtml({
		html,
	});
	console.log("[scrape] Parsed GMI signal", { gmiSignal, gmiSince });

	const tickers = parseTickersFromHtml({ html });
	console.log("[scrape] Parsed tickers", { count: tickers.length });

	return { gmiSignal, gmiSince, tickers };
}

// For testing
export { parseTickersFromHtml, parseGmiSignalFromHtml };
