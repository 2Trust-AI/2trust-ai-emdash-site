import handler from "@astrojs/cloudflare/entrypoints/server";

import { logView } from "./traffic";

export { PluginBridge } from "@emdash-cms/cloudflare/sandbox";

type Env = { LOGS?: D1Database } & Record<string, unknown>;

/**
 * Astro's handler serves the request; the traffic log (LABS-95) records it afterwards in
 * ctx.waitUntil, so logging never delays or breaks a response. See src/traffic.ts.
 */
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const started = Date.now();
		const response = await handler.fetch(request, env as never, ctx);
		try {
			ctx.waitUntil(logView(env.LOGS, request, response, Date.now() - started));
		} catch (err) {
			console.error("page view log failed", String(err));
		}
		return response;
	},
};
