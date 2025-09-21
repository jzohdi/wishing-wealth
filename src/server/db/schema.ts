// Example model schema from the Drizzle docs
// https://orm.drizzle.team/docs/sql-schema-declaration

import { sql } from "drizzle-orm";
import {
	customType,
	foreignKey,
	index,
	pgTableCreator,
	uniqueIndex,
} from "drizzle-orm/pg-core";

export const createTable = pgTableCreator((name) => `wishing_wealth_${name}`);

/* Unused enums removed for MVP minimal design */

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
		userId: d
			.uuid()
			.notNull(),
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
		index("sessions_active_idx").on(t.userId, t.expiresAt).where(
			sql`${t.revokedAt} IS NULL`,
		),
	],
);

/**
 * Symbols & Mappings
 */
export const symbols = createTable(
	"symbols",
	(d) => ({
		id: d.bigint({ mode: "bigint" }).primaryKey()
			.generatedByDefaultAsIdentity(),
		ticker: citext().notNull(),
		exchange: d.text().notNull(),
		isActive: d.boolean().notNull().default(true),
		firstSeen: d.date().default(sql`CURRENT_DATE`),
	}),
	(t) => [
		uniqueIndex("symbols_ticker_exchange_key").on(t.ticker, t.exchange),
		index("symbols_ticker_idx").on(t.ticker),
	],
);

/**
 * Daily Prices
 */
export const pricesDaily = createTable(
	"prices_daily",
	(d) => ({
		id: d.bigint({ mode: "bigint" }).primaryKey()
			.generatedByDefaultAsIdentity(),
		symbolId: d
			.bigint({ mode: "bigint" })
			.notNull(),
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

/* Scraping snapshot and ticker set tracking tables removed for MVP */

/**
 * Portfolio domain: portfolios, positions
 */
export const portfolios = createTable(
	"portfolios",
	(d) => ({
		id: d.uuid().defaultRandom().primaryKey(),
		userId: d
			.uuid()
			.notNull(),
		name: d.text().notNull().default("Main"),
		baseCurrency: d.text().notNull().default("USD"),
		initialCash: d.numeric({ precision: 20, scale: 8 }).notNull().default(
			"0",
		),
		cashCurrent: d.numeric({ precision: 20, scale: 8 }).notNull().default(
			"0",
		),
		createdAt: d
			.timestamp({ withTimezone: true })
			.default(sql`CURRENT_TIMESTAMP`)
			.notNull(),
	}),
	(t) => [
		foreignKey({
			name: "portfolios_user_id_users_id_fk",
			columns: [t.userId],
			foreignColumns: [users.id],
		}).onDelete("cascade"),
		index("portfolios_user_idx").on(t.userId),
	],
);

export const positions = createTable(
	"positions",
	(d) => ({
		id: d.uuid().defaultRandom().primaryKey(),
		portfolioId: d
			.uuid()
			.notNull(),
		symbolId: d
			.bigint({ mode: "bigint" })
			.notNull(),
		qty: d.numeric({ precision: 20, scale: 8 }).notNull(),
		avgCost: d.numeric({ precision: 20, scale: 8 }).notNull(),
		openedAt: d
			.timestamp({ withTimezone: true })
			.default(sql`CURRENT_TIMESTAMP`)
			.notNull(),
		closedAt: d.timestamp({ withTimezone: true }),
		realizedPnl: d.numeric({ precision: 20, scale: 8 }).notNull().default(
			"0",
		),
	}),
	(t) => [
		foreignKey({
			name: "positions_portfolio_id_portfolios_id_fk",
			columns: [t.portfolioId],
			foreignColumns: [portfolios.id],
		}).onDelete("cascade"),
		foreignKey({
			name: "positions_symbol_id_symbols_id_fk",
			columns: [t.symbolId],
			foreignColumns: [symbols.id],
		}).onDelete("restrict"),
		uniqueIndex("positions_open_unique").on(t.portfolioId, t.symbolId)
			.where(sql`${t.closedAt} IS NULL`),
		index("positions_portfolio_closed_idx").on(t.portfolioId, t.closedAt),
	],
);

/* Order/fill audit tables removed for MVP; rebalancing updates positions directly */

export const portfolioValues = createTable(
	"portfolio_values",
	(d) => ({
		id: d.bigint({ mode: "bigint" }).primaryKey()
			.generatedByDefaultAsIdentity(),
		portfolioId: d
			.uuid()
			.notNull(),
		date: d.date().notNull(),
		equity: d.numeric({ precision: 20, scale: 8 }).notNull(),
		cash: d.numeric({ precision: 20, scale: 8 }).notNull(),
		pnlDay: d.numeric({ precision: 20, scale: 8 }).notNull(),
		pnlTotal: d.numeric({ precision: 20, scale: 8 }).notNull(),
		createdAt: d
			.timestamp({ withTimezone: true })
			.default(sql`CURRENT_TIMESTAMP`)
			.notNull(),
	}),
	(t) => [
		foreignKey({
			name: "portfolio_values_portfolio_id_portfolios_id_fk",
			columns: [t.portfolioId],
			foreignColumns: [portfolios.id],
		}).onDelete("cascade"),
		uniqueIndex("portfolio_values_unique_day").on(t.portfolioId, t.date),
		index("portfolio_values_portfolio_date_idx").on(t.portfolioId, t.date),
	],
);
