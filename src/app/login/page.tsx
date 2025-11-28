"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/trpc/react";

export default function LoginPage() {
	const [email, setEmail] = useState("");
	const [code, setCode] = useState("");
	const [stage, setStage] = useState<"enterEmail" | "enterCode">("enterEmail");
	const [message, setMessage] = useState<string | null>(null);
	const [messageType, setMessageType] = useState<"success" | "error" | null>(
		null,
	);

	const utils = api.useUtils();

	const sendOtp = api.auth.sendOtp.useMutation({
		onSuccess: () => {
			setMessage("Code sent. Check your email.");
			setMessageType("success");
			setStage("enterCode");
		},
		onError: (err) => {
			setMessage(err.message);
			setMessageType("error");
		},
	});

	const verifyOtp = api.auth.verifyOtp.useMutation({
		onSuccess: () => {
			// redirect handled client-side for smoother UX
			window.location.href = "/";
		},
		onError: (err) => {
			setMessage(err.message);
			setMessageType("error");
		},
	});

	return (
		<main className="relative min-h-screen overflow-hidden bg-neutral-950">
			<div className="-left-32 -top-32 pointer-events-none absolute h-72 w-72 rounded-full bg-gradient-to-tr from-emerald-500/30 via-emerald-400/20 to-lime-400/20 blur-3xl" />
			<div className="-right-24 pointer-events-none absolute bottom-0 h-80 w-80 rounded-full bg-gradient-to-tr from-emerald-500/20 via-lime-400/10 to-emerald-400/20 blur-3xl" />

			<div className="relative z-10 flex min-h-screen items-center justify-center px-6 py-16">
				<div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 shadow-[0_8px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl">
					<div className="mb-6 text-center">
						<div className="mx-auto mb-3 h-10 w-10 rounded-full bg-gradient-to-br from-emerald-500 via-emerald-400 to-lime-400 p-[1px]">
							<div className="h-full w-full rounded-full bg-neutral-950" />
						</div>
						<h1 className="bg-gradient-to-r from-white via-white to-white/70 bg-clip-text font-semibold text-2xl text-transparent tracking-tight">
							Sign in to Wishing Wealth
						</h1>
						<p className="mt-1 text-neutral-400 text-sm">
							Secure, passwordless login
						</p>
					</div>

					{message &&
						(messageType === "error" ? (
							<div className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-red-200 text-sm">
								{message}
							</div>
						) : (
							<div className="mb-4 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-emerald-200 text-sm">
								{message}
							</div>
						))}

					{stage === "enterEmail" ? (
						<form
							onSubmit={(e) => {
								e.preventDefault();
								sendOtp.mutate({ email });
							}}
							className="space-y-4"
						>
							<div className="space-y-2">
								<Label htmlFor="email" className="text-neutral-200">
									Email
								</Label>
								<Input
									id="email"
									type="email"
									placeholder="you@example.com"
									value={email}
									onChange={(e) => setEmail(e.target.value)}
									className="border-white/10 bg-white/10 text-white placeholder:text-neutral-400 focus-visible:ring-white"
									required
								/>
							</div>
							<Button
								type="submit"
								className="w-full bg-white text-neutral-900 hover:bg-white/90"
								disabled={sendOtp.isPending}
							>
								{sendOtp.isPending ? "Sending..." : "Send code"}
							</Button>
							<p className="text-center text-neutral-400 text-xs">
								By continuing, you agree to our privacy policy.
							</p>
						</form>
					) : (
						<form
							onSubmit={(e) => {
								e.preventDefault();
								verifyOtp.mutate({ email, code });
							}}
							className="space-y-4"
						>
							<div className="space-y-2">
								<Label htmlFor="code" className="text-neutral-200">
									One-time passcode
								</Label>
								<Input
									id="code"
									type="text"
									placeholder="123456"
									value={code}
									onChange={(e) => setCode(e.target.value)}
									inputMode="numeric"
									pattern="[0-9]*"
									className="border-white/10 bg-white/10 text-center text-lg text-white tracking-[0.4em] placeholder:text-neutral-400 focus-visible:ring-white"
									required
								/>
							</div>
							<Button
								type="submit"
								className="w-full bg-white text-neutral-900 hover:bg-white/90"
								disabled={verifyOtp.isPending}
							>
								{verifyOtp.isPending ? "Verifying..." : "Continue"}
							</Button>
							<button
								type="button"
								onClick={() => {
									setCode("");
									setStage("enterEmail");
								}}
								className="mx-auto block text-neutral-400 text-xs underline underline-offset-4 hover:text-neutral-300"
							>
								Use a different email
							</button>
						</form>
					)}
				</div>
			</div>
		</main>
	);
}
