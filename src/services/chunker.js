const logger = require('../utils/logger');

/**
 * Splits text into semantic chunks with overlap.
 * Preserves paragraph boundaries and headings when possible.
 */
function chunkText(text, options = {}) {
  const {
    chunkSize = 512,
    chunkOverlap = 50,
    metadata = {}
  } = options;

  if (!text || text.trim().length === 0) return [];

  // Split by paragraphs first (semantic boundaries)
  const paragraphs = text.split(/\n\n+/);
  const chunks = [];
  let currentChunk = '';
  let currentHeading = null;
  let currentPage = 1;

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;

    // Detect headings (markdown style)
    const headingMatch = trimmed.match(/^#{1,6}\s+(.+)/);
    if (headingMatch) {
      currentHeading = headingMatch[1];
    }

    // Detect section markers (from DOCX extraction)
    const sectionMatch = trimmed.match(/^---SECTION:\s*(.+?)\s*---$/i);
    if (sectionMatch) {
      currentHeading = sectionMatch[1];
      continue;
    }

    // Detect page breaks (from PDF extraction)
    const pageMatch = trimmed.match(/^---\s*PAGE\s+(\d+)\s*---$/i);
    if (pageMatch) {
      currentPage = parseInt(pageMatch[1]);
      continue;
    }

    // Estimate tokens (rough: 1 token ≈ 4 chars)
    const tokenEstimate = Math.ceil(trimmed.length / 4);
    const currentTokens = Math.ceil(currentChunk.length / 4);

    if (currentTokens + tokenEstimate > chunkSize && currentChunk.length > 0) {
      // Save current chunk
      chunks.push({
        content: currentChunk.trim(),
        heading: currentHeading,
        pageNumber: currentPage,
        tokenCount: Math.ceil(currentChunk.trim().length / 4)
      });

      // Start new chunk with overlap
      const overlapText = getOverlap(currentChunk, chunkOverlap);
      currentChunk = overlapText + '\n\n' + trimmed;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + trimmed;
    }
  }

  // Don't forget the last chunk
  if (currentChunk.trim().length > 0) {
    chunks.push({
      content: currentChunk.trim(),
      heading: currentHeading,
      pageNumber: currentPage,
      tokenCount: Math.ceil(currentChunk.trim().length / 4)
    });
  }

  // Handle oversized chunks by splitting further
  const finalChunks = [];
  for (const chunk of chunks) {
    if (chunk.tokenCount > chunkSize * 1.5) {
      const subChunks = splitLargeChunk(chunk, chunkSize, chunkOverlap);
      finalChunks.push(...subChunks);
    } else {
      finalChunks.push(chunk);
    }
  }

  logger.debug('Chunking complete', { 
    inputLength: text.length, 
    chunks: finalChunks.length,
    avgChunkSize: Math.round(finalChunks.reduce((sum, c) => sum + c.tokenCount, 0) / finalChunks.length)
  });

  return finalChunks;
}

/**
 * Gets overlap text from the end of a chunk (by token count approximation)
 */
function getOverlap(text, overlapTokens) {
  const words = text.split(/\s+/);
  const overlapWords = Math.min(overlapTokens, Math.floor(words.length / 3));
  return words.slice(-overlapWords).join(' ');
}

/**
 * Splits an oversized chunk into smaller ones while respecting sentence boundaries
 */
function splitLargeChunk(chunk, chunkSize, chunkOverlap) {
  const sentences = chunk.content.split(/(?<=[.!?])\s+/);
  const subChunks = [];
  let current = '';

  for (const sentence of sentences) {
    const currentTokens = Math.ceil(current.length / 4);
    const sentenceTokens = Math.ceil(sentence.length / 4);

    if (currentTokens + sentenceTokens > chunkSize && current.length > 0) {
      subChunks.push({
        content: current.trim(),
        heading: chunk.heading,
        pageNumber: chunk.pageNumber,
        tokenCount: Math.ceil(current.trim().length / 4)
      });

      const overlap = getOverlap(current, chunkOverlap);
      current = overlap + ' ' + sentence;
    } else {
      current += (current ? ' ' : '') + sentence;
    }
  }

  if (current.trim().length > 0) {
    subChunks.push({
      content: current.trim(),
      heading: chunk.heading,
      pageNumber: chunk.pageNumber,
      tokenCount: Math.ceil(current.trim().length / 4)
    });
  }

  return subChunks;
}

module.exports = { chunkText };
