// Stand-in for Resend's API, for the smoke test. The app's Resend SDK reaches it through RESEND_BASE_URL.
// It binds 127.0.0.1 only, keeps what it receives in memory and never forwards anything.
//   POST /emails        records {to, from, subject, html, bearer} and answers {"id": "stub-<n>"}, as Resend does
//   GET  /_stub/emails  the recorded emails, oldest first
//   GET  /_stub/health  {"ok": true}
// usage: node tests/support/resend-stub.mjs <port>
import { createServer } from "node:http";

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port <= 0) {
	console.error("usage: node tests/support/resend-stub.mjs <port>");
	process.exit(2);
}

const emails = [];

function reply(res, status, body) {
	res.writeHead(status, { "content-type": "application/json" });
	res.end(JSON.stringify(body));
}

createServer((req, res) => {
	const chunks = [];
	req.on("data", (chunk) => chunks.push(chunk));
	req.on("end", () => {
		const path = new URL(req.url ?? "/", "http://stub").pathname;
		if (req.method === "GET" && path === "/_stub/health") {
			return reply(res, 200, { ok: true });
		}
		if (req.method === "GET" && path === "/_stub/emails") {
			return reply(res, 200, emails);
		}
		if (req.method === "POST" && path === "/emails") {
			let payload = {};
			try {
				payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
			} catch {
				// recorded with empty fields, so the test sees the bad request
			}
			const id = `stub-${emails.length + 1}`;
			emails.push({
				id,
				to: payload.to ?? null,
				from: payload.from ?? null,
				subject: payload.subject ?? null,
				html: payload.html ?? null,
				// Whether the SDK sent its API key, never the key itself.
				bearer: (req.headers.authorization ?? "").startsWith("Bearer "),
			});
			return reply(res, 200, { id });
		}
		console.error(`[resend-stub] unexpected ${req.method} ${path}`);
		return reply(res, 404, {
			name: "not_found",
			message: "resend stub: unexpected route",
			statusCode: 404,
		});
	});
}).listen(port, "127.0.0.1", () => {
	console.log(`[resend-stub] listening on 127.0.0.1:${port}`);
});
