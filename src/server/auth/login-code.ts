import "server-only";

import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNotNull, lt, sql } from "drizzle-orm";
import { env } from "@/env";
import constants from "@/server/constants";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";

// One-time login codes: random, single use, and stored on the user's row only as an HMAC. Each step is a single
// UPDATE, so parallel requests can't get past the attempt or send limits.

const ttl = sql.raw(`interval '${constants.OTP_TTL_SECONDS} seconds'`);
const sendWindow = sql.raw(
	`interval '${constants.OTP_SEND_WINDOW_HOURS} hours'`,
);

const hashCode = (email: string, code: string) =>
	createHmac("sha256", env.OTP_SECRET).update(`${email}:${code}`).digest("hex");

function sameHash(a: string, b: string): boolean {
	const x = Buffer.from(a, "hex");
	const y = Buffer.from(b, "hex");
	return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Makes a new code for an allowed email and stores it, replacing any earlier one. Returns null, and stores
 * nothing, once the address has had OTP_MAX_SENDS codes in the current send window.
 */
export async function issueLoginCode(email: string): Promise<string | null> {
	await db.insert(users).values({ email }).onConflictDoNothing();
	const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
	const windowOver = sql`(${users.otpSendWindowStart} IS NULL OR ${users.otpSendWindowStart} <= now() - ${sendWindow})`;
	const [row] = await db
		.update(users)
		.set({
			otpCodeHash: hashCode(email, code),
			otpCodeExpiresAt: sql`now() + ${ttl}`,
			otpCodeAttempts: 0,
			otpSendWindowStart: sql`CASE WHEN ${windowOver} THEN now() ELSE ${users.otpSendWindowStart} END`,
			otpSendCount: sql`CASE WHEN ${windowOver} THEN 1 ELSE ${users.otpSendCount} + 1 END`,
		})
		.where(
			and(
				eq(users.email, email),
				sql`(${windowOver} OR ${users.otpSendCount} < ${constants.OTP_MAX_SENDS})`,
			),
		)
		.returning({ id: users.id });
	return row ? code : null;
}

/**
 * Spends one of the pending code's attempts, then compares. On a match the code is used up and the user's id
 * is returned; otherwise (wrong, expired, used up, out of attempts or never sent) null.
 */
export async function redeemLoginCode(
	email: string,
	code: string,
): Promise<string | null> {
	const [pending] = await db
		.update(users)
		.set({ otpCodeAttempts: sql`${users.otpCodeAttempts} + 1` })
		.where(
			and(
				eq(users.email, email),
				isNotNull(users.otpCodeHash),
				gt(users.otpCodeExpiresAt, sql`now()`),
				lt(users.otpCodeAttempts, constants.OTP_MAX_ATTEMPTS),
			),
		)
		.returning({ id: users.id, hash: users.otpCodeHash });
	if (!pending?.hash || !sameHash(hashCode(email, code), pending.hash)) {
		return null;
	}
	const [used] = await db
		.update(users)
		.set({ otpCodeHash: null, otpCodeExpiresAt: null, otpCodeAttempts: 0 })
		.where(and(eq(users.id, pending.id), eq(users.otpCodeHash, pending.hash)))
		.returning({ id: users.id });
	return used?.id ?? null;
}
