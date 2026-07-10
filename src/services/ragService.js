const { generateQueryEmbedding } = require('./embeddingService');
const { searchSimilar } = require('./vectorSearch');
const LLMService = require('./llmService');
const Message = require('../models/Message');
const SystemConfig = require('../models/SystemConfig');
const logger = require('../utils/logger');

/**
 * Generates a RAG response for a user query.
 * Uses admin-configured system prompt, retrieval settings, and LLM.
 */
async function generateResponse({ query, conversationId, userId, knowledgeBaseId, stream, onChunk }) {
  logger.info('Generating RAG response', { userId, queryLength: query.length });

  // Step 1: Generate query embedding
  const queryEmbedding = await generateQueryEmbedding(query);

  // Step 2: Search for relevant chunks
  const maxChunks = SystemConfig.getMaxChunks();
  const threshold = SystemConfig.getSimilarityThreshold();

  const relevantChunks = await searchSimilar(queryEmbedding, {
    userId,
    knowledgeBaseId,
    topK: maxChunks,
    threshold
  });

  // Step 3: Build context and citations
  let context = '';
  const citations = [];

  for (const chunk of relevantChunks) {
    const pageInfo = chunk.pageNumber ? ` (Page ${chunk.pageNumber})` : '';
    context += `\n---\nDocument: ${chunk.documentName}${pageInfo}\n${chunk.content}\n`;

    citations.push({
      documentName: chunk.documentName,
      documentId: chunk.documentId,
      pageNumber: chunk.pageNumber,
      heading: chunk.heading,
      excerpt: chunk.content.substring(0, 200),
      similarity: chunk.similarity
    });
  }

  // Step 4: Build conversation messages
  const systemPrompt = SystemConfig.getSystemPrompt();
  const messages = [{ role: 'system', content: systemPrompt }];

  // Add conversation history
  if (conversationId) {
    const history = Message.getRecentMessages(conversationId, 6);
    for (const msg of history) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
  }

  // Step 5: Build the user message with or without context
  let userMessage;
  if (relevantChunks.length > 0) {
    userMessage = `Context from uploaded documents:\n${context}\n\n---\nQuestion: ${query}`;
  } else {
    // No relevant documents found — let the LLM handle it naturally
    // It will use the system prompt rules to determine how to respond
    userMessage = `[No relevant document context was found for this query.]\n\nUser message: ${query}`;
  }
  messages.push({ role: 'user', content: userMessage });

  // Step 6: Generate LLM response
  if (stream && onChunk) {
    const streamResult = await streamResponse(messages, onChunk);
    return { content: streamResult, citations };
  } else {
    const result = await LLMService.generate(messages);
    return { content: result.content, citations };
  }
}

async function streamResponse(messages, onChunk) {
  const provider = SystemConfig.getLLMProvider();
  let fullContent = '';

  try {
    const stream = await LLMService.generateStream(messages);
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // Keep the last incomplete line in the buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim() || line.trim() === 'data: [DONE]') continue;

        if (line.startsWith('data: ')) {
          try {
            const json = JSON.parse(line.slice(6));
            let chunk = '';

            if (provider === 'openai' || provider === 'openrouter') {
              chunk = json.choices?.[0]?.delta?.content || '';
            } else if (provider === 'claude') {
              if (json.type === 'content_block_delta') {
                chunk = json.delta?.text || '';
              }
            } else if (provider === 'gemini') {
              chunk = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
            }

            if (chunk) {
              fullContent += chunk;
              onChunk(chunk);
            }
          } catch (e) { /* skip malformed */ }
        } else if (provider === 'local') {
          try {
            const json = JSON.parse(line);
            const chunk = json.message?.content || '';
            if (chunk) {
              fullContent += chunk;
              onChunk(chunk);
            }
          } catch (e) { /* skip */ }
        }
      }
    }

    // Process any remaining buffer
    if (buffer.trim() && buffer.startsWith('data: ') && buffer.trim() !== 'data: [DONE]') {
      try {
        const json = JSON.parse(buffer.slice(6));
        const chunk = json.choices?.[0]?.delta?.content || json.delta?.text || '';
        if (chunk) { fullContent += chunk; onChunk(chunk); }
      } catch (e) { /* ignore */ }
    }
  } catch (err) {
    logger.error('Streaming error', { error: err.message });
    throw err;
  }

  return fullContent;
}

module.exports = { generateResponse };
