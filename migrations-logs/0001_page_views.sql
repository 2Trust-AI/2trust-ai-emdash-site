-- LABS-95: first-party traffic log for 2trust.ai. Database 2trust-ai-site-logs, binding LOGS.
-- Spec: ~/workplace/jarvis/playbooks/traffic-logging-standard.md. Same columns as The AI Bugle's page_views
-- (BUGLE-17), plus user_id.
-- One row per request the site Worker serves (pages, Markdown and text, feeds, redirects, PDFs, every non-GET
-- request, every 4xx/5xx; not static assets, prefetches or the admin UI's background GET calls), written in
-- ctx.waitUntil. Per Allen's rule "Keep all traffic and log data" (2026-11-21): full IP, full user agent, query
-- string and referrer URL are kept, and rows are never purged. Secret-like query parameters (tokens, keys,
-- signatures, codes, passwords, sessions, magic and reset links) are stored as [redacted]. No bodies, cookies or
-- Authorization headers. No visitor id.
CREATE TABLE page_views (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,                 -- ISO 8601 UTC
  day TEXT NOT NULL,                -- YYYY-MM-DD, UTC
  method TEXT NOT NULL,
  host TEXT NOT NULL,
  path TEXT NOT NULL,               -- pathname
  query TEXT,                       -- query string without "?", secret-like values redacted
  status INTEGER NOT NULL,
  kind TEXT NOT NULL,               -- page | markdown | text | feed | redirect | form | api | document | error | other
  ms INTEGER,                       -- response time: building the response in the Worker
  ip TEXT,                          -- CF-Connecting-IP (IPv4 or IPv6), full
  referrer_host TEXT,
  referrer_url TEXT,                -- full referrer URL, fragment and credentials dropped, secret-like values redacted
  utm_source TEXT,                  -- from the landing URL
  utm_medium TEXT,
  utm_campaign TEXT,
  ai_referrer TEXT,                 -- assistant name (ChatGPT, Perplexity, Claude, Gemini, Copilot, ...) for human visits from AI answers
  accept_language TEXT,
  country TEXT,                     -- request.cf from here down to http_protocol
  region TEXT,
  city TEXT,
  postal TEXT,
  lat TEXT,
  lon TEXT,
  timezone TEXT,
  colo TEXT,
  asn INTEGER,
  as_org TEXT,
  tls_version TEXT,
  http_protocol TEXT,
  browser TEXT,                     -- derived, humans only
  device TEXT,                      -- derived: mobile | tablet | desktop | bot
  bot_class TEXT NOT NULL,          -- human | search | ai | other
  bot_name TEXT,                    -- e.g. GPTBot, Googlebot
  ua TEXT,                          -- full user agent, at most 1000 chars
  bot_score INTEGER,                -- request.cf.botManagement.score when present (not on the Free plan)
  verified_bot INTEGER,             -- request.cf.botManagement.verifiedBot when present
  user_id TEXT                      -- signed-in user when the site knows it (not populated yet)
);
CREATE INDEX page_views_ts ON page_views(ts);
CREATE INDEX page_views_day_class ON page_views(day, bot_class);
CREATE INDEX page_views_path ON page_views(path, ts);
CREATE INDEX page_views_ip ON page_views(ip, ts);
