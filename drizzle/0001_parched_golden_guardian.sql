ALTER TABLE "wishing_wealth_users" ADD COLUMN "otpCodeHash" text;--> statement-breakpoint
ALTER TABLE "wishing_wealth_users" ADD COLUMN "otpCodeExpiresAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "wishing_wealth_users" ADD COLUMN "otpCodeAttempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "wishing_wealth_users" ADD COLUMN "otpSendWindowStart" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "wishing_wealth_users" ADD COLUMN "otpSendCount" integer DEFAULT 0 NOT NULL;