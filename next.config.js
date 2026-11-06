/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";

/** @type {import("next").NextConfig} */
const config = {
	// Otherwise `next dev` writes an AGENTS.md whenever it detects a coding agent.
	agentRules: false,
};

export default config;
