import { type NextRequest, NextResponse } from "next/server";

// Sites allowed to frame these pages.
const FRAME_ANCESTORS = [
	"'self'",
	"https://jakezohdi.dev",
	"https://studio-zohdi-llc.com",
	"https://www.studio-zohdi-llc.com",
];

// Each page's Content-Security-Policy, with a fresh nonce per request. Next.js reads the nonce from the request's
// CSP header and puts it on the scripts it renders, so every page must render per request (see app/layout.tsx).
// script-src has no 'strict-dynamic': with it, browsers ignore 'self', and Vercel's bot protection adds an
// un-nonced same-origin script to production pages. 'self' covers that script and Next's chunks; the nonce covers
// Next's inline scripts. style-src keeps 'unsafe-inline': Next's built-in 404 page has style attributes and a
// <style> element without a nonce.
function contentSecurityPolicy(nonce: string, isDev: boolean): string {
	return [
		"default-src 'self'",
		// React uses eval in development only, for its debugging stacks.
		`script-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-eval'" : ""}`,
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data:",
		"font-src 'self'",
		"connect-src 'self'",
		"object-src 'none'",
		"base-uri 'self'",
		"form-action 'self'",
		`frame-ancestors ${FRAME_ANCESTORS.join(" ")}`,
	].join("; ");
}

export function proxy(request: NextRequest) {
	const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
	const csp = contentSecurityPolicy(
		nonce,
		process.env.NODE_ENV === "development",
	);

	const requestHeaders = new Headers(request.headers);
	requestHeaders.set("Content-Security-Policy", csp);
	const response = NextResponse.next({ request: { headers: requestHeaders } });
	response.headers.set("Content-Security-Policy", csp);
	return response;
}

export const config = {
	matcher: [
		// Pages only: not the API routes (tRPC, cron, price refresh), static files or the favicon, and not
		// next/link prefetches.
		{
			source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
			missing: [
				{ type: "header", key: "next-router-prefetch" },
				{ type: "header", key: "purpose", value: "prefetch" },
			],
		},
	],
};
