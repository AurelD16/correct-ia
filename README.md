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
| `LLM_TIMEOUT_MS` | `60000` | Délai maximal de l'appel au fournisseur. Borne l'appel **entier** : envoi, réception des en-têtes et lecture du corps de la réponse. Dépassement → `504`. |
| `LLM_MAX_INPUT_CHARS` | `8000` | Longueur maximale acceptée. Au-delà : refus `400`, jamais de troncature. La valeur est lue côté serveur et transmise à l'interface, qui compte les caractères, alerte à 80 % et bloque la soumission au-dessus de cette limite. |
| `LLM_STRUCTURED_OUTPUT` | `true` | `true` → `response_format: json_schema` strict ; `false` → `json_object`. |
| `LOG_TEXT` | `false` | Journalise le texte utilisateur. À laisser à `false` hors développement. |

La configuration est validée à chaque appel de l'API (zod). Une configuration incomplète
n'arrête pas le serveur : l'interface s'affiche, et l'API répond `503` « service non configuré ».
En développement, les champs manquants sont nommés dans le log serveur (`[correct] configuration
LLM invalide : …`) ; ils ne le sont jamais dans la réponse HTTP.

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
`8787`. Il repère quatre **groupes de mots** fautifs — `demain a 14 heur` →
`demain à 14 heures`, `a faire` → `à faire`, `doit etre fini` → `doit être fini`,
`malgres le retard` → `Malgré le retard` — par une recherche insensible aux accents et
strictement à la frontière d'un mot, et ne renvoie que ceux qu'il trouve réellement dans
le texte soumis. **Sur le texte d'exemple de l'application, il en trouve les quatre.**

Les extraits sont volontairement des groupes de mots et non des mots isolés : un extrait
mono-caractère comme `a` est ambigu — il correspond au `a` de `demain a` comme à celui de
`aura` — et l'alignement, qui retient la première occurrence à frontière de mot, le
placerait à tort. Un groupe de mots rend la position non ambiguë.

C'est un harnais de test, pas un correcteur : sur un texte courant il produit un nombre
variable d'erreurs. Il permet de valider l'interface de bout en bout sans fournisseur.

Deux modes exercent la chaîne de repli du client :

```bash
# l'hôte refuse le mode structuré mais accepte le paramètre -> json_object, 2 requêtes
MOCK_LLM_MODE=reject-json-schema npm run mock:llm

# l'hôte refuse le paramètre lui-même (llama.cpp, certaines versions d'Ollama)
# -> 3e tentative sans response_format, et JSON renvoyé entouré de texte
MOCK_LLM_MODE=reject-response-format npm run mock:llm
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
npm test        # suite complète, aucune clé d'API requise
npm run lint
npm run typecheck
npm run build
```

Les tests sont colocalisés (`*.test.ts` / `*.test.tsx`) à côté du code qu'ils couvrent.
Aucun test ne contacte un fournisseur réel : `fetch` est simulé, l'API est testée en
injectant l'environnement.

## Limites connues

- Sans configuration, la réponse est `503` même si le texte est aussi trop long : la
  configuration est vérifiée avant la longueur. La requête serait de toute façon
  refusable sans regarder la configuration ; l'ordre reste un choix, pas une nécessité.
- `max_tokens` est figé à `4096` dans le client ; il n'est pas exposé dans `.env`.
- Le délai de `LLM_TIMEOUT_MS` est appliqué **par requête** : une correction qui épuiserait
  les trois requêtes de la chaîne de repli peut prendre jusqu'à `3 × LLM_TIMEOUT_MS`.

## Adapter à un autre fournisseur OpenAI-compatible

vLLM, Ollama, llama.cpp, LiteLLM, OpenRouter… tant que l'endpoint
`POST {LLM_BASE_URL}/chat/completions` accepte un `Authorization: Bearer` :

1. Adapter `LLM_BASE_URL` (par exemple `http://localhost:11434/v1` pour Ollama).
2. Adapter `LLM_MODEL` au nom du modèle servi localement.
3. Si l'hôte refuse le mode structuré, laisser `LLM_STRUCTURED_OUTPUT=false` : la chaîne
   de repli de l'application est déjà automatique et progressive, sans configuration —
   `json_schema` → `json_object` → **aucun** `response_format`, au plus 3 requêtes par
   correction. Si l'hôte renvoie `400` mentionnant `response_format` ou `json_schema`,
   l'étape suivante est tentée ; tout autre statut non 2xx est un `502` en une requête.

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
