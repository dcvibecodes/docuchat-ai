const cheerio = require('cheerio');
const logger = require('../utils/logger');

/**
 * Fetches and parses a sitemap (XML or index) and returns a list of URLs.
 * Handles sitemap index files by recursively fetching sub-sitemaps.
 */
async function fetchSitemap(sitemapUrl) {
  logger.info('Fetching sitemap', { url: sitemapUrl });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  let response;
  try {
    response = await fetch(sitemapUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DocuChatBot/2.0)',
        'Accept': 'application/xml,text/xml,text/plain'
      },
      redirect: 'follow',
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') throw new Error(`Sitemap fetch timeout: ${sitemapUrl}`);
    throw err;
  }
  clearTimeout(timeout);

  if (!response.ok) {
    throw new Error(`Failed to fetch sitemap: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();

  // Detect if this is a sitemap index
  if (text.includes('<sitemapindex')) {
    return parseSitemapIndex(text, sitemapUrl);
  }

  // Check if it's plain text (one URL per line)
  if (!text.includes('<urlset') && !text.includes('<xml')) {
    const urls = text.split('\n').map(l => l.trim()).filter(l => l.startsWith('http'));
    return urls.map(url => ({ loc: url, lastmod: null }));
  }

  // Standard XML sitemap
  return parseSitemapXml(text);
}

function parseSitemapXml(xml) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const urls = [];

  $('url').each(function () {
    const loc = $(this).find('loc').text().trim();
    const lastmod = $(this).find('lastmod').text().trim() || null;
    if (loc) {
      urls.push({ loc, lastmod });
    }
  });

  return urls;
}

async function parseSitemapIndex(xml, baseUrl) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const subSitemaps = [];

  $('sitemap').each(function () {
    const loc = $(this).find('loc').text().trim();
    if (loc) subSitemaps.push(loc);
  });

  logger.info('Sitemap index found', { subSitemapCount: subSitemaps.length });

  // Fetch all sub-sitemaps in parallel (with concurrency limit)
  const allUrls = [];
  const batchSize = 5;

  for (let i = 0; i < subSitemaps.length; i += batchSize) {
    const batch = subSitemaps.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(url => fetchSitemap(url))
    );
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allUrls.push(...result.value);
      }
    }
  }

  return allUrls;
}

/**
 * Auto-detect sitemap URL from a domain.
 * Tries common sitemap locations.
 */
async function detectSitemap(domain) {
  let base = domain.trim();
  if (!base.match(/^https?:\/\//i)) base = 'https://' + base;
  base = base.replace(/\/+$/, '');

  const candidates = [
    base + '/sitemap.xml',
    base + '/sitemap_index.xml',
    base + '/wp-sitemap.xml',
    base + '/sitemap.txt'
  ];

  for (const url of candidates) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(url, {
        method: 'HEAD',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DocuChatBot/2.0)' },
        redirect: 'follow',
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (res.ok) {
        return url;
      }
    } catch (e) {
      // try next
    }
  }

  return null;
}

module.exports = { fetchSitemap, detectSitemap };
