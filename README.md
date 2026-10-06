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

## Conteneurisation

### Construire et lancer

```bash
docker build -t correct-ia:local .        # ou : npm run docker:build
docker run --rm -p 3000:3000 \
  --add-host=host.docker.internal:host-gateway \
  -e LLM_BASE_URL=https://api.openai.com/v1 \
  -e LLM_API_KEY=sk-... \
  -e LLM_MODEL=gpt-4o-mini \
  correct-ia:local
```

Ou, contre le faux serveur local — **qui doit tourner sur l'hôte au préalable** :

```bash
npm run mock:llm      # dans un terminal, sans quoi l'API renvoie 502
npm run docker:run    # containerisé, variables déjà préremplies pour le mock
```

Le serveur écoute sur `0.0.0.0:3000` et sert `/` sans configuration : l'interface
s'affiche, seule l'API renvoie `503`. Le `HEALTHCHECK` teste `/`, donc l'état de santé
ne dépend pas d'un fournisseur.

### Garantie non-root

Le stage final déclare `USER node` — l'utilisateur `node` (uid 1000) de l'image
officielle — et ne contient **aucune** instruction en `root`. Vérifications :

```bash
docker inspect --format '{{.Config.User}}' correct-ia:local   # node
docker run --rm --entrypoint id correct-ia:local -u           # 1000
docker run --rm --entrypoint id correct-ia:local               # uid=1000(node) gid=1000(node)
```

Le cache `.next/cache` est créé et attribué à `node` avant le changement d'utilisateur,
sinon le serveur autonome ne pourrait pas écrire dedans.

### Aucun secret dans l'image

La configuration est lue **au moment de la requête**, côté serveur (`lib/env.ts`). Elle
n'est donc jamais figée au build :

- aucun `ARG` de build, aucun `ENV` de clé dans le `Dockerfile` ;
- aucun `COPY .env*` ;
- une règle unique et large, `**/.env*`, écarte **tout** fichier d'environnement du
  contexte de build, à la racine comme en profondeur.

Le troisième point est le plus important, et la façon dont il est écrit compte autant que
ce qu'il dit. Une énumération — `.env`, `.env.local`, `.env.*.local` —
ne protège que les conventions écrites : `.env.production` passait, `COPY . .` le
copiait dans le stage `builder`, **`next build` le recopie dans `.next/standalone/`**,
et le stage `runner` déposait le tout dans l'image finale. Pire qu'une clé écrite
dans le dépôt : `NODE_ENV=production` la rechargeait au démarrage, si bien que le
conteneur s'authentiflait auprès du fournisseur avec une clé qu'on ne lui avait pas
donnée. Ne décomposez pas cette règle en une liste : `Dockerfile.test.ts` exige
l'ensemble exact des règles d'environnement, ce qui fait échouer le test dès qu'une
forme étroite est réintroduite.


`Dockerfile.test.ts` garde ces trois règles par assertion. Les variables `LLM_*` se
passent à l'exécution (`-e …`, `--env-file …`, ou secrets du Deployment) : un `docker
history` ne peut pas les révéler.

### Structure de l'image

Multi-stage sur `node:22-slim` (Node 22 est la version testée par le workflow ; `slim`
plutôt qu'`alpine` pour éviter les divergences musl et les binaires natifs) :

| Stage | Rôle |
|---|---|
| `deps` | `npm ci` sur `package.json` + `package-lock.json`, calculé une seule fois |
| `builder` | build Next.js (`output: 'standalone'`), dépendances complètes |
| `runner` | `.next/standalone` + `.next/static`, utilisateur `node`, sans `.git` ni sources |

L'image pèse **410 Mo** sur disque, dont ~92 Mo transférés une fois compressés
(`docker save | gzip -9`) : l'essentiel est la base `node:22-slim` et les `node_modules`
réduites par le serveur autonome, pas l'application (97 Ko de First Load JS).

`public/` n'existe pas dans ce dépôt : rien n'est copié pour lui. Ajouter un dossier
`public/` imposera d'ajouter le `COPY` correspondant au stage `runner` — un `COPY` d'une
source absente fait échouer le build.

### Smoke test de bout en bout

`scripts/mock-llm.mjs` n'est pas embarqué dans l'image (le serveur autonome ne
l'embarque pas) : il se lance **sur l'hôte**.

```bash
# terminal 1
npm run mock:llm

# terminal 2 — construit et lancé avec la configuration du mock
docker build -t correct-ia:local .
docker run --rm -p 3000:3000 \
  --add-host=host.docker.internal:host-gateway \
  -e LLM_BASE_URL=http://host.docker.internal:8787/v1 \
  -e LLM_API_KEY=mock \
  -e LLM_MODEL=mock-1 \
  correct-ia:local

# terminal 3
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/          # 200
curl -s -X POST http://127.0.0.1:3000/api/correct \
  -H 'content-type: application/json' \
  --data-binary @- <<'JSON'
{"text":"La réunion de projet aura lieu demain a 14 heur.\nJ'ai beaucoup de travail a faire, mais le rapport doit etre fini.\nMalgrés le retard, nous avons quand meme reussi à advanced le calendrier."}
JSON
```

Le JSON tient sur **une seule ligne**, les sauts de ligne du texte étant écrits `\n` : une
chaîne JSON ne peut pas contenir de saut de ligne brut, et l'API répond alors `400`
« Corps de requête invalide ». Le `<<'JSON'` (délimiteur entre apostrophes) laisse `\n`
et l'apostrophe de `J'ai` tels quels, sans échappement shell. Reformater ce JSON sur
plusieurs lignes le rendrait invalide.

`GET /` répond `200`, `POST /api/correct` répond `200` avec les **quatre** erreurs que le
faux serveur sait détecter (`demain a 14 heur`, `a faire`, `doit etre fini`,
`Malgrés le retard`). C'est le texte d'exemple de l'application : sur une phrase plus
courte, le faux serveur n'en trouve qu'une partie — c'est normal, il ne renvoie que les
groupes réellement présents dans le texte soumis.

Si le port 3000 de l'hôte est déjà pris, changer le port hôte (`-p 3100:3000`) et les
URL de `curl` : le port interne reste 3000.

### Publication automatique

`.github/workflows/docker-image.yml` construit et publie l'image sur **GitHub Container
Registry** (`ghcr.io/aureld16/correct-ia`) à chaque push sur `main`, et sur
déclenchement manuel (`workflow_dispatch`). Aucun secret à configurer : `GITHUB_TOKEN` suffit.

Le job `quality` (lint, typecheck, tests, build) **conditionne** la publication : une
régression sur `main` n'aboutit pas à une image publiée.

Tags produits sur un push sur `main` : `latest`, `v1.0`, `main`, `sha-<court>`.

**Visibilité du package.** Un premier `docker push` crée le package en `private` : les
images ne sont alors joignables qu'authentifié. Pour le rendre public :
<https://github.com/users/aurelien.djian/packages/container/correct-ia/settings> →
*Change visibility* → *Public*.

**⚠️ L'API n'est ni authentifiée ni limitée en débit.** `POST /api/correct` est
préexistant tel quel, mais cette PR rend l'image déployable : un déploiement public
expose une application qui consomme une `LLM_API_KEY` à ses frais, à quiconque peut
l'appeler. Ne publiez pas le port 3000 directement sur Internet — placez un reverse
proxy qui assure authentification et limitation de débit devant le conteneur. Le
healthcheck est de toute façon interne au conteneur (`127.0.0.1`) et n'a rien à voir
avec cette exposition.

**Le tag `v1.0` est mutable.** Il est réécrit à chaque push sur `main`, par construction
(`type=raw,value=v1.0,enable={{is_default_branch}}`). C'est la lecture littérale de la
demande ; le tag n'identifie donc pas un build immuable. Le jour où le dépôt versionne
par tags git, remplacer dans `metadata-action` la ligne du tag de version par
`type=semver,pattern=v{{version}}`, ajouter `tags: ['v*']` au déclencheur et supprimer
`IMAGE_VERSION_TAG` du bloc `env`. Les tags `sha-<court>` restent, eux, immuables.

### Bump de version

La version suit le tag git. Le `package.json` porte la même valeur que le tag.

1. Mettre à jour `"version"` dans `package.json`, ouvrir une PR.
2. Après merge, sur `main` :

   ```bash
   git tag -a v1.1 -m "correct-ia v1.1"     # tag annoté, sur le commit de main mergé
   git push origin v1.1
   ```

3. Reporter le nouveau tag dans le workflow : `IMAGE_VERSION_TAG: v1.1` (une ligne).

Le `git tag` se pose **après** le merge : sur une branche, il désignerait un commit qui
n'est pas sur `main`.

### En local, hors conteneur

`output: 'standalone'` n'a rien changé au développement : `npm run dev`, `npm run build`
et `npm start` fonctionnent comme avant. `next start` émet un avertissement
*« does not work with "output: standalone" »* et sert malgré tout l'application sur
`.next/` ; pour un démarrage **identique à celui de l'image**, il faut recopier les
assets statiques, que le serveur autonome n'embarque pas :

```bash
npm run build
cp -r .next/static .next/standalone/.next/static
node .next/standalone/server.js
```

Sans cette copie, la page répond `200` mais tous les assets `/_next/static/*` répondent
`404` : l'application s'affiche sans style ni JavaScript. Le `COPY` correspondant existe
dans le `Dockerfile` (stage `runner`), d'où la différence.

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

`Dockerfile.test.ts` (racine) couvre le `Dockerfile`, le `.dockerignore` et
`next.config.ts` par assertions sur leur texte — sans exécuter Docker. Les garanties
qu'il vérifie sont aussi vérifiables à la main, procédure au § *Conteneurisation* :
`USER` non-root, absence d'`ARG`/`ENV` de secret et de `COPY .env*`, `EXPOSE 3000`,
`CMD ["node", "server.js"]`, présence du `HEALTHCHECK`.

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
