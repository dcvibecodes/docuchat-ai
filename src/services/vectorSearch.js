const Embedding = require('../models/Embedding');
const Chunk = require('../models/Chunk');
const Document = require('../models/Document');
const SystemConfig = require('../models/SystemConfig');
const logger = require('../utils/logger');

/**
 * Performs cosine similarity search over stored embeddings.
 * Searches ALL embeddings since this is a shared knowledge base.
 */
async function searchSimilar(queryEmbedding, { userId, knowledgeBaseId, topK, threshold }) {
  const maxChunks = topK || SystemConfig.getMaxChunks();
  const minThreshold = Math.min(threshold || SystemConfig.getSimilarityThreshold(), 0.5);

  // Get ALL embeddings (shared knowledge base — all users query the same documents)
  // But filter out disabled documents and disabled source groups
  const db = require('../database/db');
  const embeddings = db.all(`
    SELECT e.* FROM embeddings e
    JOIN documents d ON e.document_id = d.id
    LEFT JOIN source_groups sg ON d.group_id = sg.id
    WHERE (d.enabled IS NULL OR d.enabled = 1)
    AND (d.group_id IS NULL OR d.group_id = '' OR sg.id IS NULL OR sg.enabled = 1)
  `);

  logger.info('Vector search starting', { embeddingCount: embeddings?.length || 0, threshold: minThreshold, queryVectorLength: queryEmbedding?.vector?.length || 0 });

  if (!embeddings || embeddings.length === 0) {
    logger.info('No embeddings found in database');
    return [];
  }

  // Compute cosine similarities
  const queryVector = queryEmbedding.vector;
  const scored = [];

  for (const emb of embeddings) {
    // sql.js returns BLOB as Uint8Array — copy to aligned buffer for Float32Array
    let storedVector;
    try {
      const bytes = emb.embedding;
      const alignedBuf = new ArrayBuffer(bytes.length);
      new Uint8Array(alignedBuf).set(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
      storedVector = Array.from(new Float32Array(alignedBuf));
    } catch (e) {
      continue; // skip malformed embedding
    }

    const similarity = cosineSimilarity(queryVector, storedVector);

    if (scored.length === 0 && embeddings.indexOf(emb) === 0) {
      logger.info('First embedding similarity check', { similarity: similarity.toFixed(4), vectorLenMatch: queryVector.length === storedVector.length });
    }

    if (similarity >= minThreshold) {
      scored.push({
        chunkId: emb.chunk_id,
        documentId: emb.document_id,
        similarity
      });
    }
  }

  // Sort by similarity descending
  scored.sort((a, b) => b.similarity - a.similarity);

  // Take top K
  const topResults = scored.slice(0, maxChunks);

  // Deduplicate: if multiple chunks from same document are very similar, keep the best
  const seen = new Set();
  const deduplicated = [];
  for (const result of topResults) {
    const key = `${result.documentId}_${result.chunkId}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduplicated.push(result);
    }
  }

  // Enrich with chunk content and document metadata
  const enriched = [];
  for (const result of deduplicated) {
    const chunk = Chunk.findById(result.chunkId);
    const doc = Document.findById(result.documentId);

    if (chunk && doc) {
      enriched.push({
        content: chunk.content,
        documentName: doc.original_name,
        documentId: doc.id,
        pageNumber: chunk.page_number,
        heading: chunk.heading,
        chunkIndex: chunk.chunk_index,
        similarity: result.similarity
      });
    }
  }

  logger.info('Vector search complete', {
    totalEmbeddings: embeddings.length,
    aboveThreshold: scored.length,
    returned: enriched.length,
    threshold: minThreshold,
    topScore: scored.length > 0 ? scored[0].similarity.toFixed(4) : 'none'
  });

  return enriched;
}

/**
 * Computes cosine similarity between two vectors
 */
function cosineSimilarity(vecA, vecB) {
  if (vecA.length !== vecB.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

module.exports = { searchSimilar, cosineSimilarity };
