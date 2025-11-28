import {
	Body,
	Container,
	Head,
	Heading,
	Hr,
	Html,
	Preview,
	Section,
	Text,
} from "@react-email/components";
import type * as React from "react";

type GmiSignal = "GREEN" | "RED" | null;

type TickerChange = {
	ticker: string;
	exchange: string;
	type: "added" | "removed";
};

type TickerWithPrice = {
	ticker: string;
	exchange: string;
	price: number | null;
};

export function StatusEmail({
	gmiSignal,
	gmiSince,
	tickersAdded,
	tickersRemoved,
	currentTickers,
	runAt,
}: {
	gmiSignal: GmiSignal;
	gmiSince: string | null;
	tickersAdded: TickerChange[];
	tickersRemoved: TickerChange[];
	currentTickers: TickerWithPrice[];
	runAt: string;
}) {
	const hasChanges = tickersAdded.length > 0 || tickersRemoved.length > 0;

	return (
		<Html>
			<Head />
			<Preview>
				GMI: {gmiSignal ?? "UNKNOWN"}
				{hasChanges
					? ` | ${tickersAdded.length} added, ${tickersRemoved.length} removed`
					: ""}
			</Preview>
			<Body style={styles.body}>
				<Container style={styles.container}>
					{/* GMI Signal Section */}
					<Section style={styles.gmiSection}>
						<Heading style={styles.heading}>Current GMI Signal</Heading>
						<Text
							style={{
								...styles.gmiValue,
								color: gmiSignal === "GREEN" ? emerald : red,
							}}
						>
							{gmiSignal ?? "UNKNOWN"}
						</Text>
						{gmiSince && <Text style={styles.gmiSince}>{gmiSince}</Text>}
					</Section>

					<Hr style={styles.hr} />

					{/* Ticker Changes Section */}
					{hasChanges ? (
						<Section style={styles.section}>
							<Heading as="h2" style={styles.subheading}>
								Ticker Changes
							</Heading>

							{tickersAdded.length > 0 && (
								<Section style={styles.changeSection}>
									<Text style={styles.changeTitle}>
										➕ Added ({tickersAdded.length})
									</Text>
									{tickersAdded.map((t) => (
										<Text
											key={`${t.ticker}::${t.exchange}`}
											style={styles.tickerRow}
										>
											<span style={styles.tickerAdded}>{t.ticker}</span>
											<span style={styles.exchange}>{t.exchange}</span>
										</Text>
									))}
								</Section>
							)}

							{tickersRemoved.length > 0 && (
								<Section style={styles.changeSection}>
									<Text style={styles.changeTitle}>
										➖ Removed ({tickersRemoved.length})
									</Text>
									{tickersRemoved.map((t) => (
										<Text
											key={`${t.ticker}::${t.exchange}`}
											style={styles.tickerRow}
										>
											<span style={styles.tickerRemoved}>{t.ticker}</span>
											<span style={styles.exchange}>{t.exchange}</span>
										</Text>
									))}
								</Section>
							)}
						</Section>
					) : (
						<Section style={styles.section}>
							<Text style={styles.noChanges}>No ticker changes detected.</Text>
						</Section>
					)}

					<Hr style={styles.hr} />

					{/* Current Tickers Section */}
					<Section style={styles.section}>
						<Heading as="h2" style={styles.subheading}>
							Current Tickers ({currentTickers.length})
						</Heading>
						{currentTickers.length === 0 ? (
							<Text style={styles.noChanges}>No tickers on page.</Text>
						) : (
							<Section style={styles.tickerGrid}>
								{currentTickers.map((t) => (
									<Text
										key={`${t.ticker}::${t.exchange}`}
										style={styles.tickerItem}
									>
										<span style={styles.tickerName}>{t.ticker}</span>
										<span style={styles.tickerPrice}>
											{t.price != null ? `$${t.price.toFixed(2)}` : "—"}
										</span>
									</Text>
								))}
							</Section>
						)}
					</Section>

					<Hr style={styles.hr} />

					<Text style={styles.meta}>Run at: {runAt}</Text>
				</Container>
			</Body>
		</Html>
	);
}

const emerald = "#10b981";
const red = "#ef4444";
const slate900 = "#0f172a";
const slate600 = "#475569";
const slate400 = "#94a3b8";

const styles = {
	body: {
		backgroundColor: "#0a0f1a",
		color: "#e5e7eb",
		fontFamily:
			"ui-sans-serif, -apple-system, Segoe UI, Roboto, Helvetica, Arial, Noto Sans, Apple Color Emoji, Segoe UI Emoji",
		padding: "24px",
	} as React.CSSProperties,
	container: {
		backgroundColor: "#0b1220",
		border: `1px solid ${slate900}`,
		borderRadius: "12px",
		padding: "24px",
		maxWidth: "640px",
		margin: "0 auto",
	} as React.CSSProperties,
	gmiSection: {
		textAlign: "center" as const,
		marginBottom: "16px",
	} as React.CSSProperties,
	heading: {
		color: "#e5e7eb",
		fontSize: "18px",
		fontWeight: 600,
		margin: "0 0 8px 0",
	} as React.CSSProperties,
	gmiValue: {
		fontSize: "48px",
		fontWeight: 800,
		margin: "0",
		letterSpacing: "2px",
	} as React.CSSProperties,
	gmiSince: {
		color: slate400,
		fontSize: "14px",
		margin: "8px 0 0 0",
	} as React.CSSProperties,
	hr: {
		borderColor: slate900,
		margin: "20px 0",
	} as React.CSSProperties,
	section: {
		margin: "16px 0",
	} as React.CSSProperties,
	subheading: {
		color: "#cbd5e1",
		fontSize: "16px",
		fontWeight: 600,
		margin: "0 0 12px 0",
	} as React.CSSProperties,
	changeSection: {
		marginBottom: "16px",
	} as React.CSSProperties,
	changeTitle: {
		color: "#e5e7eb",
		fontSize: "14px",
		fontWeight: 600,
		margin: "0 0 8px 0",
	} as React.CSSProperties,
	tickerRow: {
		fontSize: "14px",
		margin: "4px 0",
		color: "#e5e7eb",
	} as React.CSSProperties,
	tickerAdded: {
		color: emerald,
		fontWeight: 700,
		marginRight: "8px",
	} as React.CSSProperties,
	tickerRemoved: {
		color: red,
		fontWeight: 700,
		marginRight: "8px",
	} as React.CSSProperties,
	exchange: {
		color: slate400,
		fontSize: "12px",
	} as React.CSSProperties,
	noChanges: {
		color: slate600,
		fontSize: "14px",
		fontStyle: "italic",
	} as React.CSSProperties,
	tickerGrid: {
		display: "flex",
		flexWrap: "wrap" as const,
		gap: "8px",
	} as React.CSSProperties,
	tickerItem: {
		backgroundColor: "#1e293b",
		borderRadius: "6px",
		padding: "8px 12px",
		fontSize: "13px",
		margin: "4px 0",
		display: "inline-block",
	} as React.CSSProperties,
	tickerName: {
		fontWeight: 700,
		color: "#e5e7eb",
		marginRight: "8px",
	} as React.CSSProperties,
	tickerPrice: {
		color: slate400,
	} as React.CSSProperties,
	meta: {
		color: slate600,
		fontSize: "12px",
		margin: "0",
		textAlign: "center" as const,
	} as React.CSSProperties,
};

export default StatusEmail;
