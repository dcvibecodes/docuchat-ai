const cheerio = require('cheerio');
const logger = require('../utils/logger');

/**
 * Fetches a public webpage and extracts clean text content.
 */
async function scrapeUrl(url) {
  logger.info('Scraping URL', { url });

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; DocuChatBot/2.0)',
      'Accept': 'text/html,application/xhtml+xml'
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(30000)
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  // Remove non-content elements
  $('script, style, nav, footer, header, iframe, noscript, svg, [role="navigation"], [role="banner"], .sidebar, .menu, .nav, .footer, .header, .advertisement, .ad').remove();

  // Get page title
  const title = $('title').text().trim() || $('h1').first().text().trim() || url;

  // Extract main content (prefer article/main, fallback to body)
  let contentEl = $('article, main, [role="main"], .content, .post-content, .entry-content').first();
  if (!contentEl.length) contentEl = $('body');

  // Extract text with some structure
  let text = '';
  contentEl.find('h1, h2, h3, h4, h5, h6, p, li, td, th, blockquote, pre').each(function() {
    const tag = $(this).prop('tagName').toLowerCase();
    const content = $(this).text().trim();
    if (!content) return;

    if (tag.startsWith('h')) {
      text += `\n\n## ${content}\n`;
    } else if (tag === 'li') {
      text += `\n- ${content}`;
    } else {
      text += `\n\n${content}`;
    }
  });

  // Fallback: if structured extraction got nothing, just get all text
  if (text.trim().length < 100) {
    text = contentEl.text();
  }

  // Clean up
  text = text
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .split('\n').map(l => l.trim()).join('\n')
    .trim();

  if (!text || text.length < 50) {
    throw new Error('Could not extract meaningful content from this URL');
  }

  logger.info('URL scraped successfully', { url, title, textLength: text.length });

  return { title, text, url };
}

module.exports = { scrapeUrl };
