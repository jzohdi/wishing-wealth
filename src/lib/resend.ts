import { Resend } from "resend";

import { env } from "@/env";
import type { JSX } from "react";

const client = new Resend(env.RESEND_API_KEY);

type SendEmailOptions = {
	from?: string;
	to: string | string[];
	subject: string;
	text?: string;
	html?: string;
	react?: JSX.Element;
};

export async function sendEmail(opts: SendEmailOptions) {
	const from = opts.from ?? env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev";
	const to = Array.isArray(opts.to) ? opts.to : [opts.to];
	const payload: Record<string, unknown> = {
		from,
		to,
		subject: opts.subject,
	};
	if (opts.react) payload.react = opts.react;
	if (opts.html) payload.html = opts.html;
	if (opts.text) payload.text = opts.text;
	const res = await client.emails.send(payload as any);
	if (res.error) {
		throw new Error(res.error.message ?? "Failed to send email");
	}
	return res.data;
}
