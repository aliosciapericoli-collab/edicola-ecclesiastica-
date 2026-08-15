'use strict';
/**
 * services/claude-chat.js — Claude Haiku per chat Genio Giuridico
 * Ragiona sui dati reali del grafo locale (zero web search).
 */

const Anthropic = require('@anthropic-ai/sdk');

let _client = null;
function getClient() {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY || '';
    if (!apiKey || apiKey === 'placeholder') throw new Error('ANTHROPIC_API_KEY non configurata');
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

async function callClaude(systemPrompt, userMessage) {
  const client = getClient();
  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1500,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });
  return {
    content: response.content[0].text,
    citations: [],
    model: 'haiku',
  };
}

module.exports = { callClaude };
