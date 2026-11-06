export default {
	// Login codes (src/server/auth/login-code.ts). A code lasts 4 minutes and allows 5 tries; an address gets
	// at most 10 codes a day.
	OTP_TTL_SECONDS: 240,
	OTP_MAX_ATTEMPTS: 5,
	OTP_MAX_SENDS: 10,
	OTP_SEND_WINDOW_HOURS: 24,
	// What the email promises: less than the TTL, so a slow delivery doesn't use up the time.
	OTP_EMAIL_VALID_MINUTES: 2,
	SOURCE_URL: "https://www.wishingwealthblog.com/",
} as const;
