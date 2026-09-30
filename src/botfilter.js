'use strict';
const AI_CRAWLERS = ['gptbot','oai-searchbot','chatgpt-user','claudebot','claude-user','anthropic-ai','google-extended','applebot-extended','ccbot','perplexitybot','youbot','bytespider','meta-externalagent','amazonbot','diffbot','imagesiftbot','timpibot','omgilibot','cohere-ai','pangu'];

function matchedCrawler(req) {
  const ua = String((req && req.headers && req.headers['user-agent']) || '').toLowerCase();
  if (!ua) return null;
  return AI_CRAWLERS.find((f) => ua.includes(f)) || null;
}

function handle(req, res) {
  const match = matchedCrawler(req);
  if (!match) return false;
  console.log('[botfilter] refused ' + match + ' -> ' + req.method + ' ' + req.url);
  res.statusCode = 403;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('X-Robots-Tag', 'noai, noimageai');
  res.setHeader('Cache-Control', 'no-store');
  res.end('This site is not available to AI crawlers.\n');
  return true;
}

module.exports = { handle };
