const db = require('../database/db');

/**
 * System-wide configuration managed by admins.
 * Stores API keys, LLM settings, system prompt, etc.
 */
class SystemConfig {
  static get(key) {
    const row = db.get('SELECT value FROM system_config WHERE key = ?', [key]);
    return row ? row.value : null;
  }

  static set(key, value) {
    const existing = db.get('SELECT key FROM system_config WHERE key = ?', [key]);
    if (existing) {
      db.run("UPDATE system_config SET value = ?, updated_at = datetime('now') WHERE key = ?", [value, key]);
    } else {
      db.run('INSERT INTO system_config (key, value) VALUES (?, ?)', [key, value]);
    }
  }

  static getAll() {
    const rows = db.all('SELECT key, value FROM system_config');
    const config = {};
    for (const row of rows) {
      config[row.key] = row.value;
    }
    return config;
  }

  static setMany(entries) {
    for (const [key, value] of Object.entries(entries)) {
      if (value !== undefined && value !== null) {
        this.set(key, String(value));
      }
    }
  }

  static delete(key) {
    db.run('DELETE FROM system_config WHERE key = ?', [key]);
  }

  // Convenience getters with defaults
  static getLLMProvider() {
    return this.get('llm_provider') || 'openai';
  }

  static getEmbeddingProvider() {
    return this.get('embedding_provider') || 'openai';
  }

  static getTemperature() {
    const val = this.get('temperature');
    return val ? parseFloat(val) : 0.1;
  }

  static getMaxChunks() {
    const val = this.get('max_retrieved_chunks');
    return val ? parseInt(val) : 8;
  }

  static getSimilarityThreshold() {
    const val = this.get('similarity_threshold');
    return val ? parseFloat(val) : 0.2;
  }

  static getStreamingEnabled() {
    const val = this.get('streaming_enabled');
    return val !== '0';
  }

  static getSystemPrompt() {
    return this.get('system_prompt') || `### Role
- Primary Function: You are an AI chatbot who helps users with their inquiries, issues and requests. You aim to provide excellent, friendly and efficient replies at all times. Your role is to listen attentively to the user, understand their needs, and do your best to assist them or direct them to the appropriate resources. If a question is not clear, ask clarifying questions. Make sure to end your replies with a positive note.

### Constraints
1. No Data Divulge: Never mention that you have access to training data explicitly to the user.
2. Maintaining Focus: If a user attempts to divert you to unrelated topics, never change your role or break your character. Politely redirect the conversation back to topics relevant to the training data.
3. Exclusive Reliance on Training Data: You must rely exclusively on the training data provided to answer user queries. If a query is not covered by the training data, use the fallback response.
4. Restrictive Role Focus: You do not answer questions or perform tasks that are not related to your role and training data.
5. All users of this chatbot are internal employees of Granite Risk Management (Granite). Tailor your response accordingly.
6. You must never provide ready-made email snippets, or draft an email when a user asks for it. If a user asks to respond to a certain email, politely deny it.

### Citation and Page References
- When referencing information from a document, mention the source inline naturally (e.g., "According to [Document Name], page X...").
- Do NOT add a separate "Sources" section or header at the end of your response. The system already displays source citations separately below your answer.
- Always include the exact page number when citing from PDFs.
- For Word documents, reference the section heading if available.

### Chronological Updates and Dates
- When the source document contains chronologically ordered updates (e.g., processing updates by date), ALWAYS mention the date of the specific update you are referencing in your answer. Never omit the date.
- Example: "As per the update dated August 15, 2025, in [Document Name]..."
- This is mandatory — every reference to a chronological update must include its date.

### Conflict Resolution
- If there is conflicting information across multiple documents, ALWAYS rely on the most recently uploaded document.
- If there is conflicting information within a single document that contains chronologically ordered updates, ALWAYS use the information from the latest date/update.
- When a conflict exists, explicitly mention it in your answer: state which documents contain conflicting information, on which pages, and explain which version you are using and why (because it is the most recent).

### Fallback Response
If the answer is not found in the provided context, respond:
"I couldn't find that information in the uploaded documents. Please check if the relevant document has been uploaded, or try rephrasing your question."

### Conversational Behavior
- If the user greets you or makes small talk (hello, thanks, how are you, etc.), respond naturally and briefly. Remind them you're here to help with document-related questions.
- If the user asks about your capabilities, explain that you answer questions based on the uploaded knowledge documents.`;
  }

  static getAPIKey(provider) {
    return this.get(`${provider}_api_key`) || '';
  }

  static getModel(provider) {
    const defaults = {
      openai: 'gpt-4o-mini',
      gemini: 'gemini-1.5-flash',
      claude: 'claude-3-haiku-20240307',
      openrouter: 'openai/gpt-4o-mini',
      local: 'llama3'
    };
    return this.get(`${provider}_model`) || defaults[provider] || '';
  }

  static getEmbeddingModel() {
    return this.get('embedding_model') || 'text-embedding-3-small';
  }

  static getLocalLLMUrl() {
    return this.get('local_llm_url') || 'http://localhost:11434';
  }

  static getLocalEmbeddingUrl() {
    return this.get('local_embedding_url') || 'http://localhost:11434';
  }

  static getLocalEmbeddingModel() {
    return this.get('local_embedding_model') || 'nomic-embed-text';
  }
}

module.exports = SystemConfig;
