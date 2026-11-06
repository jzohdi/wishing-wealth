// Helpers for the smoke test's local-only checks: the run's settings, the throwaway database, the Resend stub,
// the network guard's log, the app's session signing (src/server/auth/session.ts), so the test can sign
// cookies, and the old stateless login codes, which must no longer work.
// Local runs read the app's env from the process env, and it must hold DUMMY values only.
import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isLoopbackUrl(url: string): boolean {
	try {
		return LOOPBACK.has(new URL(url).hostname);
	} catch {
		return false;
	}
}

export const port = Number(process.env.PORT ?? 3000);
export const baseURL = process.env.BASE_URL ?? `http://localhost:${port}`;
// Without BASE_URL, the suite starts the app itself against the stand-ins. With one, it's a deployed site.
export const isLocalRun = isLoopbackUrl(baseURL);

// One log file per run. playwright.config.ts sets the id once; the workers inherit it.
process.env.WW_SMOKE_RUN_ID ??= String(Date.now());
export const guardLogPath = join(
	tmpdir(),
	`wishing-wealth-smoke-${process.env.WW_SMOKE_RUN_ID}-net-guard.log`,
);

export function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`${name} must be set for a local smoke test`);
	return value;
}

// Refuses anything but loopback: the suite drops tables, and sign-in sends email.
export function requireLoopbackEnv(name: string): string {
	const value = requireEnv(name);
	if (!isLoopbackUrl(value)) {
		throw new Error(`${name} must point at this machine for a local run`);
	}
	return value;
}

// ---------- database ----------

const SMOKE_APP_NAME = "wishing-wealth-smoke";

export function connect() {
	return postgres(requireLoopbackEnv("DATABASE_URL"), {
		max: 1,
		onnotice: () => {},
		connection: { application_name: SMOKE_APP_NAME },
	});
}

export async function withDb<T>(
	fn: (sql: postgres.Sql) => Promise<T>,
): Promise<T> {
	const sql = connect();
	try {
		return await fn(sql);
	} finally {
		await sql.end();
	}
}

export const seedFile = (name: "seed.sql" | "seed-empty.sql") =>
	readFileSync(join(import.meta.dirname, name), "utf8");

// Drop the app's tables, apply the committed migration as the app's deploys do, then load the seed.
export async function resetDatabase() {
	await withDb(async (sql) => {
		await sql
			.unsafe(`
				DROP TABLE IF EXISTS wishing_wealth_prices_daily, wishing_wealth_sessions,
					wishing_wealth_symbols, wishing_wealth_users CASCADE;
				DROP SCHEMA IF EXISTS drizzle CASCADE;
				CREATE EXTENSION IF NOT EXISTS citext;
			`)
			.simple();
		await migrate(drizzle(sql), { migrationsFolder: "drizzle" });
		await sql.unsafe(seedFile("seed.sql")).simple();
	});
}

export const countUsersAndSessions = () =>
	withDb(async (sql) => {
		const [row] = await sql<{ users: number; sessions: number }[]>`
			select (select count(*) from wishing_wealth_users)::int as users,
				(select count(*) from wishing_wealth_sessions)::int as sessions`;
		return row;
	});

// The allowed addresses, in AUTH_ALLOWED_EMAILS order.
export const allowedEmails = () => requireEnv("AUTH_ALLOWED_EMAILS").split(",");

export const sessionsFor = (email: string) =>
	withDb(async (sql) => {
		const [row] = await sql<{ n: number }[]>`
			select count(*)::int as n from wishing_wealth_sessions s
			join wishing_wealth_users u on u.id = s."userId" where u.email = ${email}`;
		return row?.n;
	});

export const loginCodeState = (email: string) =>
	withDb(async (sql) => {
		const [row] = await sql<
			{ pending: boolean; attempts: number; sends: number }[]
		>`
			select "otpCodeHash" is not null as pending, "otpCodeAttempts" as attempts, "otpSendCount" as sends
			from wishing_wealth_users where email = ${email}`;
		return row;
	});

// Runs SQL against one user's row, e.g. to move a code's expiry or the send window into the past.
export const updateUser = (email: string, set: string) =>
	withDb((sql) =>
		sql.unsafe(`update wishing_wealth_users set ${set} where email = $1`, [
			email,
		]),
	);

// No pending code, no sends in the window and no sessions for that address.
export async function resetLoginState(email: string) {
	await updateUser(
		email,
		`"otpCodeHash" = null, "otpCodeExpiresAt" = null, "otpCodeAttempts" = 0,
		"otpSendWindowStart" = null, "otpSendCount" = 0`,
	);
	await withDb(
		(sql) => sql`
			delete from wishing_wealth_sessions
			where "userId" in (select id from wishing_wealth_users where email = ${email})`,
	);
}

// Connections to the app's database from anything but this suite: 0 proves the app never queried it.
export const appConnections = () =>
	withDb(async (sql) => {
		const [row] = await sql<{ n: number }[]>`
			select count(*)::int as n from pg_stat_activity
			where datname = current_database() and application_name <> ${SMOKE_APP_NAME}`;
		return row?.n;
	});

// ---------- Resend stub and network guard ----------

export type StubEmail = {
	id: string;
	to: string[] | string | null;
	from: string | null;
	subject: string | null;
	html: string | null;
	bearer: boolean;
};

export async function stubEmails(): Promise<StubEmail[]> {
	const res = await fetch(
		new URL("/_stub/emails", requireLoopbackEnv("RESEND_BASE_URL")),
	);
	return (await res.json()) as StubEmail[];
}

// An email's HTML without React's <!-- --> text separators.
export const emailHtml = (email: StubEmail | undefined) =>
	(email?.html ?? "").replace(/<!--.*?-->/g, "");

// The code in the email's preview line ("Your login code: 123456").
export const codeFromEmail = (email: StubEmail | undefined) =>
	/Your login code: (\d{6})/.exec(emailHtml(email))?.[1] ?? null;

export type GuardEntry = { event: string; pid: number; url?: string };

export function guardLog(): GuardEntry[] {
	if (!existsSync(guardLogPath)) return [];
	return readFileSync(guardLogPath, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as GuardEntry);
}

// ---------- the app's algorithms, with the dummy secrets ----------

const base64Url = (buf: Buffer) =>
	buf
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");

export const signSession = (sessionId: string) =>
	`${sessionId}.${base64Url(
		createHmac("sha256", requireEnv("SESSION_SECRET"))
			.update(sessionId)
			.digest(),
	)}`;

function totp(key: Buffer, timeMs: number): string {
	let counter = Math.floor(timeMs / 1000 / 120);
	const buf = Buffer.alloc(8);
	for (let i = 7; i >= 0; i--) {
		buf[i] = counter & 0xff;
		counter = Math.floor(counter / 256);
	}
	const mac = createHmac("sha1", key).update(buf).digest();
	const offset = (mac.at(-1) ?? 0) & 0xf;
	return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(
		6,
		"0",
	);
}

// The codes the old stateless scheme (before stored login codes) accepted right now: an HMAC-SHA1 TOTP of a
// per-address key, for the previous, current and next 120 s step.
export function oldTotpCodes(email: string, now = Date.now()): string[] {
	const key = createHmac("sha1", Buffer.from(requireEnv("OTP_SECRET"), "utf8"))
		.update(email.toLowerCase())
		.digest();
	return [-1, 0, 1].map((step) => totp(key, now + step * 120_000));
}

// Today's date in New York, which is the date the app gives refreshed prices.
export const newYorkToday = () =>
	new Intl.DateTimeFormat("en-CA", {
		timeZone: "America/New_York",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(new Date());
