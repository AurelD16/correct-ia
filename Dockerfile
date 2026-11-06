# syntax=docker/dockerfile:1
#
# Image de production de correct-ia — serveur Next.js autonome (`output:
# 'standalone'`), exécuté par l'utilisateur `node` (uid 1000), sans secret.
#
# La configuration LLM est lue au démarrage de chaque requête, côté serveur
# (`lib/env.ts`) : aucun `ARG` de build, aucun `ENV` de clé, aucun `COPY .env*`.
# Les variables `LLM_*` sont fournies à l'exécution (`docker run -e …`).

# --- deps : dépendances de production, calculées une seule fois --------------
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- builder : build Next.js, avec les dépendances complètes -----------------
FROM node:22-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- runner : image finale, non-root, minimale --------------------------------
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

# Le serveur autonome embarque son propre `node_modules` réduit et son
# `server.js` à la racine. `public/` n'existe pas dans ce dépôt : rien à copier,
# et un `COPY` d'une source absente casserait le build.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

# Le cache Next doit être inscriptible par l'utilisateur non-root ; `/app` et
# les fichiers copiés lui appartiennent déjà.
RUN mkdir -p .next/cache && chown -R node:node .next

# L'utilisateur `node` (uid 1000) existe dans l'image officielle. Aucun `root`
# dans ce stage.
USER node

EXPOSE 3000

# Healthcheck sans curl : l'image n'en fournit pas, `fetch` est natif sur Node 22.
# `/` est servi même sans configuration LLM (l'API répond alors 503), donc l'état
# de santé ne dépend pas d'un fournisseur.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
