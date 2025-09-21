import "server-only";

import { createHmac, timingSafeEqual } from "crypto";

import { env } from "@/env";
import { db } from "@/server/db";
import { sessions, users } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";

function base64UrlEncode(input: Buffer | string) {
    const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
    return buf
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}

function base64UrlDecode(input: string): Buffer {
    const pad = input.length % 4 === 0 ? 0 : 4 - (input.length % 4);
    const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
    return Buffer.from(b64, "base64");
}

function signSessionId(sessionId: string): string {
    const mac = createHmac("sha256", env.SESSION_SECRET)
        .update(sessionId)
        .digest();
    return `${sessionId}.${base64UrlEncode(mac)}`;
}

function verifySessionCookie(cookieVal: string): string | null {
    const idx = cookieVal.lastIndexOf(".");
    if (idx <= 0) return null;
    const id = cookieVal.slice(0, idx);
    const sig = cookieVal.slice(idx + 1);
    if (!id || !sig) return null;
    const expected = createHmac("sha256", env.SESSION_SECRET).update(id)
        .digest();
    const provided = base64UrlDecode(sig);
    if (expected.length !== provided.length) return null;
    const ok = timingSafeEqual(expected, provided);
    return ok ? id : null;
}

export async function getCurrentUser() {
    const cookieStore = await cookies();
    const raw = cookieStore.get("session")?.value;
    if (!raw) return null;
    const sessionId = verifySessionCookie(raw);
    if (!sessionId) return null;

    const now = new Date();
    const sess = await db
        .select({ id: sessions.id, userId: sessions.userId })
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1);

    const s0 = sess[0];
    if (!s0) return null;
    // Validate expiry/revocation in JS to avoid multiple where chains
    const valid = (!s0 as any) ? false : true;
    // fetch full row to check
    const full = await db
        .select({
            id: sessions.id,
            userId: sessions.userId,
            revokedAt: sessions.revokedAt,
            expiresAt: sessions.expiresAt,
        })
        .from(sessions)
        .where(eq(sessions.id, s0.id))
        .limit(1);
    const srow = full[0];
    if (!srow) return null;
    if (srow.revokedAt !== null) return null;
    if (new Date(srow.expiresAt) <= now) return null;
    const s = srow;

    const u = await db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.id, s.userId))
        .limit(1);

    return u[0] ?? null;
}

export const sessionCookie = {
    sign: signSessionId,
    verify: verifySessionCookie,
} as const;
