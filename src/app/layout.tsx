import "@/styles/globals.css";

import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { connection } from "next/server";

import { TRPCReactProvider } from "@/trpc/react";

export const metadata: Metadata = {
	title: "Wishing Wealth Mock",
	description: "Mock trial of how using wishing wealth blog would work",
	icons: [{ rel: "icon", url: "/favicon.ico" }],
};

const geist = Geist({
	subsets: ["latin"],
	variable: "--font-geist-sans",
});

export default async function RootLayout({
	children,
}: Readonly<{ children: React.ReactNode }>) {
	// Render every page per request, so each gets the nonce from src/proxy.ts's Content-Security-Policy.
	await connection();
	return (
		<html lang="en" className={`${geist.variable}`}>
			<body>
				<TRPCReactProvider>{children}</TRPCReactProvider>
			</body>
		</html>
	);
}
