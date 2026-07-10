const SystemConfig = require('../models/SystemConfig');
const logger = require('../utils/logger');

/**
 * Configurable LLM service. Reads provider/keys/models from admin-managed SystemConfig.
 */
class LLMService {
  static getProvider() {
    const provider = SystemConfig.getLLMProvider();
    switch (provider) {
      case 'openai': return new OpenAIProvider();
      case 'gemini': return new GeminiProvider();
      case 'claude': return new ClaudeProvider();
      case 'openrouter': return new OpenRouterProvider();
      case 'local': return new LocalProvider();
      default: throw new Error(`Unknown LLM provider: ${provider}`);
    }
  }

  static async generate(messages, options = {}) {
    const provider = this.getProvider();
    return provider.generate(messages, options);
  }

  static async generateStream(messages, options = {}) {
    const provider = this.getProvider();
    return provider.generateStream(messages, options);
  }
}

class OpenAIProvider {
  async generate(messages, options = {}) {
    const apiKey = SystemConfig.getAPIKey('openai');
    if (!apiKey) throw new Error('OpenAI API key not configured. Ask your admin to set it up.');

    const model = SystemConfig.getModel('openai');
    const temperature = options.temperature ?? SystemConfig.getTemperature();

    const body = { model, messages, temperature, stream: false };
    body.max_completion_tokens = options.maxTokens || 2048;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${err}`);
    }

    const data = await response.json();
    return { content: data.choices[0].message.content, usage: data.usage };
  }

  async generateStream(messages, options = {}) {
    const apiKey = SystemConfig.getAPIKey('openai');
    if (!apiKey) throw new Error('OpenAI API key not configured. Ask your admin to set it up.');

    const model = SystemConfig.getModel('openai');
    const temperature = options.temperature ?? SystemConfig.getTemperature();

    const body = { model, messages, temperature, stream: true };
    body.max_completion_tokens = options.maxTokens || 2048;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${err}`);
    }

    return response.body;
  }
}

class GeminiProvider {
  async generate(messages, options = {}) {
    const apiKey = SystemConfig.getAPIKey('gemini');
    if (!apiKey) throw new Error('Gemini API key not configured. Ask your admin to set it up.');

    const model = SystemConfig.getModel('gemini');
    const temperature = options.temperature ?? SystemConfig.getTemperature();

    const contents = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));

    const systemInstruction = messages.find(m => m.role === 'system');
    const body = {
      contents,
      generationConfig: { temperature, maxOutputTokens: options.maxTokens || 2048 }
    };
    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction.content }] };
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${err}`);
    }

    const data = await response.json();
    return {
      content: data.candidates[0].content.parts[0].text,
      usage: data.usageMetadata
    };
  }

  async generateStream(messages, options = {}) {
    const apiKey = SystemConfig.getAPIKey('gemini');
    if (!apiKey) throw new Error('Gemini API key not configured.');

    const model = SystemConfig.getModel('gemini');
    const temperature = options.temperature ?? SystemConfig.getTemperature();

    const contents = messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));

    const systemInstruction = messages.find(m => m.role === 'system');
    const body = { contents, generationConfig: { temperature } };
    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction.content }] };
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini streaming error: ${response.status} - ${err}`);
    }
    return response.body;
  }
}

class ClaudeProvider {
  async generate(messages, options = {}) {
    const apiKey = SystemConfig.getAPIKey('claude');
    if (!apiKey) throw new Error('Claude API key not configured. Ask your admin to set it up.');

    const model = SystemConfig.getModel('claude');
    const temperature = options.temperature ?? SystemConfig.getTemperature();
    const system = messages.find(m => m.role === 'system')?.content || '';
    const chatMessages = messages.filter(m => m.role !== 'system');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model, system, messages: chatMessages,
        temperature, max_tokens: options.maxTokens || 2048
      })
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Claude API error: ${response.status} - ${err}`);
    }

    const data = await response.json();
    return { content: data.content[0].text, usage: data.usage };
  }

  async generateStream(messages, options = {}) {
    const apiKey = SystemConfig.getAPIKey('claude');
    if (!apiKey) throw new Error('Claude API key not configured.');

    const model = SystemConfig.getModel('claude');
    const temperature = options.temperature ?? SystemConfig.getTemperature();
    const system = messages.find(m => m.role === 'system')?.content || '';
    const chatMessages = messages.filter(m => m.role !== 'system');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model, system, messages: chatMessages,
        temperature, max_tokens: options.maxTokens || 2048, stream: true
      })
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Claude streaming error: ${response.status} - ${err}`);
    }
    return response.body;
  }
}

class OpenRouterProvider {
  async generate(messages, options = {}) {
    const apiKey = SystemConfig.getAPIKey('openrouter');
    if (!apiKey) throw new Error('OpenRouter API key not configured. Ask your admin to set it up.');

    const model = SystemConfig.getModel('openrouter');
    const temperature = options.temperature ?? SystemConfig.getTemperature();

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:3000'
      },
      body: JSON.stringify({ model, messages, temperature, max_tokens: options.maxTokens || 2048 })
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} - ${err}`);
    }

    const data = await response.json();
    return { content: data.choices[0].message.content, usage: data.usage };
  }

  async generateStream(messages, options = {}) {
    const apiKey = SystemConfig.getAPIKey('openrouter');
    if (!apiKey) throw new Error('OpenRouter API key not configured.');

    const model = SystemConfig.getModel('openrouter');
    const temperature = options.temperature ?? SystemConfig.getTemperature();

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:3000'
      },
      body: JSON.stringify({ model, messages, temperature, max_tokens: options.maxTokens || 2048, stream: true })
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenRouter streaming error: ${response.status} - ${err}`);
    }
    return response.body;
  }
}

class LocalProvider {
  async generate(messages, options = {}) {
    const url = SystemConfig.getLocalLLMUrl();
    const model = SystemConfig.getModel('local');
    const temperature = options.temperature ?? SystemConfig.getTemperature();

    const response = await fetch(`${url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: false, options: { temperature } })
    });

    if (!response.ok) throw new Error(`Local LLM error: ${response.status}`);

    const data = await response.json();
    return { content: data.message.content, usage: { total_duration: data.total_duration } };
  }

  async generateStream(messages, options = {}) {
    const url = SystemConfig.getLocalLLMUrl();
    const model = SystemConfig.getModel('local');
    const temperature = options.temperature ?? SystemConfig.getTemperature();

    const response = await fetch(`${url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true, options: { temperature } })
    });

    if (!response.ok) throw new Error(`Local LLM streaming error: ${response.status}`);
    return response.body;
  }
}

module.exports = LLMService;
