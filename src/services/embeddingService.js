const SystemConfig = require('../models/SystemConfig');
const logger = require('../utils/logger');

/**
 * Generates embeddings for an array of text chunks.
 * Reads provider/key/model from admin-configured SystemConfig.
 */
async function generateEmbeddings(texts) {
  const provider = SystemConfig.getEmbeddingProvider();

  switch (provider) {
    case 'openai':
      return generateOpenAIEmbeddings(texts);
    case 'local':
      return generateLocalEmbeddings(texts);
    default:
      throw new Error(`Unknown embedding provider: ${provider}`);
  }
}

async function generateOpenAIEmbeddings(texts) {
  const apiKey = SystemConfig.getAPIKey('openai');
  if (!apiKey) {
    throw new Error('OpenAI API key not configured. Admin must set it in Settings.');
  }

  const model = SystemConfig.getEmbeddingModel();
  const batchSize = 100;
  const results = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000); // 60s per batch

    try {
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ model, input: batch }),
        signal: controller.signal
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`OpenAI Embedding API error: ${response.status} - ${errorBody}`);
      }

      const data = await response.json();
      const dimensions = data.data[0].embedding.length;

      for (const item of data.data) {
        results.push({
          vector: item.embedding,
          model,
          dimensions
        });
      }

      logger.debug('Embedding batch processed', { batch: i / batchSize + 1, count: batch.length });
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('OpenAI Embedding API timeout (60s)');
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  return results;
}

async function generateLocalEmbeddings(texts) {
  const url = SystemConfig.getLocalEmbeddingUrl();
  const model = SystemConfig.getLocalEmbeddingModel();
  const results = [];

  for (const text of texts) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(`${url}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: text }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Local embedding error: ${response.status}`);
      }

      const data = await response.json();
      results.push({
        vector: data.embedding,
        model,
        dimensions: data.embedding.length
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('Local embedding timeout (30s)');
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  return results;
}

async function generateQueryEmbedding(text) {
  const results = await generateEmbeddings([text]);
  return results[0];
}

module.exports = { generateEmbeddings, generateQueryEmbedding };
