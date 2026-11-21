// First-party traffic log for 2trust.ai (LABS-95). Spec: ~/workplace/jarvis/playbooks/traffic-logging-standard.md.
// Adapted from The AI Bugle (BUGLE-17, src/traffic.ts). Column names match bugle's page_views table so one
// dashboard query set works for both.
//
// The site Worker (src/worker.ts) writes one row to the LOGS D1 database (2trust-ai-site-logs, table page_views)
// for each request it serves: pages, Markdown and text, feeds and sitemaps, redirects, every non-GET request
// (forms, APIs; metadata only) and every 4xx/5xx. Skipped: static assets, prefetches, and the EmDash admin UI's
// own background GET calls under /_emdash/api/ (successful ones only). The dashboard on internal.innovaite.com
// reads the table through a read-only D1 binding.
//
// What is kept (Allen's rule "Keep all traffic and log data", 2026-11-21): full client IP, full user agent
// (capped at 1000 chars), method, host, path, query string, full referrer URL, Accept-Language, Cloudflare
// geo and network fields, TLS and HTTP versions, status and response time. Rows are never purged.
// Secret-like query parameters (tokens, keys, signatures, codes, passwords, sessions, magic and reset links)
// are stored as [redacted], in both the query string and the referrer URL.
// Never read or stored: request bodies, form values, cookies, Authorization headers, payment data.
//
// Hot path: the insert runs in ctx.waitUntil after the response is ready, one INSERT per request, no reads.
// Any failure is caught and logged; a page is never slowed down or broken by logging.

const UA_CAP = 1000;
const URL_CAP = 2000;
const PATH_CAP = 1000;
export const REDACTED = '[redacted]';

export type BotClass = 'human' | 'search' | 'ai' | 'other';

// ---------- bot classification ----------
// Order matters: AI crawlers first (Applebot-Extended before Applebot), then search crawlers, then generic bots.
// Google-Extended and Applebot-Extended are robots.txt tokens rather than user agents; they are listed so a
// crawler that does send them is still named.
const AI_BOTS: [RegExp, string][] = [
  [/OAI-SearchBot/i, 'OAI-SearchBot'],
  [/ChatGPT-User/i, 'ChatGPT-User'],
  [/ChatGPT-Agent/i, 'ChatGPT-Agent'],
  [/GPTBot/i, 'GPTBot'],
  [/Claude-SearchBot/i, 'Claude-SearchBot'],
  [/Claude-User/i, 'Claude-User'],
  [/ClaudeBot/i, 'ClaudeBot'],
  [/anthropic-ai/i, 'anthropic-ai'],
  [/Perplexity-User/i, 'Perplexity-User'],
  [/PerplexityBot/i, 'PerplexityBot'],
  [/Google-Extended/i, 'Google-Extended'],
  [/Google-CloudVertexBot/i, 'Google-CloudVertexBot'],
  [/Applebot-Extended/i, 'Applebot-Extended'],
  [/CCBot/i, 'CCBot'],
  [/Bytespider/i, 'Bytespider'],
  [/Amazonbot/i, 'Amazonbot'],
  [/meta-externalagent/i, 'meta-externalagent'],
  [/meta-externalfetcher/i, 'meta-externalfetcher'],
  [/MistralAI-User/i, 'MistralAI-User'],
  [/DuckAssistBot/i, 'DuckAssistBot'],
  [/cohere-ai|cohere-training-data-crawler/i, 'cohere-ai'],
  [/YouBot/i, 'YouBot'],
  [/Diffbot/i, 'Diffbot'],
  [/AI2Bot/i, 'AI2Bot'],
  [/PhindBot/i, 'PhindBot'],
  [/TikTokSpider/i, 'TikTokSpider'],
  [/Timpibot/i, 'Timpibot'],
  [/omgili/i, 'omgili'],
];
const SEARCH_BOTS: [RegExp, string][] = [
  [/Googlebot-Image/i, 'Googlebot-Image'],
  [/Googlebot/i, 'Googlebot'],
  [/Google-InspectionTool/i, 'Google-InspectionTool'],
  [/Storebot-Google/i, 'Storebot-Google'],
  [/AdsBot-Google/i, 'AdsBot-Google'],
  [/bingbot/i, 'Bingbot'],
  [/BingPreview/i, 'BingPreview'],
  [/Applebot/i, 'Applebot'],
  [/DuckDuckBot/i, 'DuckDuckBot'],
  [/YandexBot|YandexMobileBot/i, 'YandexBot'],
  [/Baiduspider/i, 'Baiduspider'],
  [/Yahoo! Slurp/i, 'Yahoo Slurp'],
  [/PetalBot/i, 'PetalBot'],
  [/SeznamBot/i, 'SeznamBot'],
  [/Qwantbot|Qwantify/i, 'Qwantbot'],
  [/MojeekBot/i, 'MojeekBot'],
  [/Yeti\//i, 'Naver Yeti'],
  [/Sogou/i, 'Sogou'],
  [/Brave(Bot|-Search)/i, 'BraveBot'],
];
const OTHER_BOT = /(?<!cu)bot\b|bot\/|crawl|spider|slurp|scrape|preview|facebookexternalhit|embedly|whatsapp|telegram|discord|slack|skype|curl|wget|python|httpclient|http-client|axios|node-fetch|undici|headless|phantom|puppeteer|playwright|selenium|lighthouse|pagespeed|gtmetrix|monitor|uptime|pingdom|statuscake|feed|rss|okhttp|go-http|java\/|libwww|scrapy|ahrefs|semrush|mj12|dotbot|dataforseo|zoominfo|censys|zgrab|nmap|masscan/i;

export interface BotInfo {
  cls: BotClass;
  name: string | null;
}

export function classifyBot(ua: string): BotInfo {
  if (!ua.trim()) return { cls: 'other', name: '(empty user agent)' };
  for (const [re, name] of AI_BOTS) if (re.test(ua)) return { cls: 'ai', name };
  for (const [re, name] of SEARCH_BOTS) if (re.test(ua)) return { cls: 'search', name };
  if (OTHER_BOT.test(ua)) return { cls: 'other', name: otherBotName(ua) };
  return { cls: 'human', name: null };
}

/** A short label for an unrecognized bot: the first product token that looks like a bot name. */
function otherBotName(ua: string): string {
  const m = ua.match(/([A-Za-z][\w.-]*(?:bot|crawler|spider|fetcher|scraper|preview|monitor)[\w.-]*)/i) ?? ua.match(/^([A-Za-z][\w.-]*)/);
  return (m ? m[1] : 'unknown').slice(0, 60);
}

// ---------- browser and device (humans) ----------
export function browserFamily(ua: string): string {
  if (/Edg(e|A|iOS)?\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/SamsungBrowser\//.test(ua)) return 'Samsung Internet';
  if (/YaBrowser\//.test(ua)) return 'Yandex';
  if (/Vivaldi\//.test(ua)) return 'Vivaldi';
  if (/DuckDuckGo\//.test(ua)) return 'DuckDuckGo';
  if (/FxiOS\/|Firefox\//.test(ua)) return 'Firefox';
  if (/CriOS\/|Chrome\/|Chromium\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return 'Safari';
  if (/AppleWebKit\//.test(ua) && /Mobile\//.test(ua)) return 'Safari (in-app)';
  return 'Other';
}

export function deviceClass(ua: string): 'mobile' | 'tablet' | 'desktop' {
  if (/iPad|Tablet|PlayBook|Silk|Kindle/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'tablet';
  if (/Mobi|iPhone|iPod|Android|Windows Phone|BlackBerry|Opera Mini/i.test(ua)) return 'mobile';
  return 'desktop';
}

// ---------- referrers ----------
// AI assistants whose links send readers to us. Matched on the referrer host or on utm_source
// (ChatGPT adds utm_source=chatgpt.com to its links and often sends no referrer at all).
const AI_REFERRERS: [RegExp, string][] = [
  [/(^|\.)chatgpt\.com$|(^|\.)chat\.openai\.com$|^openai\.com$/, 'ChatGPT'],
  [/(^|\.)perplexity\.ai$/, 'Perplexity'],
  [/(^|\.)claude\.ai$/, 'Claude'],
  [/^gemini\.google\.com$|^bard\.google\.com$/, 'Gemini'],
  [/^copilot\.microsoft\.com$|(^|\.)copilot\.cloud\.microsoft$|^edgeservices\.bing\.com$/, 'Copilot'],
  [/(^|\.)you\.com$/, 'You.com'],
  [/(^|\.)phind\.com$/, 'Phind'],
  [/(^|\.)deepseek\.com$/, 'DeepSeek'],
  [/(^|\.)meta\.ai$/, 'Meta AI'],
  [/(^|\.)grok\.com$|^x\.ai$/, 'Grok'],
  [/^chat\.mistral\.ai$/, 'Mistral'],
  [/(^|\.)poe\.com$/, 'Poe'],
  [/(^|\.)kagi\.com$/, 'Kagi'],
  [/(^|\.)andisearch\.com$/, 'Andi'],
  [/^chat\.qwen\.ai$|^chat\.qwenlm\.ai$/, 'Qwen'],
];

export function aiAssistant(host: string | null, utmSource: string | null = null): string | null {
  for (const cand of [host, utmSource]) {
    if (!cand) continue;
    const h = cand.toLowerCase().replace(/^www\./, '').trim();
    for (const [re, name] of AI_REFERRERS) if (re.test(h)) return name;
    // utm_source values that name the assistant without a domain: utm_source=chatgpt, perplexity, claude.
    if (cand === utmSource) {
      const n = h.replace(/\.(com|ai)$/, '');
      const hit = { chatgpt: 'ChatGPT', openai: 'ChatGPT', perplexity: 'Perplexity', claude: 'Claude', gemini: 'Gemini', copilot: 'Copilot', phind: 'Phind', deepseek: 'DeepSeek', grok: 'Grok' }[n];
      if (hit) return hit;
    }
  }
  return null;
}

// Query parameters whose values may be secrets (jarvis traffic-logging standard, section 2), plus the
// newsletter token "t" and a few short names. Substring match: over-redacting a harmless name is fine.
const SECRET_PARAM = /token|key|sig|signature|code|password|pass|auth|session|magic|reset|secret|jwt|otp|hmac|nonce|credential|^t$|^sid$|^pin$/i;

/** True for a query parameter name whose value must not be stored. */
export const isSecretParam = (name: string) => SECRET_PARAM.test(name.trim());

/** Query string (without "?") with secret-like values replaced by [redacted]. Null when empty. */
export function sanitizeQuery(params: URLSearchParams, cap = URL_CAP): string | null {
  const out: string[] = [];
  for (const [k, v] of params) out.push(`${encodeURIComponent(k)}=${isSecretParam(k) ? REDACTED : encodeURIComponent(v)}`);
  return out.length ? out.join('&').slice(0, cap) : null;
}

/** Full referrer URL with credentials and fragment dropped and secret-like parameters redacted. Null if unusable. */
export function sanitizeReferrer(raw: string | null): { url: string; host: string } | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const q = sanitizeQuery(u.searchParams);
  const url = `${u.protocol}//${u.host}${u.pathname}${q ? `?${q}` : ''}`.slice(0, URL_CAP);
  return { url, host: u.hostname.toLowerCase() };
}

/** The client IP from CF-Connecting-IP, only if it looks like an IPv4 or IPv6 address. */
export function clientIp(req: Request): string | null {
  const v = (req.headers.get('cf-connecting-ip') ?? '').trim();
  if (!v || v.length > 45) return null;
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(v) || (/^[0-9a-f:.]+$/i.test(v) && v.includes(':')) ? v.toLowerCase() : null;
}

function utm(url: URL, key: string): string | null {
  const v = url.searchParams.get(key);
  return v ? v.trim().slice(0, 200) || null : null;
}

// ---------- which requests count ----------
export type ViewKind = 'page' | 'markdown' | 'text' | 'feed' | 'redirect' | 'form' | 'api' | 'document' | 'error' | 'other';

// Static files: Astro build output, fonts, images, scripts, styles, audio and video. PDFs are logged. Cloudflare serves most of them from
// the assets binding before the Worker runs; this catches the rest (R2 media, image endpoint, misses).
const ASSET_PATH = /^\/(_astro|_image|fonts|images|img|icons)\/|\.(css|js|mjs|map|png|jpe?g|gif|webp|avif|svg|ico|bmp|woff2?|ttf|otf|eot|mp4|webm|mov|mp3|wav|ogg|zip|wasm)$/i;
const ASSET_TYPE = /^(image|font|video|audio)\/|^text\/css|javascript|^application\/(wasm|octet-stream|zip)/i;

/** Kind of request, or null to skip. */
export function viewKind(req: Request, res: Response): ViewKind | null {
  const path = new URL(req.url).pathname;
  const method = req.method.toUpperCase();
  const read = method === 'GET' || method === 'HEAD';
  const purpose = `${req.headers.get('sec-purpose') ?? ''} ${req.headers.get('purpose') ?? ''} ${req.headers.get('x-moz') ?? ''}`;
  if (read && /prefetch|prerender/i.test(purpose)) return null; // the standard skips prefetch: not a visit
  const type = res.headers.get('content-type') ?? '';
  if (res.status >= 400) return 'error'; // every 4xx/5xx, including probes for /wp-login.php or missing files
  if (!read) return path.startsWith('/_emdash/api/plugins/emdash-forms/') ? 'form' : 'api';
  if (type.startsWith('application/pdf') || /\.pdf$/i.test(path)) return 'document'; // downloads count, incl. R2 media
  if (ASSET_PATH.test(path) || ASSET_TYPE.test(type)) return null;
  if (path.startsWith('/_emdash/api/')) return null; // admin UI background calls; admin pages are still logged
  if (res.status >= 300 && res.status < 400 && res.status !== 304) return 'redirect';
  if (type.startsWith('text/markdown') || /\.md$/.test(path) || path === '/llms.txt' || path === '/llms-full.txt') return 'markdown';
  if (/xml|rss|atom/i.test(type) || /\.xml$/.test(path)) return 'feed';
  if (type.startsWith('text/html')) return 'page';
  if (type.startsWith('text/plain')) return 'text'; // robots.txt and friends
  return 'other';
}

export interface ViewRow {
  ts: string;
  day: string;
  method: string;
  host: string;
  path: string;
  query: string | null;
  status: number;
  kind: string;
  ms: number | null;
  ip: string | null;
  referrer_host: string | null;
  referrer_url: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  ai_referrer: string | null;
  accept_language: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  timezone: string | null;
  postal: string | null;
  lat: string | null;
  lon: string | null;
  colo: string | null;
  asn: number | null;
  as_org: string | null;
  tls_version: string | null;
  http_protocol: string | null;
  browser: string | null;
  device: string | null;
  bot_class: BotClass;
  bot_name: string | null;
  ua: string | null;
  bot_score: number | null;
  verified_bot: number | null;
  user_id: string | null;
}

type Cf = {
  country?: unknown; region?: unknown; city?: unknown; postalCode?: unknown; colo?: unknown; timezone?: unknown; latitude?: unknown; longitude?: unknown;
  asn?: unknown; asOrganization?: unknown; tlsVersion?: unknown; httpProtocol?: unknown;
  botManagement?: { score?: unknown; verifiedBot?: unknown };
};
const str = (v: unknown, cap = 120) => (typeof v === 'string' && v ? v.slice(0, cap) : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Builds the row for one request. Pure: no I/O. */
export function buildRow(req: Request, res: Response, kind: string, responseMs: number | null = null, now = new Date(), userId: string | null = null): ViewRow {
  const url = new URL(req.url);
  const ua = req.headers.get('user-agent') ?? '';
  const bot = classifyBot(ua);
  const cf = ((req as unknown as { cf?: Cf }).cf ?? {}) as Cf;
  const ref = sanitizeReferrer(req.headers.get('referer'));
  const utmSource = utm(url, 'utm_source');
  const bm = cf.botManagement;
  const ts = now.toISOString();
  const coord = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v).slice(0, 20) || null : null);
  return {
    ts,
    day: ts.slice(0, 10),
    method: req.method.slice(0, 10),
    host: url.host.slice(0, 200),
    path: url.pathname.slice(0, PATH_CAP),
    query: sanitizeQuery(url.searchParams),
    status: res.status,
    kind,
    ms: responseMs === null ? null : Math.max(0, Math.round(responseMs)),
    ip: clientIp(req),
    referrer_host: ref?.host ?? null,
    referrer_url: ref?.url ?? null,
    utm_source: utmSource,
    utm_medium: utm(url, 'utm_medium'),
    utm_campaign: utm(url, 'utm_campaign'),
    ai_referrer: bot.cls === 'human' ? aiAssistant(ref?.host ?? null, utmSource) : null,
    accept_language: str(req.headers.get('accept-language'), 200),
    country: str(cf.country, 8),
    region: str(cf.region),
    city: str(cf.city),
    timezone: str(cf.timezone, 64),
    postal: str(cf.postalCode, 20),
    lat: coord(cf.latitude),
    lon: coord(cf.longitude),
    colo: str(cf.colo, 8),
    asn: num(cf.asn),
    as_org: str(cf.asOrganization, 200),
    tls_version: str(cf.tlsVersion, 20),
    http_protocol: str(cf.httpProtocol, 20),
    browser: bot.cls === 'human' ? browserFamily(ua) : null,
    device: bot.cls === 'human' ? deviceClass(ua) : 'bot',
    bot_class: bot.cls,
    bot_name: bot.name,
    ua: ua.slice(0, UA_CAP) || null,
    bot_score: bm && typeof bm.score === 'number' ? bm.score : null,
    verified_bot: bm && typeof bm.verifiedBot === 'boolean' ? (bm.verifiedBot ? 1 : 0) : null,
    user_id: userId ? userId.slice(0, 200) : null,
  };
}

export const COLS: (keyof ViewRow)[] = [
  'ts', 'day', 'method', 'host', 'path', 'query', 'status', 'kind', 'ms', 'ip', 'referrer_host', 'referrer_url', 'utm_source', 'utm_medium', 'utm_campaign',
  'ai_referrer', 'accept_language', 'country', 'region', 'city', 'postal', 'lat', 'lon', 'timezone', 'colo', 'asn', 'as_org', 'tls_version', 'http_protocol',
  'browser', 'device', 'bot_class', 'bot_name', 'ua', 'bot_score', 'verified_bot', 'user_id',
];
const INSERT = `INSERT INTO page_views (${COLS.join(', ')}) VALUES (${COLS.map(() => '?').join(', ')})`;

/** Logs one request if it counts. Never throws. */
export async function logView(db: D1Database | undefined, req: Request, res: Response, responseMs: number | null = null): Promise<void> {
  try {
    if (!db) return;
    const kind = viewKind(req, res);
    if (!kind) return;
    const row = buildRow(req, res, kind, responseMs);
    await db.prepare(INSERT).bind(...COLS.map((c) => row[c])).run();
  } catch (err) {
    console.error('page view log failed', String(err)); // migration not applied yet, or D1 trouble: serve normally
  }
}
