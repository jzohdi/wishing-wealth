export default {
    OTP_STEP_SECONDS: 120,
    OTP_DIGITS: 6,
    STARTING_CASH: 10000,
    SOURCE_URL: "https://www.wishingwealthblog.com/",
    // Stop-loss: sell if latest price is below this multiple of avg cost
    // Example: 0.95 = 5% below average cost
    STOP_LOSS_MULTIPLIER: 0.95,
    // Cooldown to prevent immediate re-entry after a stop-loss (days)
    REENTRY_COOLDOWN_DAYS: 10,
} as const;
