import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { defineConfig } from "@playwright/test";

import {
	baseURL,
	guardLogPath,
	isLocalRun,
	port,
	requireLoopbackEnv,
} from "./tests/support/local";

// Behavior smoke test (checks B1–B14). Two ways to run it:
//
// Local, the default: every check, against a production build and stand-ins.
//   The process env holds the app's env with DUMMY values only. DATABASE_URL points at a throwaway Postgres on this
//   machine (the suite drops and recreates the app's tables there, then loads tests/support/seed.sql), and
//   RESEND_BASE_URL at a free local port, where the suite starts tests/support/resend-stub.mjs.
//   The suite starts `next start` behind tests/support/net-guard.mjs, so nothing leaves the machine.
//     npm run build && PORT=3000 npm run test:smoke
//
// Deployed, read-only: BASE_URL=https://… npm run test:smoke
//   Only the tests tagged @readonly run, and the browser answers every non-GET request itself, so nothing is sent.
//   VERCEL_OIDC_TOKEN, when set, goes to that site's own requests only (a protected preview).
const localServers = () => {
	const stubUrl = new URL(requireLoopbackEnv("RESEND_BASE_URL"));
	requireLoopbackEnv("DATABASE_URL");
	const guard = pathToFileURL(resolve("tests/support/net-guard.mjs")).href;
	return [
		{
			command: `node tests/support/resend-stub.mjs ${stubUrl.port}`,
			url: new URL("/_stub/health", stubUrl).href,
			reuseExistingServer: false,
		},
		{
			command: `npx next start -H 127.0.0.1 -p ${port}`,
			url: `${baseURL}/login`,
			reuseExistingServer: false,
			env: {
				NODE_OPTIONS: `--import=${guard}`,
				WW_GUARD_LOG: guardLogPath,
				WW_GUARD_FIXTURE: resolve(
					"src/server/scrape/examples/trading-view.html",
				),
				NEXT_TELEMETRY_DISABLED: "1",
			},
		},
	];
};

export default defineConfig({
	testDir: "tests",
	reporter: "list",
	// One worker, in file order: the local checks build on each other's database state.
	workers: 1,
	fullyParallel: false,
	grep: isLocalRun ? undefined : /@readonly/,
	globalSetup: isLocalRun ? "./tests/global-setup.ts" : undefined,
	webServer: isLocalRun ? localServers() : undefined,
	use: {
		baseURL,
		// The installed Google Chrome, so no Playwright browser download is needed.
		channel: "chrome",
		serviceWorkers: "block",
	},
});
