import { render } from "@react-email/render";
import { TRPCError } from "@trpc/server";
import { cookies } from "next/headers";
import React from "react";
import { z } from "zod";
import { env } from "@/env";
import { sendEmail } from "@/lib/resend";
import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import { issueLoginCode, redeemLoginCode } from "@/server/auth/login-code";
import { sessionCookie } from "@/server/auth/session";
import constants from "@/server/constants";
import { db } from "@/server/db";
import { sessions } from "@/server/db/schema";
import { OneTimePasscodeEmail } from "../../../../emails/one-time-passcode";

function getClientIpFromHeaders(headers: Headers): string | undefined {
	const xff = headers.get("x-forwarded-for");
	if (xff) return xff.split(",")[0]?.trim();
	const xrip = headers.get("x-real-ip");
	if (xrip) return xrip.trim();
	return undefined;
}

const email = z.email().transform((e) => e.toLowerCase());

function requireAllowed(address: string) {
	if (!env.AUTH_ALLOWED_EMAILS.includes(address)) {
		throw new Error("Email not allowed");
	}
}

export const authRouter = createTRPCRouter({
	sendOtp: publicProcedure
		.input(z.object({ email }))
		.mutation(async ({ input }) => {
			requireAllowed(input.email);
			const code = await issueLoginCode(input.email);
			if (!code) {
				throw new TRPCError({
					code: "TOO_MANY_REQUESTS",
					message: "Too many codes requested. Try again later.",
				});
			}

			const subject = "Your Wishing Wealth login code";
			const html = await render(
				React.createElement(OneTimePasscodeEmail, {
					code,
					validMinutes: constants.OTP_EMAIL_VALID_MINUTES,
				}),
			);
			await sendEmail({ to: input.email, subject, html });
			return { ok: true } as const;
		}),

	verifyOtp: publicProcedure
		.input(z.object({ email, code: z.string().min(1).max(16) }))
		.mutation(async ({ input, ctx }) => {
			requireAllowed(input.email);
			const userId = await redeemLoginCode(input.email, input.code);
			if (!userId) {
				throw new Error("Invalid or expired code");
			}

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
				value: sessionCookie.sign(session.id),
				httpOnly: true,
				secure: env.NODE_ENV === "production",
				sameSite: "lax",
				expires: session.expiresAt,
				path: "/",
			});

			return { ok: true, redirectTo: "/" } as const;
		}),
});
