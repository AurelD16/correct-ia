#!/usr/bin/env node
/**
 * Faux serveur OpenAI-compatible pour valider l'application de bout en bout sans
 * clé d'API. Écoute sur :8787 et répond un chat-completions contenant trois erreurs
 * fixes, calculées à partir du texte reçu (donc réellement alignables).
 *
 *   npm run mock:llm
 *   LLM_BASE_URL=http://localhost:8787/v1 LLM_API_KEY=mock LLM_MODEL=mock-1 npm run dev
 */

import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_LLM_PORT ?? 8787);
const MODEL = process.env.MOCK_LLM_MODEL ?? 'mock-1';

/** paires [faute, correction, catégorie, sévérité, explication] */
const FIXTURES = [
  ['a', 'à', 'orthographe', 'erreur', 'La préposition « à » se met ici.'],
  ['heur', 'heures', 'orthographe', 'erreur', 'Le pluriel de « heure » est obligatoire ici.'],
  ['ete', 'été', 'orthographe', 'erreur', 'Participe passé de « être », avec accent.'],
];

function extractText(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const user = messages.find((message) => message?.role === 'user');
  const content = typeof user?.content === 'string' ? user.content : '';
  const match = content.match(/<texte>([\s\S]*)<\/texte>/);
  return (match ? match[1] : content).trim();
}

function buildErrors(text) {
  const lower = text.toLowerCase();
  const errors = [];
  for (const [wrong, right, category, severity, explanation] of FIXTURES) {
    const index = lower.indexOf(` ${wrong}`);
    if (index === -1) continue;
    errors.push({
      excerpt: text.slice(index + 1, index + 1 + wrong.length),
      replacement: right,
      explanation,
      category,
      severity,
    });
  }
  return { errors };
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

const server = createServer(async (request, response) => {
  if (request.method !== 'POST' || !request.url?.endsWith('/chat/completions')) {
    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'Route inconnue' } }));
    return;
  }

  let body;
  try {
    body = JSON.parse((await readBody(request)) || '{}');
  } catch {
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'Corps JSON invalide' } }));
    return;
  }

  // Permet de tester le repli `response_format` : MOCK_LLM_MODE=reject-json-schema
  // renvoie le 400 que renverrait un hôte sans support du mode structuré.
  if (process.env.MOCK_LLM_MODE === 'reject-json-schema' && body?.response_format) {
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({
        error: {
          message: "Unsupported parameter: 'response_format' is not supported by this model.",
        },
      }),
    );
    return;
  }

  const text = extractText(body);
  const payload = {
    id: 'chatcmpl-mock',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: MODEL,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: JSON.stringify(buildErrors(text)) },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: Math.ceil(text.length / 4),
      completion_tokens: 120,
    },
  };

  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(payload));
});

server.listen(PORT, () => {
  console.log(`[mock-llm] endpoint compatible OpenAI sur http://localhost:${PORT}/v1`);
  console.log(`[mock-llm] modèle simulé : ${MODEL}`);
});
