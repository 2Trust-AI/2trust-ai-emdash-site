// LABS-95: tests for the 2trust.ai traffic log (src/traffic.ts), its D1 migration and the dashboard queries.
// Runs on Node 23.6+ (native TypeScript type stripping and node:sqlite): npm run test:traffic
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";

import {
	COLS,
	REDACTED,
	aiAssistant,
	buildRow,
	classifyBot,
	clientIp,
	isSecretParam,
	logView,
	sanitizeQuery,
	sanitizeReferrer,
	viewKind,
} from "../src/traffic.ts";
import { TRAFFIC_QUERIES } from "../src/traffic-queries.ts";

const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const GPTBOT = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)";
const GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

const CF = {
	country: "US", region: "Virginia", city: "Ashburn", postalCode: "20147", latitude: "39.04", longitude: "-77.49",
	timezone: "America/New_York", colo: "IAD", asn: 14618, asOrganization: "Amazon.com", tlsVersion: "TLSv1.3", httpProtocol: "HTTP/2",
};

function req(url, { method = "GET", headers = {}, cf = CF } = {}) {
	const r = new Request(url, { method, headers: { "user-agent": CHROME, "cf-connecting-ip": "203.0.113.7", ...headers } });
	Object.defineProperty(r, "cf", { value: cf });
	return r;
}
const res = (status = 200, type = "text/html; charset=utf-8") => new Response(null, { status, headers: type ? { "content-type": type } : {} });

function memoryD1() {
	const db = new DatabaseSync(":memory:");
	db.exec(readFileSync(new URL("../migrations-logs/0001_page_views.sql", import.meta.url), "utf8"));
	const d1 = {
		prepare(sql) {
			return { bind: (...args) => ({ run: async () => db.prepare(sql).run(...args) }) };
		},
	};
	return { db, d1 };
}

describe("which requests are logged", () => {
	it("logs pages, feeds, text, documents, redirects, forms, APIs and errors", () => {
		assert.equal(viewKind(req("https://2trust.ai/platform"), res()), "page");
		assert.equal(viewKind(req("https://2trust.ai/rss.xml"), res(200, "application/rss+xml")), "feed");
		assert.equal(viewKind(req("https://2trust.ai/sitemap.xml"), res(200, "application/xml")), "feed");
		assert.equal(viewKind(req("https://2trust.ai/robots.txt"), res(200, "text/plain")), "text");
		assert.equal(viewKind(req("https://2trust.ai/_emdash/api/media/file/brief.pdf"), res(200, "application/pdf")), "document");
		assert.equal(viewKind(req("https://www.2trust.ai/"), res(301, null)), "redirect");
		assert.equal(viewKind(req("https://2trust.ai/_emdash/api/plugins/emdash-forms/submit", { method: "POST" }), res(200, "application/json")), "form");
		assert.equal(viewKind(req("https://2trust.ai/_emdash/api/content/posts", { method: "PUT" }), res(200, "application/json")), "api");
		assert.equal(viewKind(req("https://2trust.ai/wp-login.php"), res(404)), "error");
		assert.equal(viewKind(req("https://2trust.ai/missing.png"), res(404)), "error");
		assert.equal(viewKind(req("https://2trust.ai/platform"), res(500)), "error");
		assert.equal(viewKind(req("https://2trust.ai/_emdash/admin"), res()), "page");
	});

	it("skips static assets, prefetches and admin background GETs", () => {
		assert.equal(viewKind(req("https://2trust.ai/_astro/index.abc123.css"), res(200, "text/css")), null);
		assert.equal(viewKind(req("https://2trust.ai/_astro/client.js"), res(200, "text/javascript")), null);
		assert.equal(viewKind(req("https://2trust.ai/favicon-32.png"), res(200, "image/png")), null);
		assert.equal(viewKind(req("https://2trust.ai/_emdash/api/media/file/hero"), res(200, "image/webp")), null);
		assert.equal(viewKind(req("https://2trust.ai/fonts/inter.woff2"), res(200, "font/woff2")), null);
		assert.equal(viewKind(req("https://2trust.ai/pricing", { headers: { "sec-purpose": "prefetch" } }), res()), null);
		assert.equal(viewKind(req("https://2trust.ai/_emdash/api/content/posts"), res(200, "application/json")), null);
	});
});

describe("redaction (spec section 2)", () => {
	it("redacts every secret-like parameter name", () => {
		for (const name of ["token", "access_token", "api_key", "apikey", "key", "sig", "X-Amz-Signature", "code", "password", "pass",
			"auth", "authorization", "session", "sessionid", "magic", "magic_link", "reset", "reset_token", "client_secret", "jwt", "otp", "t", "sid", "nonce"]) {
			assert.ok(isSecretParam(name), name);
		}
		for (const name of ["utm_source", "q", "page", "ref", "lang"]) assert.ok(!isSecretParam(name), name);
	});

	it("keeps harmless query values and redacts secrets in the query and the referrer", () => {
		assert.equal(sanitizeQuery(new URLSearchParams("q=llm%20firewall&token=abc123&page=2")), `q=llm%20firewall&token=${REDACTED}&page=2`);
		const ref = sanitizeReferrer("https://user:pw@mail.example.com/reset?reset_token=xyz&utm_source=news#frag");
		assert.equal(ref.url, `https://mail.example.com/reset?reset_token=${REDACTED}&utm_source=news`);
		assert.equal(ref.host, "mail.example.com");
		assert.equal(sanitizeReferrer("android-app://com.google.android.gm"), null);
		assert.equal(sanitizeReferrer("not a url"), null);
	});
});

describe("row contents (spec section 1)", () => {
	it("stores the full IP, full UA, geo, network and timing fields", () => {
		const r = req("https://2trust.ai/pricing?utm_source=chatgpt.com&key=sk-live-1", {
			headers: { referer: "https://chatgpt.com/", "accept-language": "en-US,en;q=0.9", "cf-connecting-ip": "2001:DB8::1" },
		});
		const row = buildRow(r, res(), "page", 41.6, new Date("2026-11-21T12:00:00Z"));
		assert.equal(row.ts, "2026-11-21T12:00:00.000Z");
		assert.equal(row.day, "2026-11-21");
		assert.equal(row.ip, "2001:db8::1");
		assert.equal(row.ua, CHROME);
		assert.equal(row.query, `utm_source=chatgpt.com&key=${REDACTED}`);
		assert.equal(row.ms, 42);
		assert.equal(row.ai_referrer, "ChatGPT");
		assert.equal(row.referrer_host, "chatgpt.com");
		assert.equal(row.country, "US");
		assert.equal(row.city, "Ashburn");
		assert.equal(row.postal, "20147");
		assert.equal(row.lat, "39.04");
		assert.equal(row.lon, "-77.49");
		assert.equal(row.asn, 14618);
		assert.equal(row.as_org, "Amazon.com");
		assert.equal(row.tls_version, "TLSv1.3");
		assert.equal(row.http_protocol, "HTTP/2");
		assert.equal(row.browser, "Chrome");
		assert.equal(row.device, "desktop");
		assert.equal(row.bot_class, "human");
		assert.equal(row.accept_language, "en-US,en;q=0.9");
		assert.equal(row.user_id, null);
	});

	it("caps the user agent at 1000 characters and rejects junk IPs", () => {
		const long = "x".repeat(1500);
		assert.equal(buildRow(req("https://2trust.ai/", { headers: { "user-agent": long } }), res(), "page").ua.length, 1000);
		assert.equal(clientIp(req("https://2trust.ai/", { headers: { "cf-connecting-ip": "<script>" } })), null);
		assert.equal(clientIp(req("https://2trust.ai/", { headers: { "cf-connecting-ip": "198.51.100.23" } })), "198.51.100.23");
	});

	it("classifies bots and AI referrers", () => {
		assert.deepEqual(classifyBot(GPTBOT), { cls: "ai", name: "GPTBot" });
		assert.deepEqual(classifyBot(GOOGLEBOT), { cls: "search", name: "Googlebot" });
		assert.equal(classifyBot("curl/8.4.0").cls, "other");
		assert.equal(classifyBot(IPHONE).cls, "human");
		assert.equal(aiAssistant("www.perplexity.ai"), "Perplexity");
		assert.equal(aiAssistant(null, "claude.ai"), "Claude");
		assert.equal(aiAssistant("news.ycombinator.com"), null);
	});

	it("never reads cookies, Authorization headers or bodies", () => {
		const r = new Request("https://2trust.ai/_emdash/api/plugins/emdash-forms/submit", {
			method: "POST",
			headers: { cookie: "astro-session=SECRETCOOKIE", authorization: "Bearer SECRETBEARER", "user-agent": CHROME },
			body: JSON.stringify({ email: "person@example.com", password: "SECRETPW" }),
		});
		const row = buildRow(r, res(200, "application/json"), "form");
		const blob = JSON.stringify(row);
		for (const secret of ["SECRETCOOKIE", "SECRETBEARER", "SECRETPW", "person@example.com"]) assert.ok(!blob.includes(secret), secret);
		assert.equal(r.bodyUsed, false);
	});
});

describe("D1 write path", () => {
	it("inserts one row per logged request and matches the migration columns", async () => {
		const { db, d1 } = memoryD1();
		const cols = db.prepare("PRAGMA table_info(page_views)").all().map((c) => c.name).filter((c) => c !== "id");
		assert.deepEqual([...cols].sort(), [...COLS].sort());
		await logView(d1, req("https://2trust.ai/platform"), res(), 12);
		await logView(d1, req("https://2trust.ai/_astro/x.css"), res(200, "text/css"), 1);
		const rows = db.prepare("SELECT path, ip, kind, ms FROM page_views").all();
		assert.deepEqual(rows.map((r) => ({ ...r })), [{ path: "/platform", ip: "203.0.113.7", kind: "page", ms: 12 }]);
	});

	it("never throws: missing binding, missing table, D1 failure", async () => {
		await logView(undefined, req("https://2trust.ai/"), res());
		const broken = { prepare() { throw new Error("no such table: page_views"); } };
		const errors = [];
		const orig = console.error;
		console.error = (...a) => errors.push(a.join(" "));
		try {
			await logView(broken, req("https://2trust.ai/"), res());
		} finally {
			console.error = orig;
		}
		assert.equal(errors.length, 1);
		assert.match(errors[0], /page view log failed/);
	});

	it("has the indexes the spec requires", () => {
		const { db } = memoryD1();
		const idx = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'page_views'").all().map((r) => r.sql);
		for (const cols of ["(ts)", "(day, bot_class)", "(path, ts)", "(ip, ts)"]) assert.ok(idx.some((s) => s.includes(cols)), cols);
	});

	it("has no retention or purge anywhere", () => {
		for (const f of ["../src/traffic.ts", "../src/worker.ts", "../migrations-logs/0001_page_views.sql"]) {
			const src = readFileSync(new URL(f, import.meta.url), "utf8");
			assert.ok(!/DELETE\s+FROM|DROP\s+TABLE|retention\(|purge\(/i.test(src), f);
		}
	});
});

describe("dashboard queries", () => {
	it("every query runs against the migration and returns sensible numbers", async () => {
		const { db, d1 } = memoryD1();
		const visits = [
			[req("https://2trust.ai/", { headers: { referer: "https://chatgpt.com/" } }), res()],
			[req("https://2trust.ai/pricing", { headers: { "user-agent": IPHONE, "cf-connecting-ip": "198.51.100.9" } }), res()],
			[req("https://2trust.ai/", { headers: { "user-agent": GPTBOT, "cf-connecting-ip": "192.0.2.1" } }), res()],
			[req("https://2trust.ai/", { headers: { "user-agent": GOOGLEBOT, "cf-connecting-ip": "192.0.2.2" } }), res()],
			[req("https://2trust.ai/wp-login.php", { headers: { "user-agent": "curl/8.4.0" } }), res(404)],
		];
		for (const [rq, rs] of visits) await logView(d1, rq, rs, 5);
		const since = "2000-01-01T00:00:00.000Z";
		const extra = { referrerHosts: ["2trust.ai"], referrerUrls: ["2trust.ai"], recent: [null, null, null, 50] };
		const out = {};
		for (const [name, sql] of Object.entries(TRAFFIC_QUERIES)) {
			assert.ok(/^\s*SELECT/i.test(sql), `${name} is read-only`);
			out[name] = db.prepare(sql).all(since, ...(extra[name] ?? []));
		}
		const day = out.hitsPerDay[0];
		assert.deepEqual([day.human, day.search, day.ai, day.other, day.total], [2, 1, 1, 1, 5]);
		assert.equal(out.topPages.find((r) => r.path === "/").human, 1);
		assert.equal(out.aiReferrals[0].ai_referrer, "ChatGPT");
		assert.equal(out.referrerHosts[0].referrer_host, "chatgpt.com");
		assert.equal(out.errors[0].path, "/wp-login.php");
		assert.equal(out.bots.length, 3);
		assert.equal(out.recent.length, 5);
		assert.equal(db.prepare(TRAFFIC_QUERIES.recent).all(since, "198.51.100.9", null, null, 50).length, 1);
		assert.equal(db.prepare(TRAFFIC_QUERIES.recent).all(since, null, "/wp", null, 50).length, 1);
		assert.equal(db.prepare(TRAFFIC_QUERIES.recent).all(since, null, null, "ai", 50).length, 1);
	});
});
