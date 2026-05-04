import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { d1, r2, sandbox } from "@emdash-cms/cloudflare";
import { formsPlugin } from "@emdash-cms/plugin-forms";
import { webhookNotifierPlugin } from "@emdash-cms/plugin-webhook-notifier";
import resendPlugin from "emdash-plugin-resend";
import { defineConfig, fontProviders } from "astro/config";
import emdash from "emdash/astro";
import { gtmPlugin } from "./src/plugins/gtm.js";

export default defineConfig({
	output: "server",
	adapter: cloudflare(),
	image: {
		layout: "constrained",
		responsiveStyles: true,
	},
	integrations: [
		react(),
		emdash({
			database: d1({ binding: "DB", session: "auto" }),
			storage: r2({ binding: "MEDIA" }),
			plugins: [formsPlugin(), resendPlugin(), gtmPlugin()],
			sandboxed: [webhookNotifierPlugin()],
			sandboxRunner: sandbox(),
			marketplace: "https://marketplace.emdashcms.com",
		}),
	],
	fonts: [
		{
			provider: fontProviders.google(),
			name: "Inter Tight",
			cssVariable: "--font-display",
			weights: [400, 500, 600],
			fallbacks: ["Inter", "system-ui", "sans-serif"],
		},
		{
			provider: fontProviders.google(),
			name: "Inter",
			cssVariable: "--font-body",
			weights: [400, 500, 600],
			fallbacks: ["system-ui", "sans-serif"],
		},
		{
			provider: fontProviders.google(),
			name: "JetBrains Mono",
			cssVariable: "--font-mono",
			weights: [400, 500],
			fallbacks: ["ui-monospace", "monospace"],
		},
	],
	devToolbar: { enabled: false },
});
