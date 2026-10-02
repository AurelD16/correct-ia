# correct-ia

Application web de correction de texte (orthographe, grammaire, syntaxe, ponctuation, style)
via un **LLM compatible OpenAI**, avec surlignage des erreurs façon LanguageTool.

- **À gauche** : le texte d'entrée, éditable.
- **À droite** : le texte corrigé, chaque erreur surlignée et colorée par catégorie, avec
  l'explication en infobulle.
- **En bas** : la liste des erreurs (extrait, remplacement, explication, catégorie, sévérité).
  Cliquer une carte sélectionne le passage correspondant dans le texte d'entrée.

## Principe directeur

Le modèle renvoie des **extraits textuels**, jamais des positions. Les offsets sont recalculés
côté serveur par alignement déterministe (`lib/correction/align.ts`), et le texte corrigé est
reconstruit localement par application de ces remplacements (`lib/correction/build.ts`).

Conséquence : le texte affiché à droite et la liste d'erreurs ne peuvent pas diverger, et un
modèle approximatif ne peut pas corrompre les positions affichées.

La spécification complète est dans [`docs/spec-v1.md`](docs/spec-v1.md).

## Prérequis

- Node.js **≥ 20** (testé sur Node 22 et 26)

## Installation

```bash
npm install
cp .env.example .env.local   # puis compléter LLM_BASE_URL et LLM_API_KEY
```

## Configuration

Toutes les variables sont lues **côté serveur** (`lib/env.ts`). Aucune n'est préfixée par
`NEXT_PUBLIC_` : la clé d'API ne peut donc pas atteindre le bundle navigateur.

| Variable | Défaut | Rôle |
|---|---|---|
| `LLM_BASE_URL` | *(aucun)* | URL de base compatible OpenAI, se terminant généralement par `/v1`. **Obligatoire.** |
| `LLM_API_KEY` | *(aucun)* | Clé d'API. **Obligatoire.** Jamais exposée au client. |
| `LLM_MODEL` | `gpt-4o-mini` | Identifiant du modèle. |
| `LLM_LANGUAGE` | `fr` | Langue de travail du correcteur et langue par défaut de l'interface. |
| `LLM_TEMPERATURE` | `0` | Température de génération, entre 0 et 2. |
| `LLM_TIMEOUT_MS` | `60000` | Délai maximal d'attente du fournisseur. |
| `LLM_MAX_INPUT_CHARS` | `8000` | Longueur maximale acceptée. Au-delà : refus `400`, jamais de troncature. |
| `LLM_STRUCTURED_OUTPUT` | `true` | `true` → `response_format: json_schema` strict ; `false` → `json_object`. |
| `LOG_TEXT` | `false` | Journalise le texte utilisateur. À laisser à `false` hors développement. |

La configuration est validée au démarrage (zod). En développement, une configuration
incomplète échoue immédiatement avec un message explicite ; sinon l'API répond `503`
« service non configuré ».

## Lancer l'application

### Avec un vrai fournisseur

```bash
LLM_BASE_URL=https://api.openai.com/v1 \
LLM_API_KEY=sk-... \
LLM_MODEL=gpt-4o-mini \
npm run dev
```

Puis <http://localhost:3000>.

### Avec le faux serveur fourni (aucune clé requise)

```bash
# terminal 1
npm run mock:llm

# terminal 2
LLM_BASE_URL=http://localhost:8787/v1 LLM_API_KEY=mock LLM_MODEL=mock-1 npm run dev
```

`scripts/mock-llm.mjs` expose un endpoint `chat/completions` compatible OpenAI sur le port
`8787` et renvoie trois erreurs calculées à partir du texte reçu (par exemple `a` → `à`,
`heur` → `heures`, `ete` → `été`). Il permet de valider l'interface de bout en bout sans
fournisseur.

Pour tester le repli `json_schema` → `json_object` :

```bash
MOCK_LLM_MODE=reject-json-schema npm run mock:llm
```

## Contrat API

`POST /api/correct`

```jsonc
// requête
{ "text": "La reunion a lieu demain a 14 heur.", "language": "fr" }
```

| Code | Condition |
|---|---|
| `400` | Corps non JSON, `text` vide ou trop long |
| `422` | Sortie du modèle inexploitable après validation |
| `502` | Erreur amont (statut non 2xx) ou fournisseur injoignable — message assaini |
| `503` | Configuration absente |
| `504` | Timeout amont |

```jsonc
// réponse 200
{
  "source": "La reunion a lieu demain a 14 heur.",
  "corrected": "La réunion a lieu demain à 14 heures.",
  "errors": [
    {
      "id": "e3-10",
      "excerpt": "reunion",
      "replacement": "réunion",
      "explanation": "Accent aigu manquant.",
      "category": "orthographe",
      "severity": "erreur",
      "start": 3,
      "end": 10
    }
  ],
  "warnings": [],
  "language": "fr",
  "model": "gpt-4o-mini",
  "usage": { "promptTokens": 120, "completionTokens": 210 }
}
```

`replacement` vide signifie « supprimer ce passage ». Les `warnings` signalent les anomalies
que le serveur n'a pas pu localiser dans le texte source ; elles s'affichent dans la liste.

## Tests et vérifications

```bash
npm test        # 94 tests, aucune clé d'API requise
npm run lint
npm run typecheck
npm run build
```

Les tests sont colocalisés (`*.test.ts` / `*.test.tsx`) à côté du code qu'ils couvrent.
Aucun test ne contacte un fournisseur réel : `fetch` est simulé, l'API est testée en
injectant l'environnement.

## Adapter à un autre fournisseur OpenAI-compatible

vLLM, Ollama, llama.cpp, LiteLLM, OpenRouter… tant que l'endpoint
`POST {LLM_BASE_URL}/chat/completions` accepte un `Authorization: Bearer` :

1. Adapter `LLM_BASE_URL` (par exemple `http://localhost:11434/v1` pour Ollama).
2. Adapter `LLM_MODEL` au nom du modèle servi localement.
3. Si l'hôte refuse `response_format`, laisser `LLM_STRUCTURED_OUTPUT=false` : l'application
   bascule alors sur `json_object`. Si l'hôte renvoie un `400` mentionnant `response_format`
   malgré tout, le client rejoue automatiquement une fois sans ce paramètre.

Si un fournisseur expose un format de réponse différent, tout est isolé dans
`lib/llm/client.ts` : c'est le seul point à adapter. `lib/correction/` et `lib/schemas.ts`
sont indépendants du fournisseur.

## Structure

```
app/
  api/correct/route.ts   Route handler serveur : validation, orchestration, statuts HTTP
  page.tsx               Page serveur : lit la langue par défaut, la passe au client
components/              Interface client (React + Tailwind)
lib/
  env.ts                 Configuration validée (serveur uniquement)
  schemas.ts             Schémas zod et schéma JSON strict du modèle
  types.ts               Contrats partagés
  categories.ts          Catégories, sévérités et replis
  llm/                   Prompt, client OpenAI-compatible, timeout, repli json_object
  correction/            Alignement des extraits et reconstruction du texte corrigé
scripts/mock-llm.mjs     Faux serveur OpenAI-compatible pour les tests manuels
docs/spec-v1.md          Spécification v1
```

## Sécurité

- Clé d'API et URL du fournisseur n'existent que dans le code serveur ; rien n'est exposé au
  navigateur.
- Le texte utilisateur est traité comme une donnée non fiable : il est délimité par des
  marqueurs dédiés et le prompt système interdit d'exécuter les instructions qu'il contient.
- La sortie du modèle est validée par zod avant d'être utilisée, et rendue par React
  (échappement par défaut). Aucun `dangerouslySetInnerHTML` dans le dépôt.
- Les erreurs amont sont assainies avant retour au client : statut + 200 caractères maximum, clé
  d'API masquée.
- La journalisation ne contient que le modèle, la latence, les jetons et des longueurs. Le
  texte n'est journalisé que si `LOG_TEXT=true`.

## Licence

À définir.
