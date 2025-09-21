import constants from "@/server/constants";

export type ScrapedTicker = { ticker: string; url: string };

function parseTickersFromHtml(html: string): ScrapedTicker[] {
    // Narrow to the GLB table to reduce false positives
    const tableMatch =
        /<table[^>]*class=["'][^"']*glb-table[^"']*["'][^>]*>([\s\S]*?)<\/table>/i
            .exec(
                html,
            );
    const scope = tableMatch ? tableMatch[1] : html;

    if (!scope) {
        return [];
    }

    const re =
        /<td[^>]*class=["'][^"']*col-1[^"']*["'][^>]*>\s*<a[^>]*href=["']([^"']+)["'][^>]*>([A-Z0-9.\-]{1,10})<\/a>/g;
    const map = new Map<string, string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(scope)) !== null) {
        const href = m[1]?.trim();
        const raw = m[2]?.trim();
        if (!href || !raw) {
            console.warn("Invalid ticker found", { href, raw });
            continue;
        }
        // Basic normalization: uppercase, remove leading $ if any (defensive)
        const t = raw.startsWith("$") ? raw.slice(1) : raw;
        if (/^[A-Z0-9.\-]{1,10}$/.exec(t)) {
            if (!map.has(t)) map.set(t, href);
        }
    }
    return Array.from(map.entries()).map(([ticker, url]) => ({ ticker, url }));
}

export async function fetchTickersFromSource(): Promise<ScrapedTicker[]> {
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
        return [];
    }
    const html = await res.text();
    const tickers = parseTickersFromHtml(html);
    console.log("[scrape] Parsed tickers", { count: tickers.length });
    return tickers;
}

export { parseTickersFromHtml };
