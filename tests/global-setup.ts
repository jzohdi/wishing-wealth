import { resetDatabase } from "./support/local";

// Local runs only (see playwright.config.ts): a fresh migration and seed before every run.
export default async function globalSetup() {
	await resetDatabase();
}
