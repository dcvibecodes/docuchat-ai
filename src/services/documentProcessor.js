const path = require('path');
const fs = require('fs');
const Document = require('../models/Document');
const Chunk = require('../models/Chunk');
const Embedding = require('../models/Embedding');
const config = require('../config');
const logger = require('../utils/logger');
const { extractText } = require('./extractors');
const { chunkText } = require('./chunker');
const { generateEmbeddings } = require('./embeddingService');

async function processDocument(documentId) {
  const doc = Document.findById(documentId);
  if (!doc) {
    throw new Error(`Document ${documentId} not found`);
  }

  logger.info('Processing document', { docId: doc.id, name: doc.original_name });

  try {
    // Step 1: Extract text from file (10%)
    Document.updateProgress(doc.id, 10);
    const filePath = path.resolve(config.paths.uploads, doc.user_id, doc.filename);
    if (!fs.existsSync(filePath)) {
      throw new Error('File not found on disk');
    }

    const { text, pageCount, metadata } = await extractText(filePath, doc.file_type);

    if (!text || text.trim().length === 0) {
      throw new Error('No text content could be extracted from the document');
    }

    // Update page count
    if (pageCount) {
      const db = require('../database/db');
      db.run('UPDATE documents SET page_count = ? WHERE id = ?', [pageCount, doc.id]);
    }

    // Step 2: Chunk the text (30%)
    Document.updateProgress(doc.id, 30);
    const chunks = chunkText(text, {
      chunkSize: config.rag.chunkSize,
      chunkOverlap: config.rag.chunkOverlap,
      metadata
    });

    logger.info('Text chunked', { docId: doc.id, chunkCount: chunks.length });

    // Step 3: Store chunks (40%)
    Document.updateProgress(doc.id, 40);
    const chunkRecords = chunks.map((chunk, index) => ({
      documentId: doc.id,
      userId: doc.user_id,
      knowledgeBaseId: doc.knowledge_base_id,
      content: chunk.content,
      chunkIndex: index,
      pageNumber: chunk.pageNumber || null,
      heading: chunk.heading || null,
      tokenCount: chunk.tokenCount || Math.ceil(chunk.content.length / 4)
    }));

    const chunkIds = Chunk.createMany(chunkRecords);
    Document.updateChunkCount(doc.id, chunkIds.length);

    // Step 4: Generate embeddings (50% → 90%)
    Document.updateProgress(doc.id, 50);
    const embeddingResults = await generateEmbeddings(chunks.map(c => c.content));
    Document.updateProgress(doc.id, 90);

    // Step 5: Store embeddings (90% → 100%)
    const embeddingRecords = embeddingResults.map((emb, index) => ({
      chunkId: chunkIds[index],
      documentId: doc.id,
      userId: doc.user_id,
      knowledgeBaseId: doc.knowledge_base_id,
      embedding: Buffer.from(new Float32Array(emb.vector).buffer),
      model: emb.model,
      dimensions: emb.dimensions
    }));

    Embedding.createMany(embeddingRecords);

    // Mark as ready (100%)
    Document.updateStatus(doc.id, 'ready');
    logger.info('Document processing complete', { docId: doc.id, chunks: chunkIds.length });
  } catch (err) {
    logger.error('Document processing failed', { docId: doc.id, error: err.message });
    Document.updateStatus(doc.id, 'error', err.message);
    throw err;
  }
}

module.exports = { processDocument };
