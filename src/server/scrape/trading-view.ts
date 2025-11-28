import { load } from "cheerio";
import { z } from "zod";

// Simple in-memory HTML cache keyed by URL
const htmlCache = new Map<string, string>();

async function fetchHtmlCached(url: string): Promise<string> {
	console.log("[scrape] Fetch TradingView URL", { url });
	const cached = htmlCache.get(url);
	if (cached) {
		console.log("[scrape] Using cached HTML", { url });
		return cached;
	}
	const res = await fetch(url, {
		headers: {
			"user-agent": "WishingWealthBot/1.0 (+https://example.com)",
		},
		cache: "no-store",
	});
	const html = await res.text();
	htmlCache.set(url, html);
	console.log("[scrape] Cached HTML", { url, bytes: html.length });
	return html;
}

export async function getExchanges(tickers: { ticker: string; url: string }[]) {
	console.log("[scrape] Resolving exchanges", { count: tickers.length });
	const results = await Promise.all(
		tickers.map(async ({ ticker, url }) => {
			const html = await fetchHtmlCached(url);
			const exchange = extractExchangeFromHtml({ html, url });
			return { ticker, exchange, url };
		}),
	);
	console.log("[scrape] Exchanges resolved", { count: results.length });
	return results;
}

export async function getPrice({
	ticker,
	exchange,
}: { ticker: string; exchange: string }) {
	const url = `https://www.tradingview.com/symbols/${exchange}-${ticker}/`;
	const html = await fetchHtmlCached(url);
	const price = extractPriceFromHtml({ html, url });
	console.log("[scrape] Parsed price", { ticker, exchange, price });
	return price;
}

const Primitive = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const FieldSchema = z
	.object({
		name: z.string(),
		value: Primitive.optional(),
	})
	.passthrough();

const PriceVarSchema = z
	.object({
		fields: z.array(FieldSchema).optional(),
	})
	.passthrough();

const SymbolFaqSchema = z
	.object({
		variables: z
			.object({
				price: PriceVarSchema.optional(),
			})
			.passthrough(),
	})
	.passthrough();

const TradeSchema = z
	.object({
		price: z.number().optional(),
	})
	.passthrough();

const SymbolSchema = z
	.object({
		trade: TradeSchema.optional(),
	})
	.passthrough();

const LayerDataSchema = z
	.object({
		symbol: SymbolSchema.optional(),
		symbol_faq_data: SymbolFaqSchema.optional(),
	})
	.passthrough();

const LayerSchema = z
	.object({
		data: LayerDataSchema.optional(),
	})
	.passthrough();

const TopSchema = z.record(LayerSchema);

export function extractPriceFromHtml({
	html,
	url,
}: { html: string; url: string }) {
	const $ = load(html);

	// Primary strategy: parse TradingView init JSON for robust data access
	const scripts = $('script[type="application/prs.init-data+json"]').toArray();
	if (scripts.length > 0) {
		for (const node of scripts) {
			const jsonText = $(node).text().trim();
			if (!jsonText) {
				continue;
			}
			let parsed: unknown;
			try {
				parsed = JSON.parse(jsonText);
			} catch {
				continue;
			}
			// console.log({ parsed });

			const safe = TopSchema.safeParse(parsed);
			if (!safe.success) {
				// Try generic search in unknown structures
				const found = findPriceInUnknown(parsed);
				if (typeof found === "number" && Number.isFinite(found)) {
					return found;
				}
				continue;
			}
			const layers = safe.data as Record<string, z.infer<typeof LayerSchema>>;

			for (const layer of Object.values(layers)) {
				const data = layer?.data;
				if (!data) {
					continue;
				}
				// 1) Real-time trade price if available
				const tradePrice = data.symbol?.trade?.price;
				if (typeof tradePrice === "number" && Number.isFinite(tradePrice)) {
					return tradePrice;
				}
				// 2) Daily close from FAQ variables if present
				const fields = data.symbol_faq_data?.variables?.price?.fields;
				if (Array.isArray(fields)) {
					const close = fields.find((f) => f?.name === "daily_bar_close");
					const value = close?.value;
					if (typeof value === "number" && Number.isFinite(value)) {
						return value;
					}
				}
			}

			// If not found in strict structure, try generic search
			const found = findPriceInUnknown(parsed);
			if (typeof found === "number" && Number.isFinite(found)) {
				return found;
			}
		}
	}

	// Fallback: DOM lookup for js-symbol-last
	const el = $("span.js-symbol-last").first();
	let raw = el.text().trim();
	if (!raw) {
		raw = el.find("span").first().text().trim();
	}
	const normalized = raw.replace(/−/g, "-").replace(/[^0-9.\-]/g, "");
	const price = Number.parseFloat(normalized);
	if (Number.isFinite(price)) {
		return price;
	}

	// Fallback: regex around js-symbol-last
	const m = /js-symbol-last["'\s>][\s\S]*?<span>([0-9][0-9,\.]+)<\/span>/i.exec(
		html,
	);
	if (m && m[1]) {
		const p2 = Number.parseFloat(
			m[1].replace(/,/g, ".").replace(/[^0-9.\-]/g, ""),
		);
		if (Number.isFinite(p2)) {
			return p2;
		}
	}

	console.warn("Could not parse price from TradingView HTML", { url });
	throw new Error("Price parse failed");
}

function findPriceInUnknown(root: unknown): number | undefined {
	const Primitive = z.union([z.string(), z.number(), z.boolean(), z.null()]);
	const FieldSchema = z
		.object({
			name: z.string(),
			value: Primitive.optional(),
		})
		.passthrough();

	const TradeLike = z
		.object({
			trade: z.object({ price: z.number() }).passthrough(),
		})
		.passthrough();

	const PriceVarsLike = z
		.object({
			variables: z
				.object({
					price: z.object({ fields: z.array(FieldSchema) }).passthrough(),
				})
				.passthrough(),
		})
		.passthrough();

	const stack: unknown[] = [root];
	let steps = 0;
	const MAX_STEPS = 50000;

	while (stack.length > 0 && steps++ < MAX_STEPS) {
		const node = stack.pop();
		if (node === null || node === undefined) {
			continue;
		}
		if (typeof node === "number" && Number.isFinite(node)) {
			// Not a structure; ignore
			continue;
		}
		if (Array.isArray(node)) {
			for (let i = 0; i < node.length; i++) {
				stack.push(node[i]);
			}
			continue;
		}
		if (typeof node === "object") {
			const t = TradeLike.safeParse(node);
			if (t.success && Number.isFinite(t.data.trade.price)) {
				return t.data.trade.price;
			}
			const v = PriceVarsLike.safeParse(node);
			if (v.success) {
				const fields = v.data.variables.price.fields;
				const close = fields.find((f) => f?.name === "daily_bar_close");
				const value = close?.value;
				if (typeof value === "number" && Number.isFinite(value)) {
					return value;
				}
				if (typeof value === "string") {
					const n = Number.parseFloat(
						value.replace(/,/g, ".").replace(/[^0-9.\-]/g, ""),
					);
					if (Number.isFinite(n)) {
						return n;
					}
				}
			}
			for (const val of Object.values(node as Record<string, unknown>)) {
				stack.push(val);
			}
		}
	}
}

function extractExchangeFromHtml({ html, url }: { html: string; url: string }) {
	const $ = load(html);
	// Look for canonical link like: https://www.tradingview.com/symbols/NYSE-HWM/
	const href = $('link[rel="canonical"]').attr("href");
	if (!href) {
		console.warn("No canonical link found", { url });
		return "";
	}
	const m = /\/symbols\/([^/]+)\/?$/i.exec(href);
	if (!m) {
		console.warn("No match found", { url });
		return "";
	}
	const slug = m[1]!; // e.g., NYSE-HWM or NASDAQ-AAPL
	const parts = slug.split("-");
	if (parts.length < 2) return "";
	const exchange = parts[0]?.trim().toUpperCase() ?? "";
	return exchange;
}
