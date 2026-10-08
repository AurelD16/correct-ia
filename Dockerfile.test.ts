import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Le `Dockerfile` est une surface de confiance : ces assertions gardent ses
 * garanties de sécurité (exécution non-root, absence de secret) sans exécuter
 * Docker dans la suite. Les vérifications réelles (`docker inspect`, `id -u`,
 * healthcheck, smoke test) sont documentées dans le README.
 *
 * Les fichiers sont lus depuis la racine du dépôt : `import.meta.url` n'y est pas
 * exploitable, l'environnement de test étant `jsdom`.
 */

function read(file: string): string {
  return readFileSync(resolve(process.cwd(), file), 'utf8');
}


/** `Dockerfile` sans les lignes de commentaire, qui décrivent l'intention sans l'appliquer. */
function instructions(file: string): string {
  return read(file)
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
}

const dockerfile = instructions('Dockerfile');

/** Blocs `FROM … AS <nom>`, dans l'ordre du fichier. */
function stages(source: string): Map<string, string> {
  const blocks = new Map<string, string>();
  const headers = [...source.matchAll(/^FROM\s+\S+\s+AS\s+(\S+)/gim)];
  headers.forEach((header, index) => {
    const start = (header.index ?? 0) + header[0].length;
    const end = headers[index + 1]?.index ?? source.length;
    blocks.set(header[1]!.toLowerCase(), source.slice(start, end));
  });
  return blocks;
}

const runner = stages(dockerfile).get('runner');

describe('Dockerfile', () => {
  it('est multi-stage et déclare un stage runner', () => {
    expect(stages(dockerfile).size).toBeGreaterThanOrEqual(3);
    expect(runner).toBeDefined();
  });

  it('exécute le serveur final sous un utilisateur non-root', () => {
    const users = [...runner!.matchAll(/^USER\s+(\S+)/gim)].map((match) => match[1]!);

    expect(users).toHaveLength(1);
    expect(users[0]).toBe('node');
    expect(users[0]).not.toBe('root');
  });

  it('ne déclare aucun ARG ni ENV de secret', () => {
    // Un ARG de build ferait figer la clé dans l'historique des couches.
    expect(dockerfile).not.toMatch(/^\s*ARG\b/im);
    expect(dockerfile).not.toContain('LLM_API_KEY');
    expect(dockerfile).not.toMatch(/sk-[A-Za-z0-9]/);
  });

  it('ne copie aucun fichier .env dans l’image', () => {
    const copies = [...dockerfile.matchAll(/^COPY\s+(?!--from)(.*)$/gim)].map((match) => match[1]!);

    expect(copies.length).toBeGreaterThan(0);
    for (const sources of copies) {
      expect(sources).not.toMatch(/(^|\s)\.env(\s|$|\*)/);
    }
  });

  it('expose le port 3000 et lance le serveur autonome', () => {
    expect(runner).toMatch(/^EXPOSE\s+3000\s*$/im);
    expect(runner).toMatch(/^CMD\s+\["node",\s*"server\.js"\]\s*$/im);
    expect(runner).toContain('HOSTNAME=0.0.0.0');
  });

  it('déclare un HEALTHCHECK sans curl', () => {
    expect(runner).toMatch(/^HEALTHCHECK\b/im);
    // `node:22-slim` ne fournit ni curl ni wget.
    expect(runner).not.toMatch(/\b(curl|wget)\b/);
  });
});

describe('.dockerignore', () => {
  const ignored = instructions('.dockerignore');
  const rules = ignored
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  // Règle attendue pour les fichiers d'environnement : un double astérisque
  // (traverse les répertoires), puis le nom, puis un joker qui absorbe toute
  // convention — `.env`, `.env.local`, `.env.production`, `config/.env`…
  const BROAD_ENV_RULE = '**/.env*';

  // Toutes les règles visant un fichier d'environnement, quelle que soit leur
  // forme. Le « ! » d'une ré-inclusion compte comme séparateur : sinon
  // `!.env.example` passe sous le filtre et échappe à toute assertion.
  const envRules = rules.filter((rule) => /(^|[!/])\.env/.test(rule));

  it('écarte les dépendances, le build local et git', () => {
    expect(ignored).toMatch(/^node_modules\s*$/m);
    expect(ignored).toMatch(/^\.next\s*$/m);
    expect(ignored).toMatch(/^\.git\s*$/m);
  });

  it('conserve les tests, qui couvrent le typecheck du build', () => {
    expect(ignored).not.toMatch(/\.test\.tsx?/);
  });

  it('exclut tout fichier d’environnement par une règle large unique', () => {
    // Exiger l'ensemble exact, et non sa seule présence : une règle étroite
    // ajoutée en doublon donnerait une fausse assurance. C'est ce piège qui a
    // laissé passer un `.env.production` — absent de la liste `.env`,
    // `.env.local`, `.env.*.local` — jusqu'à l'image finale, via
    // `.next/standalone`.
    expect(envRules).toEqual([BROAD_ENV_RULE]);
  });

  it('ne réintroduit ni énumération de noms ni ré-inclusion', () => {
    // Sans joker final, une règle ne couvre qu'un nom et laisse passer la
    // convention suivante ; le préfixe « ! » réinclut explicitement.
    expect(envRules.filter((rule) => !rule.endsWith('*'))).toEqual([]);
    expect(envRules.filter((rule) => rule.startsWith('!'))).toEqual([]);
  });

  it('interdit toute ré-inclusion, quel que soit son motif', () => {
    // Volontairement brutal. Les assertions ci-dessus ne voient que les règles
    // dont le texte contient `.env` : une ré-inclusion générique passe dessous,
    // et le test restait vert pendant que la fuite revenait par la chaîne
    // habituelle — contexte du builder, puis `.next/standalone`, puis runner.
    // Aucune ré-inclusion n'a jamais été nécessaire ici, et « aucune exception »
    // se relit sans connaître la sémantique de `.dockerignore`, contrairement à
    // « aucune exception sauf celles qui nomment un `.env` ».
    expect(rules.filter((rule) => rule.startsWith('!'))).toEqual([]);
  });
});

describe('next.config.ts', () => {
  it('produit un serveur autonome pour le stage runner', () => {
    expect(read('next.config.ts')).toMatch(/output:\s*'standalone'/);
  });
});

describe('.github/workflows/docker-image.yml', () => {
  const workflow = read('.github/workflows/docker-image.yml');

  /** Entrées `tags:` du `metadata-action`, hors commentaires. */
  const tagRules = workflow
    .slice(workflow.indexOf('tags: |', workflow.indexOf('metadata-action')))
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('type='));

  it('se déclenche sur un tag git `v*`', () => {
    expect(workflow).toMatch(/^on:\s*$/m);
    expect(workflow).toMatch(/^\s{2}push:\s*$/m);
    expect(workflow).toMatch(/^\s{4}tags:\s*$/m);
    expect(workflow).toMatch(/^\s{6}- 'v\*'\s*$/m);

    // Un push de branche ne doit plus publier : `latest` appartient à une
    // version nommée, pas au dernier commit arrivé sur `main`.
    expect(workflow).not.toMatch(/^\s{4}branches:/m);
  });

  it('conditionne la publication aux contrôles de qualité', () => {
    expect(workflow).toMatch(/^\s{2}publish:\s*$/m);
    expect(workflow).toMatch(/^\s{4}needs:\s*quality\s*$/m);
  });

  it('publie exactement le tag de version et `latest`', () => {
    expect(tagRules).toContain('type=raw,value=${{ steps.release.outputs.version }}');
    expect(tagRules).toContain('type=raw,value=latest');
    expect(tagRules).toHaveLength(3); // + `type=sha`, traçabilité
  });

  it('lit la version dans le tag git, pas dans le workflow', () => {
    // La version est le tag : plus de constante à recopier dans ce fichier,
    // qui était une source de désynchronisation avec `package.json`.
    expect(workflow).not.toMatch(/IMAGE_VERSION_TAG/);
    expect(workflow).toContain('TAG_REF#refs/tags/');

    // `type=semver` refuserait `v1.01` : un zéro initial n'est pas du semver
    // valide. L'assertion porte sur les règles effectives, pas sur le fichier,
    // dont les commentaires mentionnent l'action écartée.
    expect(tagRules.join('\n')).not.toMatch(/type=semver/);
  });

  it('refuse une version qui ne ressemble pas à `vX.YY`', () => {
    expect(workflow).toMatch(/^\s*case "\$version" in$/m);
    expect(workflow).toMatch(/^\s*v\[0-9\]\*\.\[0-9\]\*\)/m);
    expect(workflow).toMatch(/^.*::error::/m);
  });

  it('écrit sur ghcr.io avec le seul `GITHUB_TOKEN`', () => {
    expect(workflow).toMatch(/images:\s*ghcr\.io\/\$\{\{ github\.repository \}\}/);
    expect(workflow).toMatch(/password:\s*\$\{\{ secrets\.GITHUB_TOKEN \}\}/);

    // `packages: write` doit rester dans le job qui publie, jamais au niveau du
    // workflow : le job `quality` n'a rien à écrire sur le registre.
    const workflowPermissions = workflow.match(/^permissions:\n(?: {2}\S+.*\n)+/m)?.[0] ?? '';

    expect(workflowPermissions).toContain('contents: read');
    expect(workflowPermissions).not.toContain('packages: write');
    expect(workflow.match(/^\s+packages:\s*write\s*$/gm)).toHaveLength(1);
    expect(workflow.indexOf('packages: write')).toBeGreaterThan(workflow.indexOf('publish:'));
  });
});
