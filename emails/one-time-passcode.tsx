import * as React from "react";
import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Preview,
  Section,
  Text,
  Heading,
} from "@react-email/components";

type OneTimePasscodeEmailProps = {
  code: string;
  validMinutes: number;
};

export function OneTimePasscodeEmail({
  code,
  validMinutes,
}: OneTimePasscodeEmailProps) {
  const minutesText =
    validMinutes === 1 ? "1 minute" : `${validMinutes} minutes`;

  return (
    <Html>
      <Head />
      <Preview>Your login code: {code}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={styles.headerSection}>
            <Heading style={styles.brand}>Wishing Wealth</Heading>
            <Text style={styles.subtitle}>Secure sign-in code</Text>
          </Section>

          <Section style={styles.codeSection}>
            <Text style={styles.code}>{code}</Text>
          </Section>

          <Section style={styles.infoSection}>
            <Text style={styles.info}>
              This code expires in {minutesText}. For your security, don’t share
              this code with anyone.
            </Text>
          </Section>

          <Hr style={styles.hr} />
          <Section>
            <Text style={styles.footer}>
              If you didn’t request this code, you can safely ignore this email.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const styles: Record<string, React.CSSProperties> = {
  body: {
    backgroundColor: "#f6f6f6",
    margin: 0,
    padding: 0,
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol'",
  },
  container: {
    maxWidth: 560,
    margin: "32px auto",
    backgroundColor: "#ffffff",
    borderRadius: 12,
    boxShadow: "0 8px 28px rgba(16, 24, 40, 0.08)",
    padding: 28,
  },
  headerSection: {
    textAlign: "center",
    paddingTop: 8,
    paddingBottom: 8,
  },
  brand: {
    margin: 0,
    fontSize: 22,
    lineHeight: "28px",
    color: "#111827",
    letterSpacing: 0.2,
  },
  subtitle: {
    marginTop: 6,
    color: "#6b7280",
    fontSize: 14,
  },
  codeSection: {
    textAlign: "center",
    marginTop: 20,
    marginBottom: 16,
  },
  code: {
    display: "inline-block",
    fontSize: 36,
    letterSpacing: 6,
    fontWeight: 700,
    color: "#111827",
    backgroundColor: "#f3f4f6",
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    padding: "14px 18px",
  },
  infoSection: {
    textAlign: "center",
    marginTop: 4,
    marginBottom: 10,
  },
  info: {
    fontSize: 14,
    color: "#374151",
    lineHeight: "22px",
  },
  hr: {
    borderColor: "#e5e7eb",
    marginTop: 18,
    marginBottom: 14,
  },
  footer: {
    color: "#6b7280",
    fontSize: 12,
    textAlign: "center",
  },
};
