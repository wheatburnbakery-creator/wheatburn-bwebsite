'use strict';
/**
 * AI crawler filtering.
 *
 * ---------------------------------------------------------------------------
 * READ THIS FIRST — what this file does and does not do
 * ---------------------------------------------------------------------------
 *
 * It does NOT make the site undetectable. Nothing can. Any page a public
 * server sends is readable by anybody who asks for it, and no amount of code
 * changes that. The only genuinely undetectable websites are the ones that are
 * not published, or that sit behind a login.
 *
 * What this file DOES is refuse crawlers that identify themselves as AI
 * training or AI answer engines. That is a request enforced at the door, and
 * it only works against crawlers that declare themselves honestly.
 *
 * A scraper that sends a normal browser User-Agent — which is one line of
 * code — walks straight past this. So does anything crawling from a
 * residential IP with a real browser. Treat this as a "please do not", not a
 * lock.
 *
 * ---------------------------------------------------------------------------
 * SEARCH ENGINES ARE DELIBERATELY NOT BLOCKED
 * ---------------------------------------------------------------------------
 *
 * Googlebot, Bingbot, DuckDuckBot and the other search crawlers keep full
 * access. Removing the bakery from search would cost far more than AI training
 * access does, and for a shop whose customers search "bakery Kigali" that
 * trade is a bad one.
 *
 * Note the one that trips people up: Google-Extended is NOT Googlebot. It is a
 * separate token that controls AI training only. Blocking it opts the site out
 * of Gemini training while leaving Search, Maps and normal indexing untouched.
 * Same story for Applebot-Extended versus Applebot.
 */

/**
 * User-agent fragments of AI training crawlers and AI answer engines.
 * Matched as lowercase substrings against the request's User-Agent.
 *
 * Deliberately absent: googlebot, bingbot, duckduckbot, yandexbot, slurp,
 * baiduspider, applebot on its own.
 */
const AI_CRAWLERS = [
  // OpenAI
  'gptbot',            // training
  'oai-searchbot',     // ChatGPT search index
  'chatgpt-user',      // user-initiated fetch — block only if you want the
                       // site to be invisible inside ChatGPT answers

  // Anthropic
  'claudebot',
  'claude-user',
  'anthropic-ai',

  // Google / Apple AI training tokens (NOT their search crawlers)
  'google-extended',
  'applebot-extended',

  // Common Crawl — the corpus most open models train on
  'ccbot',

  // AI answer engines
  'perplexitybot',
  'youbot',

  // Big-tech AI crawlers
  'bytespider',        // ByteDance
  'meta-externalagent',
  'amazonbot',

  // Data brokers and smaller AI outfits
  'diffbot',
  'imagesiftbot',
  'timpibot',
  'omgilibot',
  'cohere-ai',
  'pangu'
];

/** 
*True when the request declares itself as an AI crawler. 
* @param {import('http').incoming message} req
*/
function isAiCrawler(
  /** 
*True when the request declares itself as an AI crawler. 
* @param {import('http').incoming message} req
*/
) {
  const ua = String((req && req.headers && req.headers['user-agent']) || '').toLowerCase();
  if (!ua) return false;
  return AI_CRAWLERS.some((fragment) => ua.includes(fragment));
}

/** The UA fragment that matched, or null. Useful for logging. */
function matchedCrawler(
  /**
 * True when the request declares itself as an AI crawler.
 * @param {import('http').IncomingMessage} req
 */
) {
  const ua = String((req && req.headers && req.headers['user-agent']) || '').toLowerCase();
  if (!ua) return null;
  return AI_CRAWLERS.find((fragment) => ua.includes(fragment)) || null;
}

/**
 * Refuses the request if it is an AI crawler.
 *
 * @returns {boolean} true when the request was blocked and the response ended.
 *                    The caller should then return immediately.
 */
function handle(
  /**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
) {
  const match = matchedCrawler(req);
  if (!match) return false;

  if (process.env.NODE_ENV !== 'test' && process.env.BOTFILTER_LOG !== 'off') {
    console.log(`[botfilter] refused ${match} -> ${req.method} ${req.url}`);
  }

  res.statusCode = 403;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  // Belt and braces: if a crawler ignores the 403 it is told again in headers.
  res.setHeader('X-Robots-Tag', 'noai, noimageai, noindex');
  res.setHeader('Cache-Control', 'no-store');
  res.end('This site is not available to AI crawlers.\n');
  return true;
}

module.exports = { AI_CRAWLERS, isAiCrawler, matchedCrawler, handle };
