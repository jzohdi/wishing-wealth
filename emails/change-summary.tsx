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
import * as React from "react";

type PlanItem = {
  ticker: string;
  action: "BUY" | "SELL" | "HOLD";
  qtyDelta: number;
  price: number;
};

export function ChangeSummaryEmail({
  plan,
  runAt,
}: {
  plan: PlanItem[];
  runAt: string;
}) {
  const actionable = plan.filter(
    (p) => p.action !== "HOLD" && Math.abs(p.qtyDelta) > 1e-9
  );
  const buys = actionable.filter((p) => p.action === "BUY");
  const sells = actionable.filter((p) => p.action === "SELL");
  const buyNotional = buys.reduce(
    (s, p) => s + Math.abs(p.qtyDelta) * p.price,
    0
  );
  const sellNotional = sells.reduce(
    (s, p) => s + Math.abs(p.qtyDelta) * p.price,
    0
  );

  return (
    <Html>
      <Head />
      <Preview>
        Wishing Wealth: {String(actionable.length)} change
        {actionable.length === 1 ? "" : "s"} applied
      </Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Heading style={styles.heading}>Rebalance summary</Heading>
          <Text style={styles.meta}>Run at: {runAt}</Text>

          <Section style={styles.section}>
            <Text style={styles.kpis}>
              Buys: <strong>{buys.length}</strong> (${buyNotional.toFixed(2)}) ·
              Sells: <strong>{sells.length}</strong> (${sellNotional.toFixed(2)}
              )
            </Text>
          </Section>

          <Hr style={styles.hr} />

          {actionable.length === 0 ? (
            <Text style={styles.empty}>No changes were applied.</Text>
          ) : (
            <Section>
              {actionable.map((p, idx) => (
                <Section key={idx} style={styles.row}>
                  <Text style={styles.rowText}>
                    <span style={p.action === "BUY" ? styles.buy : styles.sell}>
                      {p.action}
                    </span>
                    <span style={styles.ticker}>{p.ticker}</span>
                    <span style={styles.detail}>
                      Qty: {p.qtyDelta.toFixed(6)}
                    </span>
                    <span style={styles.detail}>
                      Price: ${p.price.toFixed(2)}
                    </span>
                    <span style={styles.detail}>
                      Notional: ${(Math.abs(p.qtyDelta) * p.price).toFixed(2)}
                    </span>
                  </Text>
                </Section>
              ))}
            </Section>
          )}
        </Container>
      </Body>
    </Html>
  );
}

const emerald = "#10b981";
const slate900 = "#0f172a";
const slate600 = "#475569";

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
    padding: "20px 20px 8px 20px",
    maxWidth: "640px",
    margin: "0 auto",
  } as React.CSSProperties,
  heading: {
    color: emerald,
    fontSize: "22px",
    margin: "0 0 6px 0",
  } as React.CSSProperties,
  meta: {
    color: slate600,
    fontSize: "12px",
    margin: "0 0 16px 0",
  } as React.CSSProperties,
  section: {
    margin: "8px 0 12px 0",
  } as React.CSSProperties,
  kpis: {
    color: "#cbd5e1",
    fontSize: "14px",
    margin: 0,
  } as React.CSSProperties,
  hr: {
    borderColor: slate900,
    margin: "12px 0",
  } as React.CSSProperties,
  empty: {
    color: slate600,
    fontSize: "14px",
  } as React.CSSProperties,
  row: {
    margin: "0 0 8px 0",
  } as React.CSSProperties,
  rowText: {
    fontSize: "14px",
    color: "#e5e7eb",
    margin: 0,
  } as React.CSSProperties,
  buy: {
    color: emerald,
    fontWeight: 700,
    marginRight: 8,
  } as React.CSSProperties,
  sell: {
    color: "#f87171",
    fontWeight: 700,
    marginRight: 8,
  } as React.CSSProperties,
  ticker: {
    fontWeight: 700,
    marginRight: 12,
  } as React.CSSProperties,
  detail: {
    marginRight: 12,
    color: "#cbd5e1",
  } as React.CSSProperties,
};

export default ChangeSummaryEmail;
