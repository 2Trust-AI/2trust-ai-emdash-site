// Read queries for the 2trust.ai traffic dashboard (LABS-95). The dashboard lives on internal.innovaite.com,
// behind Cloudflare Access, and reads the 2trust-ai-site-logs D1 database through its own binding. This file is
// the contract: copy it into the dashboard or import it. Sections follow section 4 of
// ~/workplace/jarvis/playbooks/traffic-logging-standard.md.
//
// Every query takes the window start as ?1, an ISO timestamp (for example 30 or 90 days ago:
// new Date(Date.now() - days * 864e5).toISOString()). D1: db.prepare(sql).bind(since, ...).all().
// Nothing here writes.

export const TRAFFIC_QUERIES = {
	/** 1. Hits per day split by human, search, AI and other bots. */
	hitsPerDay: `SELECT day,
       SUM(bot_class = 'human') AS human,
       SUM(bot_class = 'search') AS search,
       SUM(bot_class = 'ai') AS ai,
       SUM(bot_class = 'other') AS other,
       COUNT(*) AS total,
       COUNT(DISTINCT CASE WHEN bot_class = 'human' THEN ip END) AS human_ips
  FROM page_views WHERE ts >= ?1 GROUP BY day ORDER BY day`,

	/** 2. Top pages by human views, with bot views alongside. */
	topPages: `SELECT path,
       SUM(bot_class = 'human') AS human,
       SUM(bot_class <> 'human') AS bots,
       COUNT(DISTINCT CASE WHEN bot_class = 'human' THEN ip END) AS human_ips
  FROM page_views WHERE ts >= ?1 AND kind IN ('page', 'markdown', 'document')
 GROUP BY path ORDER BY human DESC, bots DESC LIMIT 100`,

	/** 3a. Referrer hosts (humans, external only). ?2 is the site host to exclude, e.g. '2trust.ai'. */
	referrerHosts: `SELECT referrer_host, COUNT(*) AS views, COUNT(DISTINCT ip) AS ips
  FROM page_views
 WHERE ts >= ?1 AND bot_class = 'human' AND referrer_host IS NOT NULL
   AND referrer_host <> ?2 AND referrer_host <> 'www.' || ?2
 GROUP BY referrer_host ORDER BY views DESC LIMIT 100`,

	/** 3b. Full referrer URLs (humans, external only). ?2 as in referrerHosts. */
	referrerUrls: `SELECT referrer_url, referrer_host, COUNT(*) AS views, MAX(ts) AS last_seen
  FROM page_views
 WHERE ts >= ?1 AND bot_class = 'human' AND referrer_url IS NOT NULL
   AND referrer_host <> ?2 AND referrer_host <> 'www.' || ?2
 GROUP BY referrer_url ORDER BY views DESC LIMIT 200`,

	/** 3c. UTM campaigns. */
	utm: `SELECT utm_source, utm_medium, utm_campaign, COUNT(*) AS views
  FROM page_views WHERE ts >= ?1 AND utm_source IS NOT NULL
 GROUP BY utm_source, utm_medium, utm_campaign ORDER BY views DESC LIMIT 100`,

	/** 4. Human visits that came from an AI assistant answer, by assistant and landing page. */
	aiReferrals: `SELECT ai_referrer, path, COUNT(*) AS views, COUNT(DISTINCT ip) AS ips, MAX(ts) AS last_seen
  FROM page_views WHERE ts >= ?1 AND ai_referrer IS NOT NULL
 GROUP BY ai_referrer, path ORDER BY views DESC LIMIT 200`,

	/** 5a. Countries (humans). */
	countries: `SELECT country, COUNT(*) AS views, COUNT(DISTINCT ip) AS ips
  FROM page_views WHERE ts >= ?1 AND bot_class = 'human'
 GROUP BY country ORDER BY views DESC LIMIT 100`,

	/** 5b. Cities (humans). */
	cities: `SELECT country, region, city, COUNT(*) AS views, COUNT(DISTINCT ip) AS ips
  FROM page_views WHERE ts >= ?1 AND bot_class = 'human'
 GROUP BY country, region, city ORDER BY views DESC LIMIT 200`,

	/** 6. Top IPs with network owner, all classes. */
	topIps: `SELECT ip, asn, as_org, country, city, bot_class,
       COUNT(*) AS hits, COUNT(DISTINCT path) AS paths, MIN(ts) AS first_seen, MAX(ts) AS last_seen
  FROM page_views WHERE ts >= ?1 AND ip IS NOT NULL
 GROUP BY ip ORDER BY hits DESC LIMIT 200`,

	/** 7a. Browsers (humans). */
	browsers: `SELECT browser, COUNT(*) AS views FROM page_views
 WHERE ts >= ?1 AND bot_class = 'human' GROUP BY browser ORDER BY views DESC`,

	/** 7b. Devices (humans). */
	devices: `SELECT device, COUNT(*) AS views FROM page_views
 WHERE ts >= ?1 AND bot_class = 'human' GROUP BY device ORDER BY views DESC`,

	/** 8. Bots by name. */
	bots: `SELECT bot_class, bot_name, COUNT(*) AS hits, COUNT(DISTINCT path) AS paths, MAX(ts) AS last_seen
  FROM page_views WHERE ts >= ?1 AND bot_class <> 'human'
 GROUP BY bot_class, bot_name ORDER BY hits DESC LIMIT 200`,

	/** 9. Paths answering 4xx or 5xx. */
	errors: `SELECT status, method, path, COUNT(*) AS hits, COUNT(DISTINCT ip) AS ips, MAX(ts) AS last_seen
  FROM page_views WHERE ts >= ?1 AND status >= 400
 GROUP BY status, method, path ORDER BY hits DESC LIMIT 200`,

	/**
	 * 10. Recent raw rows. Filters are optional: pass null to skip one.
	 * ?2 ip (exact), ?3 path prefix, ?4 bot_class, ?5 row limit (cap it at 1000 in the dashboard).
	 */
	recent: `SELECT ts, method, host, path, query, status, kind, ms, ip, country, region, city, asn, as_org,
       bot_class, bot_name, browser, device, referrer_url, ai_referrer, utm_source, ua
  FROM page_views
 WHERE ts >= ?1
   AND (?2 IS NULL OR ip = ?2)
   AND (?3 IS NULL OR substr(path, 1, length(?3)) = ?3)
   AND (?4 IS NULL OR bot_class = ?4)
 ORDER BY ts DESC LIMIT ?5`,
} as const;

export type TrafficQueryName = keyof typeof TRAFFIC_QUERIES;
