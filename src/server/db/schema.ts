import { sql } from "drizzle-orm";
import {
	customType,
	foreignKey,
	index,
	pgTableCreator,
	uniqueIndex,
} from "drizzle-orm/pg-core";

export const createTable = pgTableCreator((name) => `wishing_wealth_${name}`);

/**
 * Custom types for citext, inet
 */
export const citext = customType<{ data: string }>({
	dataType() {
		return "citext";
	},
});

export const inet = customType<{ data: string }>({
	dataType() {
		return "inet";
	},
});

/**
 * Users & Sessions
 */
export const users = createTable(
	"users",
	(d) => ({
		id: d.uuid().defaultRandom().primaryKey(),
		email: citext().notNull(),
		createdAt: d
			.timestamp({ withTimezone: true })
			.default(sql`CURRENT_TIMESTAMP`)
			.notNull(),
	}),
	(t) => [uniqueIndex("users_email_unique").on(t.email)],
);

export const sessions = createTable(
	"sessions",
	(d) => ({
		id: d.uuid().defaultRandom().primaryKey(),
		userId: d.uuid().notNull(),
		issuedAt: d
			.timestamp({ withTimezone: true })
			.default(sql`CURRENT_TIMESTAMP`)
			.notNull(),
		expiresAt: d.timestamp({ withTimezone: true }).notNull(),
		revokedAt: d.timestamp({ withTimezone: true }),
		userAgent: d.text(),
		ip: inet(),
	}),
	(t) => [
		foreignKey({
			name: "sessions_user_id_users_id_fk",
			columns: [t.userId],
			foreignColumns: [users.id],
		}).onDelete("cascade"),
		index("sessions_active_idx")
			.on(t.userId, t.expiresAt)
			.where(sql`${t.revokedAt} IS NULL`),
	],
);

/**
 * Symbols - Tickers we track from the blog
 * isOnPage: true if the ticker is currently listed on wishingwealthblog.com
 */
export const symbols = createTable(
	"symbols",
	(d) => ({
		id: d
			.bigint({ mode: "bigint" })
			.primaryKey()
			.generatedByDefaultAsIdentity(),
		ticker: citext().notNull(),
		exchange: d.text().notNull(),
		isOnPage: d.boolean().notNull().default(false),
		firstSeen: d.date().default(sql`CURRENT_DATE`),
		lastSeen: d.date().default(sql`CURRENT_DATE`),
	}),
	(t) => [
		uniqueIndex("symbols_ticker_exchange_key").on(t.ticker, t.exchange),
		index("symbols_ticker_idx").on(t.ticker),
		index("symbols_on_page_idx").on(t.isOnPage),
	],
);

/**
 * Daily Prices - Historical price tracking for tickers
 */
export const pricesDaily = createTable(
	"prices_daily",
	(d) => ({
		id: d
			.bigint({ mode: "bigint" })
			.primaryKey()
			.generatedByDefaultAsIdentity(),
		symbolId: d.bigint({ mode: "bigint" }).notNull(),
		date: d.date().notNull(),
		open: d.numeric({ precision: 20, scale: 8 }),
		close: d.numeric({ precision: 20, scale: 8 }),
		adjClose: d.numeric({ precision: 20, scale: 8 }),
		volume: d.bigint({ mode: "bigint" }),
		source: d.text().notNull().default("tradingview"),
		createdAt: d
			.timestamp({ withTimezone: true })
			.default(sql`CURRENT_TIMESTAMP`)
			.notNull(),
	}),
	(t) => [
		foreignKey({
			name: "prices_daily_symbol_id_symbols_id_fk",
			columns: [t.symbolId],
			foreignColumns: [symbols.id],
		}).onDelete("cascade"),
		uniqueIndex("prices_daily_symbol_date_key").on(t.symbolId, t.date),
		index("prices_daily_symbol_date_desc_idx").on(t.symbolId, t.date),
	],
);
