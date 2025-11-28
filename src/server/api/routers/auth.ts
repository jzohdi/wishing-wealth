import { createHmac } from "crypto";

import { z } from "zod";

import { env } from "@/env";
import { sendEmail } from "@/lib/resend";
import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import constants from "@/server/constants";
import { db } from "@/server/db";
import { sessions, users } from "@/server/db/schema";
import { render } from "@react-email/render";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import React from "react";
import { OneTimePasscodeEmail } from "../../../../emails/one-time-passcode";

function base64UrlEncode(input: Buffer | string) {
	const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
	return buf
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

function signSessionId(sessionId: string): string {
	const mac = createHmac("sha256", env.SESSION_SECRET)
		.update(sessionId)
		.digest();
	return `${sessionId}.${base64UrlEncode(mac)}`;
}

function getClientIpFromHeaders(headers: Headers): string | undefined {
	const xff = headers.get("x-forwarded-for");
	if (xff) return xff.split(",")[0]?.trim();
	const xrip = headers.get("x-real-ip");
	if (xrip) return xrip.trim();
	return undefined;
}

function padStartDigits(num: number, digits: number): string {
	const s = num.toString();
	return s.length >= digits ? s : "0".repeat(digits - s.length) + s;
}

function generateTotpCode(
	secret: string | Buffer,
	stepSeconds: number,
	digits: number,
	timeMs: number,
): string {
	let counter = Math.floor(timeMs / 1000 / stepSeconds);
	const buf = Buffer.alloc(8);
	// big-endian 8-byte counter (we only use lower 32 bits here, which is sufficient for many years)
	for (let i = 7; i >= 0; i--) {
		buf[i] = counter & 0xff;
		counter = Math.floor(counter / 256);
	}
	const key = typeof secret === "string" ? Buffer.from(secret, "utf8") : secret;
	const hmac = createHmac("sha1", key).update(buf).digest();
	const offset = (hmac[hmac.length - 1] ?? 0) & 0xf;
	const o0 = hmac[offset] ?? 0;
	const o1 = hmac[offset + 1] ?? 0;
	const o2 = hmac[offset + 2] ?? 0;
	const o3 = hmac[offset + 3] ?? 0;
	const binCode =
		((o0 & 0x7f) << 24) |
		((o1 & 0xff) << 16) |
		((o2 & 0xff) << 8) |
		(o3 & 0xff);
	const otp = binCode % 10 ** digits;
	return padStartDigits(otp, digits);
}

// Removed legacy fetch-based sender; using Resend SDK helper instead

function derivePerEmailKey(emailLowercase: string): Buffer {
	// Derive a per-email key so different emails never share the same code window
	// key = HMAC(OTP_SECRET, lowercase(email))
	return createHmac("sha1", Buffer.from(env.OTP_SECRET, "utf8"))
		.update(emailLowercase)
		.digest();
}

export const authRouter = createTRPCRouter({
	sendOtp: publicProcedure
		.input(
			z.object({
				email: z
					.string()
					.email()
					.transform((e) => e.toLowerCase()),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const allowed = env.AUTH_ALLOWED_EMAILS;
			if (!allowed.includes(input.email)) {
				throw new Error("Email not allowed");
			}

			const perEmailKey = derivePerEmailKey(input.email);
			const code = generateTotpCode(
				perEmailKey,
				constants.OTP_STEP_SECONDS,
				constants.OTP_DIGITS,
				Date.now(),
			);

			const subject = "Your Wishing Wealth login code";
			const html = await render(
				React.createElement(OneTimePasscodeEmail, {
					code,
					validMinutes: Math.round(constants.OTP_STEP_SECONDS / 60),
				}),
			);
			await sendEmail({ to: input.email, subject, html });
			return { ok: true } as const;
		}),

	verifyOtp: publicProcedure
		.input(
			z.object({
				email: z
					.string()
					.email()
					.transform((e) => e.toLowerCase()),
				code: z.string().min(1),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const allowed = env.AUTH_ALLOWED_EMAILS;
			if (!allowed.includes(input.email)) {
				throw new Error("Email not allowed");
			}

			const now = Date.now();
			const perEmailKey = derivePerEmailKey(input.email);
			const validCodes = [
				generateTotpCode(
					perEmailKey,
					constants.OTP_STEP_SECONDS,
					constants.OTP_DIGITS,
					now - constants.OTP_STEP_SECONDS * 1000,
				),
				generateTotpCode(
					perEmailKey,
					constants.OTP_STEP_SECONDS,
					constants.OTP_DIGITS,
					now,
				),
				generateTotpCode(
					perEmailKey,
					constants.OTP_STEP_SECONDS,
					constants.OTP_DIGITS,
					now + constants.OTP_STEP_SECONDS * 1000,
				),
			];
			if (!validCodes.includes(input.code)) {
				throw new Error("Invalid or expired code");
			}

			// Upsert user
			const inserted = await db
				.insert(users)
				.values({ email: input.email })
				.onConflictDoNothing()
				.returning({ id: users.id });

			let userId = inserted[0]?.id;
			if (!userId) {
				const fetched = await db
					.select({ id: users.id })
					.from(users)
					.where(eq(users.email, input.email))
					.limit(1);
				userId = fetched[0]?.id;
			}
			if (!userId) throw new Error("Failed to create user");

			const ua = ctx.headers.get("user-agent") ?? undefined;
			const ip = getClientIpFromHeaders(ctx.headers);
			const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

			const created = await db
				.insert(sessions)
				.values({ userId, expiresAt, userAgent: ua, ip })
				.returning({ id: sessions.id, expiresAt: sessions.expiresAt });

			const session = created[0];
			if (!session) throw new Error("Failed to create session");

			// Set cookie
			const cookieStore = await cookies();
			cookieStore.set({
				name: "session",
				value: signSessionId(session.id),
				httpOnly: true,
				secure: env.NODE_ENV === "production",
				sameSite: "lax",
				expires: session.expiresAt,
				path: "/",
			});

			return { ok: true, redirectTo: "/" } as const;
		}),
});
