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

/** [faute, correction, catégorie, sévérité, explication] — fautes sans accent. */
const FIXTURES = [
  ['a', 'à', 'orthographe', 'erreur', 'La préposition « à » se met ici.'],
  ['heur', 'heures', 'orthographe', 'erreur', 'Le pluriel de « heure » est obligatoire ici.'],
  ['etre', 'été', 'orthographe', 'erreur', 'Participe passé de « être », avec accent.'],
  ['malgres', 'malgré', 'orthographe', 'erreur', '« malgré » prend un accent grave.'],
];

function extractText(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const user = messages.find((message) => message?.role === 'user');
  const content = typeof user?.content === 'string' ? user.content : '';
  const match = content.match(/<texte>([\s\S]*)<\/texte>/);
  return (match ? match[1] : content).trim();
}

/**
 * Copie du texte sans accents et en minuscules, avec la table de correspondance
 * vers les index du texte d'origine : « Malgrés » doit être trouvé par la faute
 * `malgres`. Chaque caractère source reste un caractère ici, donc les index se
 * transportent tels quels.
 */
function stripDiacritics(text) {
  const chars = [];
  const map = [];
  for (let index = 0; index < text.length; index += 1) {
    const stripped = text[index]
      .normalize('NFD')
      .replace(/\p{M}/gu, '');
    if (stripped === '') continue;
    chars.push(stripped[0].toLowerCase());
    map.push(index);
  }
  return { text: chars.join(''), map };
}

/**
 * Première occurrence de `word` **à la frontière d'un mot** : sans cette garde,
 * « a » tombait dans « aura » et la démo affichait « projet àura lieu ».
 */
function findWholeWord(text, word) {
  const { text: haystack, map } = stripDiacritics(text);
  const needle = word.toLowerCase();
  for (let index = 0; index <= haystack.length - needle.length; index += 1) {
    if (haystack.slice(index, index + needle.length) !== needle) continue;
    const sourceIndex = map[index];
    const before = sourceIndex === 0 ? '' : text[sourceIndex - 1];
    const after = text[map[index + needle.length - 1] + 1] ?? '';
    const isWordChar = (char) => char !== '' && /[\p{L}\p{N}]/u.test(char);
    if (!isWordChar(before) && !isWordChar(after)) return sourceIndex;
  }
  return -1;
}

function buildErrors(text) {
  const errors = [];
  for (const [wrong, right, category, severity, explanation] of FIXTURES) {
    const index = findWholeWord(text, wrong);
    if (index === -1) continue;
    errors.push({
      excerpt: text.slice(index, index + wrong.length),
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

  // Deux modes permettent d'exercer la chaîne de repli du client :
  //
  // - `reject-json-schema` : l'hôte refuse le mode structuré mais accepte le
  //   paramètre. L'application doit basculer en `json_object` et réussir en 2 requêtes.
  //
  // - `reject-response-format` : l'hôte refuse le paramètre lui-même (llama.cpp,
  //   certaines versions d'Ollama). L'application doit aboutir en 3 requêtes, la
  //   dernière sans `response_format`, et le JSON est ici renvoyé entouré de texte
  //   pour exercer l'extraction leniente du dernier étage.
  const mode = process.env.MOCK_LLM_MODE;
  const refusesSchema = mode === 'reject-json-schema' && body?.response_format?.type === 'json_schema';
  const refusesParameter = mode === 'reject-response-format' && body?.response_format !== undefined;

  if (refusesSchema || refusesParameter) {
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({
        error: {
          message: refusesParameter
            ? "Unsupported parameter: 'response_format' is not supported by this model."
            : "Unsupported value: 'json_schema' in 'response_format'. Use 'json_object'.",
        },
      }),
    );
    return;
  }

  const text = extractText(body);
  const content = JSON.stringify(buildErrors(text));
  const payload = {
    id: 'chatcmpl-mock',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: MODEL,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: body?.response_format === undefined ? `Voici les anomalies : ${content}` : content,
        },
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
