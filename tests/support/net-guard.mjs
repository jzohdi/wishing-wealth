// Network guard for `next start` in the smoke test. playwright.config.ts loads it into every Node process of the
// server with NODE_OPTIONS=--import, so "Refresh prices" never scrapes the live site and nothing leaves the machine.
//   fetch to loopback (the Resend stub)            passed through
//   fetch to https://www.tradingview.com/symbols/  answered with the committed fixture (WW_GUARD_FIXTURE)
//   any other fetch, http.request or https.request blocked: it throws, and the block is logged
// Every decision is appended to WW_GUARD_LOG as a JSON line, so the test can prove the guard is loaded before it
// presses "Refresh prices", and that nothing was blocked.
import { appendFileSync, readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";

const LOG = process.env.WW_GUARD_LOG;
const FIXTURE = process.env.WW_GUARD_FIXTURE;
if (!LOG || !FIXTURE) {
	console.error("[net-guard] WW_GUARD_LOG and WW_GUARD_FIXTURE must be set");
	process.exit(97);
}
const fixtureHtml = readFileSync(FIXTURE, "utf8");
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const isLoopback = (host) => LOOPBACK.has(String(host ?? "").toLowerCase());

function log(entry) {
	appendFileSync(
		LOG,
		`${JSON.stringify({ at: new Date().toISOString(), pid: process.pid, ...entry })}\n`,
	);
}

log({ event: "installed" });

const realFetch = globalThis.fetch;
function urlOf(input) {
	if (input instanceof URL) return input;
	if (typeof input === "object" && input !== null && "url" in input) {
		return new URL(input.url); // a Request
	}
	return new URL(String(input));
}
globalThis.fetch = async function guardedFetch(input, init) {
	let url;
	try {
		url = urlOf(input);
	} catch {
		log({ event: "blocked", api: "fetch", url: String(input).slice(0, 200) });
		throw new TypeError("[net-guard] blocked an unparsable fetch");
	}
	const where = `${url.origin}${url.pathname}`;
	if (isLoopback(url.hostname)) {
		log({ event: "allowed", api: "fetch", url: where });
		return realFetch(input, init);
	}
	if (
		url.hostname === "www.tradingview.com" &&
		url.pathname.startsWith("/symbols/")
	) {
		log({ event: "fixture", api: "fetch", url: where });
		return new Response(fixtureHtml, {
			status: 200,
			headers: { "content-type": "text/html; charset=utf-8" },
		});
	}
	log({ event: "blocked", api: "fetch", url: where });
	console.error(`[net-guard] BLOCKED fetch to ${where}`);
	throw new TypeError(`[net-guard] blocked fetch to ${url.hostname}`);
};

function hostOf(args) {
	const [target] = args;
	if (typeof target === "string") {
		try {
			return new URL(target).hostname;
		} catch {
			return target;
		}
	}
	if (target instanceof URL) return target.hostname;
	if (target && typeof target === "object") {
		return (
			target.hostname ?? String(target.host ?? "localhost").replace(/:\d+$/, "")
		);
	}
	return "localhost";
}
for (const [name, mod] of [
	["http", http],
	["https", https],
]) {
	for (const fn of ["request", "get"]) {
		const original = mod[fn];
		mod[fn] = function guarded(...args) {
			const host = hostOf(args);
			if (isLoopback(host)) return original.apply(this, args);
			log({ event: "blocked", api: `${name}.${fn}`, host });
			console.error(`[net-guard] BLOCKED ${name}.${fn} to ${host}`);
			throw new Error(`[net-guard] blocked ${name}.${fn} to ${host}`);
		};
	}
}
