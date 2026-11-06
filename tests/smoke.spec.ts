// Behavior smoke test, checks B1–B14. See playwright.config.ts for how to run it.
// The local tests run in file order and build on each other: B4–B6 sign in and keep the session cookie for the
// dashboard tests. Tests tagged @readonly only load pages, so they alone run against a deployed site.
// B14 runs after every test: no page errors, no CSP violations, and no 4xx/5xx responses or console errors from
// this site's origin apart from the failures a test allows on purpose (other origins, e.g. a preview's Vercel
// toolbar, don't count, and neither does the toolbar being blocked by the CSP).
import { test as base, expect, type Page } from "@playwright/test";
import { render } from "@react-email/render";
import { createElement } from "react";

import { StatusEmail } from "../emails/change-summary";
import { OneTimePasscodeEmail } from "../emails/one-time-passcode";
import {
	appConnections,
	baseURL,
	codeFromEmail,
	countUsersAndSessions,
	emailHtml,
	guardLog,
	isLocalRun,
	newYorkToday,
	requireEnv,
	seedFile,
	signSession,
	stubEmails,
	validCodes,
	withDb,
} from "./support/local";

const origin = new URL(baseURL).origin;
const isOwnOrigin = (url: string) => {
	try {
		return new URL(url).origin === origin;
	} catch {
		return false;
	}
};

const test = base.extend<{
	allowFailure: (path: string, status: number) => void;
}>({
	allowFailure: [
		async ({ context }, runTest) => {
			const allowed: { path: string; status: number }[] = [];
			const problems: string[] = [];
			const isAllowed = (url: string, status: number) =>
				allowed.some(
					(a) => a.status === status && new URL(url).pathname === a.path,
				);

			if (!isLocalRun) {
				// Deployed sites: GET and HEAD only. Anything else (e.g. Vercel's bot-protection beacons) is answered
				// here and never sent. A protected preview's token goes to its own origin only.
				const token = process.env.VERCEL_OIDC_TOKEN;
				await context.route("**/*", (route) => {
					const request = route.request();
					if (!["GET", "HEAD"].includes(request.method())) {
						return route.fulfill({ status: 204, body: "" });
					}
					if (token && isOwnOrigin(request.url())) {
						return route.continue({
							headers: {
								...request.headers(),
								"x-vercel-trusted-oidc-idp-token": token,
							},
						});
					}
					return route.continue();
				});
			}
			await context.addInitScript(() => {
				document.addEventListener("securitypolicyviolation", (e) => {
					console.error(
						`[csp-violation] ${e.violatedDirective} blocked ${e.blockedURI}`,
					);
				});
			});
			const watch = (page: Page) => {
				page.on("pageerror", (error) =>
					problems.push(`page error: ${error.message}`),
				);
				page.on("response", (response) => {
					const status = response.status();
					if (
						status >= 400 &&
						isOwnOrigin(response.url()) &&
						!isAllowed(response.url(), status)
					) {
						problems.push(`${status} ${response.url()}`);
					}
				});
				page.on("console", (message) => {
					if (message.type() !== "error") return;
					const text = message.text();
					if (text.startsWith("[csp-violation]")) {
						// Expected on previews only: the CSP deliberately doesn't allow Vercel's toolbar.
						if (/ blocked https:\/\/vercel\.live(\/|$)/.test(text)) return;
						return void problems.push(text);
					}
					const url = message.location().url;
					if (url && !isOwnOrigin(url)) return;
					// Chrome's own line for an allowed failure, and the app's tRPC loggerLink line for it.
					const status = /status of (\d{3})/.exec(text)?.[1];
					if (status && url && isAllowed(url, Number(status))) return;
					const procedure = /<< mutation #\d+ (?:%c)?(auth\.\w+)/.exec(
						text,
					)?.[1];
					if (
						procedure &&
						allowed.some((a) => a.path === `/api/trpc/${procedure}`)
					)
						return;
					problems.push(`console error: ${text.slice(0, 200)}`);
				});
			};
			for (const page of context.pages()) watch(page);
			context.on("page", watch);

			await runTest((path, status) => allowed.push({ path, status }));

			expect(
				problems,
				"B14: no page errors, CSP violations, or unexpected own-origin 4xx/5xx or console errors",
			).toEqual([]);
		},
		{ auto: true },
	],
});

test.describe.configure({ mode: "serial" });

const NOT_FOUND = "/smoke-no-such-page";
const STRANGER = "stranger@example.test";
// The first allowed address. Local runs only.
const allowedEmail = () =>
	requireEnv("AUTH_ALLOWED_EMAILS").split(",")[0] ?? "";
// The signed-in session from B6, reused by the dashboard tests.
let sessionCookie = "";

async function expectSignedOut(page: Page) {
	await expect(page.locator("h1")).toHaveText("Wishing Wealth Tracker");
	await expect(
		page.getByText("GMI Signal & Ticker Tracker", { exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("link", { name: "Login", exact: true }),
	).toHaveAttribute("href", "/login");
	await expect(page.getByText(/Logged in as/)).toHaveCount(0);
}

async function setSessionCookie(page: Page, value: string) {
	await page.context().clearCookies();
	await page.context().addCookies([
		{
			name: "session",
			value,
			url: baseURL,
			httpOnly: true,
			secure: true,
			sameSite: "Lax",
		},
	]);
}

const clean = (s: string | null) => (s ?? "").replace(/\s+/g, " ").trim();

// The dashboard's KPI cards and the rows of both tables, as text.
async function readDashboard(page: Page) {
	const kpi = async (label: string) =>
		clean(
			await page
				.getByText(label, { exact: true })
				.locator("xpath=following-sibling::div")
				.textContent(),
		);
	const rows = (heading: string) =>
		page
			.locator("section", {
				has: page.getByRole("heading", { name: heading, exact: true }),
			})
			.locator("tbody tr")
			.evaluateAll((trs) =>
				trs.map((tr) =>
					[...tr.querySelectorAll("td")].map((td) =>
						(td.textContent ?? "").replace(/\s+/g, " ").trim(),
					),
				),
			);
	return {
		onPage: await kpi("Tickers On Page"),
		historical: await kpi("Historical Tickers"),
		lastUpdate: await kpi("Last Update"),
		current: await rows("Current Tickers on wishingwealthblog.com"),
		past: await rows("Historical Tickers (No Longer on Page)"),
	};
}

const usd = (n: number) =>
	new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
		maximumFractionDigits: 2,
	}).format(n);

test("B1 signed out, / shows the landing page and a Login link @readonly", async ({
	page,
}) => {
	const response = await page.goto("/");
	expect(response?.status()).toBe(200);
	await expectSignedOut(page);
	if (isLocalRun) {
		// The first test against a fresh server: without a cookie the app never connected to the database.
		await page.goto("/login");
		expect(await appConnections()).toBe(0);
	}
});

test("B2 /login shows the heading, an email field and Send code @readonly", async ({
	page,
}) => {
	const response = await page.goto("/login");
	expect(response?.status()).toBe(200);
	await expect(page.locator("h1")).toHaveText("Sign in to Wishing Wealth");
	await expect(
		page.getByText("Secure, passwordless login", { exact: true }),
	).toBeVisible();
	const email = page.getByLabel("Email");
	await expect(email).toHaveAttribute("type", "email");
	await expect(email).toHaveAttribute("required", "");
	await expect(
		page.getByRole("button", { name: "Send code", exact: true }),
	).toBeVisible();
});

test("B13 an unknown path returns Next's 404 page @readonly", async ({
	page,
	allowFailure,
}) => {
	allowFailure(NOT_FOUND, 404);
	const response = await page.goto(NOT_FOUND);
	expect(response?.status()).toBe(404);
	await expect(page.getByText("This page could not be found.")).toBeVisible();
	await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
});

const BASELINE_HEADERS = {
	"x-content-type-options": "nosniff",
	"referrer-policy": "strict-origin-when-cross-origin",
	"permissions-policy": "camera=(), microphone=(), geolocation=()",
};

test("pages send the security headers and a nonce CSP, and no X-Powered-By @readonly", async ({
	page,
	allowFailure,
}) => {
	allowFailure(NOT_FOUND, 404);
	const nonces = new Set<string>();
	for (const path of ["/", "/login", NOT_FOUND]) {
		const response = await page.goto(path);
		const headers = (await response?.allHeaders()) ?? {};
		expect(headers).toMatchObject(BASELINE_HEADERS);
		expect(headers).not.toHaveProperty("x-powered-by");
		const csp = headers["content-security-policy"] ?? "";
		const nonce = /'nonce-([^']+)'/.exec(csp)?.[1] ?? "";
		expect(csp).toBe(
			[
				"default-src 'self'",
				`script-src 'self' 'nonce-${nonce}'`,
				"style-src 'self' 'unsafe-inline'",
				"img-src 'self' data:",
				"font-src 'self'",
				"connect-src 'self'",
				"object-src 'none'",
				"base-uri 'self'",
				"form-action 'self'",
				"frame-ancestors 'self' https://jakezohdi.dev https://studio-zohdi-llc.com https://www.studio-zohdi-llc.com",
			].join("; "),
		);
		// Next.js put the request's nonce on the scripts it rendered.
		expect(await response?.text()).toContain(`nonce="${nonce}"`);
		nonces.add(nonce);
	}
	expect(nonces.size).toBe(3);
});

test("API responses send the security headers, without a CSP or X-Powered-By", async ({
	request,
}) => {
	const response = await request.get("/api/cron");
	expect(response.status()).toBe(401);
	const headers = response.headers();
	expect(headers).toMatchObject(BASELINE_HEADERS);
	expect(headers).not.toHaveProperty("content-security-policy");
	expect(headers).not.toHaveProperty("x-powered-by");
});

test("B9 POST /api/prices/refresh without a session returns 401", async ({
	request,
}) => {
	const response = await request.post("/api/prices/refresh");
	expect(response.status()).toBe(401);
	expect(await response.text()).toBe("Unauthorized");
});

test("B11 GET /api/cron with no bearer or a wrong one returns 401", async ({
	request,
}) => {
	// Never with the right bearer: that run scrapes live sites and sends real email.
	const noBearer: Record<string, string> = {};
	for (const headers of [noBearer, { authorization: "Bearer wrong-bearer" }]) {
		const response = await request.get("/api/cron", { headers });
		expect(response.status()).toBe(401);
		expect(await response.text()).toBe("Unauthorized");
	}
});

test("B3 an email not on the allowlist shows 'Email not allowed' and nothing is sent", async ({
	page,
	allowFailure,
}) => {
	allowFailure("/api/trpc/auth.sendOtp", 500); // the app throws a plain Error, which tRPC sends as a 500
	await page.goto("/login");
	await page.getByLabel("Email").fill(STRANGER);
	await page.getByRole("button", { name: "Send code" }).click();
	await expect(
		page.getByText("Email not allowed", { exact: true }),
	).toBeVisible();
	await page.waitForTimeout(1000);
	expect(await stubEmails()).toEqual([]);
});

test("B4 B5 B6 sign in with the emailed code", async ({
	page,
	allowFailure,
}) => {
	const email = allowedEmail();
	await page.goto("/login");

	let code = "";
	await test.step("B4 the allowed email gets 'Code sent', the code form and one email with the code", async () => {
		const requestedAt = Date.now();
		await page.getByLabel("Email").fill(email);
		await page.getByRole("button", { name: "Send code" }).click();
		await expect(
			page.getByText("Code sent. Check your email.", { exact: true }),
		).toBeVisible();
		await expect(page.getByLabel("One-time passcode")).toBeVisible();
		await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
		await expect(page.getByLabel("Email")).toHaveCount(0);
		await expect.poll(async () => (await stubEmails()).length).toBe(1);
		const [sent] = await stubEmails();
		expect(sent).toMatchObject({
			to: [email],
			from: requireEnv("RESEND_FROM_EMAIL"),
			subject: "Your Wishing Wealth login code",
			bearer: true,
		});
		expect(emailHtml(sent)).toContain("This code expires in 2 minutes.");
		code = codeFromEmail(sent) ?? "";
		expect(validCodes(email, requestedAt)).toContain(code);
	});

	await test.step("B5 a wrong code shows 'Invalid or expired code' and sets no cookie", async () => {
		allowFailure("/api/trpc/auth.verifyOtp", 500);
		const wrong =
			["000000", "111111", "222222"].find(
				(c) => !validCodes(email).includes(c),
			) ?? "";
		await page.getByLabel("One-time passcode").fill(wrong);
		await page.getByRole("button", { name: "Continue" }).click();
		await expect(
			page.getByText("Invalid or expired code", { exact: true }),
		).toBeVisible();
		expect(new URL(page.url()).pathname).toBe("/login");
		expect(await page.context().cookies()).toEqual([]);
		expect(await countUsersAndSessions()).toEqual({ users: 0, sessions: 0 });
	});

	await test.step("B6 the emailed code signs in: cookie, redirect to /, one user and one session", async () => {
		await page.getByLabel("One-time passcode").fill(code);
		const signedInAt = Date.now();
		await page.getByRole("button", { name: "Continue" }).click();
		await expect(page.getByText(`Logged in as ${email}`)).toBeVisible();
		expect(new URL(page.url()).pathname).toBe("/");
		const cookie = (await page.context().cookies()).find(
			(c) => c.name === "session",
		);
		expect(cookie).toMatchObject({
			httpOnly: true,
			secure: true,
			sameSite: "Lax",
			path: "/",
		});
		const days = ((cookie?.expires ?? 0) * 1000 - signedInAt) / 86_400_000;
		expect(Math.abs(days - 30)).toBeLessThan(5 / 1440);
		const [sessionId = ""] = (cookie?.value ?? "").split(".");
		expect(cookie?.value).toBe(signSession(sessionId));
		expect(await countUsersAndSessions()).toEqual({ users: 1, sessions: 1 });
		sessionCookie = cookie?.value ?? "";
	});

	await test.step("B6 signing in again reuses the user", async () => {
		await page.context().clearCookies();
		await page.goto("/login");
		await page.getByLabel("Email").fill(email);
		await page.getByRole("button", { name: "Send code" }).click();
		await expect.poll(async () => (await stubEmails()).length).toBe(2);
		await page
			.getByLabel("One-time passcode")
			.fill(codeFromEmail((await stubEmails())[1]) ?? "");
		await page.getByRole("button", { name: "Continue" }).click();
		await expect(page.getByText(`Logged in as ${email}`)).toBeVisible();
		expect(await countUsersAndSessions()).toEqual({ users: 1, sessions: 2 });
	});
});

test("B7 the dashboard shows the KPIs and both tables for the seed", async ({
	page,
}) => {
	await setSessionCookie(page, sessionCookie);
	await page.goto("/");
	await expect(page.getByText(`Logged in as ${allowedEmail()}`)).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Refresh prices" }),
	).toBeVisible();
	expect(await readDashboard(page)).toEqual({
		onPage: "5",
		historical: "3",
		// The alphabetically first ticker's newest price date (AAPL's), not the newest overall: as the app does it.
		lastUpdate: "2025-11-04",
		current: [
			["AAPL", "NASDAQ", usd(227.4), "2025-10-20", "2025-11-04"],
			["BRK.B", "NYSE", usd(1234.5), "2025-10-27", "2025-11-05"],
			["MSFT", "NASDAQ", usd(415.75), "2025-10-13", "2025-11-05"],
			["NVDA", "NASDAQ", usd(201), "2025-11-03", "2025-11-05"],
			["ZZZT", "NYSE", "—", "2025-11-05", "—"],
		],
		past: [
			["OLDB", "NASDAQ", "2025-08-01", "2025-10-30"],
			["OLDA", "NYSE", "2025-09-01", "2025-10-15"],
			["OLDC", "AMEX", "2025-07-01", "2025-09-20"],
		],
	});
});

test("B10 Refresh prices updates every on-page symbol from the fixture, behind the network guard", async ({
	page,
}) => {
	// Proof that the guard runs in the server: it logged its install, and B4's email went through it to the stub.
	const stub = requireEnv("RESEND_BASE_URL");
	expect(guardLog().some((e) => e.event === "installed")).toBe(true);
	expect(
		guardLog().some(
			(e) =>
				e.event === "allowed" && e.url === `${new URL(stub).origin}/emails`,
		),
	).toBe(true);
	const before = guardLog().length;

	await setSessionCookie(page, sessionCookie);
	// The page reloads as soon as the response arrives, so the response and the message are caught on the way.
	await page.addInitScript(() => {
		new MutationObserver(() => {
			const shown = document.body?.textContent?.match(
				/\d+ symbol\(s\) updated/,
			);
			if (shown) sessionStorage.setItem("refresh-message", shown[0]);
		}).observe(document, {
			subtree: true,
			childList: true,
			characterData: true,
		});
	});
	let refreshed: { status: number; json: unknown } | undefined;
	await page.route("**/api/prices/refresh", async (route) => {
		const response = await route.fetch();
		const body = await response.text();
		refreshed = { status: response.status(), json: JSON.parse(body) };
		await route.fulfill({ response, body });
	});
	await page.goto("/");
	const reloaded = page.waitForEvent("load");
	await page.getByRole("button", { name: "Refresh prices" }).click();
	await reloaded;

	expect(refreshed).toEqual({ status: 200, json: { ok: true, updated: 5 } });
	expect(
		await page.evaluate(() => sessionStorage.getItem("refresh-message")),
	).toBe("5 symbol(s) updated");
	const today = newYorkToday();
	const rows = await withDb(
		(sql) => sql`
			select s.ticker, p.close::text as close, p.source from wishing_wealth_prices_daily p
			join wishing_wealth_symbols s on s.id = p."symbolId" where p.date = ${today} order by s.ticker`,
	);
	expect(rows.map((r) => [r.ticker, r.close, r.source])).toEqual(
		["AAPL", "BRK.B", "MSFT", "NVDA", "ZZZT"].map((t) => [
			t,
			"190.23000000",
			"scraper",
		]),
	);
	const dashboard = await readDashboard(page);
	expect(dashboard.lastUpdate).toBe(today);
	expect(dashboard.current.map((r) => [r[2], r[4]])).toEqual(
		Array(5).fill([usd(190.23), today]),
	);
	const entries = guardLog().slice(before);
	expect(
		entries.filter(
			(e) => e.event === "fixture" && e.url?.includes("/symbols/"),
		),
	).toHaveLength(5);
	expect(guardLog().filter((e) => e.event === "blocked")).toEqual([]);
});

test("B8 a tampered, revoked or expired session cookie shows the signed-out page", async ({
	page,
	request,
}) => {
	const email = allowedEmail();
	const [live, revoked, expired] = await withDb(async (sql) => {
		const make = async (expires: string, revokedAt: string) => {
			const [row] = await sql.unsafe(
				`insert into wishing_wealth_sessions ("userId", "expiresAt", "revokedAt")
				select id, ${expires}, ${revokedAt} from wishing_wealth_users where email = $1 returning id`,
				[email],
			);
			return String(row?.id);
		};
		return [
			await make("now() + interval '1 day'", "null"),
			await make("now() + interval '1 day'", "now()"),
			await make("now() - interval '1 minute'", "null"),
		];
	});
	const good = signSession(live);
	const [id, signature = ""] = good.split(".");
	const tampered = `${id}.${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`;

	// Control: a correctly signed live session shows the dashboard, so the cookies below are well formed.
	await setSessionCookie(page, good);
	await page.goto("/");
	await expect(page.getByText(`Logged in as ${email}`)).toBeVisible();
	for (const value of [tampered, signSession(revoked), signSession(expired)]) {
		await setSessionCookie(page, value);
		await page.goto("/");
		await expectSignedOut(page);
	}
	const refresh = await request.post("/api/prices/refresh", {
		headers: { cookie: `session=${tampered}` },
	});
	expect(refresh.status()).toBe(401);
});

test("B7 with no on-page symbols, the dashboard shows the empty state and 20 historical rows", async ({
	page,
}) => {
	const expected = await withDb(async (sql) => {
		await sql.unsafe(seedFile("seed-empty.sql")).simple();
		const rows = await sql`
			select ticker::text, exchange, "firstSeen"::text, "lastSeen"::text from wishing_wealth_symbols
			where not "isOnPage" order by "lastSeen" desc limit 20`;
		return rows.map((r) => [r.ticker, r.exchange, r.firstSeen, r.lastSeen]);
	});
	await setSessionCookie(page, sessionCookie);
	await page.goto("/");
	const dashboard = await readDashboard(page);
	expect(dashboard).toEqual({
		onPage: "0",
		historical: "22",
		lastUpdate: "Never",
		current: [
			["No tickers currently on the page. Run the cron job to populate."],
		],
		past: expected,
	});
});

test("B12 both email templates render with fixed inputs", async ({ page }) => {
	const text = async (html: string) => {
		await page.setContent(html);
		// biome-ignore lint/performance/useDomNodeTextContent: the visible text, without the hidden preview line
		return clean(await page.locator("body").innerText());
	};
	const otp = await text(
		await render(
			createElement(OneTimePasscodeEmail, { code: "123456", validMinutes: 2 }),
		),
	);
	expect(otp).toContain("Wishing Wealth");
	expect(otp).toContain("123456");
	expect(otp).toContain("This code expires in 2 minutes.");

	const summary = await text(
		await render(
			createElement(StatusEmail, {
				gmiSignal: "GREEN",
				gmiSince: "since close on Nov 26, 2025",
				tickersAdded: [
					{ ticker: "NVDA", exchange: "NASDAQ", type: "added" },
					{ ticker: "BRK.B", exchange: "NYSE", type: "added" },
				],
				tickersRemoved: [{ ticker: "OLDA", exchange: "NYSE", type: "removed" }],
				currentTickers: [
					{ ticker: "AAPL", exchange: "NASDAQ", price: 191.5 },
					{ ticker: "BRK.B", exchange: "NYSE", price: 1234.5 },
					{ ticker: "ZZZT", exchange: "NYSE", price: null },
				],
				runAt: "2025-11-05T21:30:00.000Z",
			}),
		),
	);
	for (const part of [
		"Current GMI Signal",
		"GREEN",
		"since close on Nov 26, 2025",
		"Added (2)",
		"Removed (1)",
		"Current Tickers (3)",
		"$191.50",
		"$1234.50",
		"—",
		"Run at: 2025-11-05T21:30:00.000Z",
	]) {
		expect(summary).toContain(part);
	}
});
