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

  it('écarte les dépendances, le build local, git et les fichiers d’environnement', () => {
    expect(ignored).toMatch(/^node_modules\s*$/m);
    expect(ignored).toMatch(/^\.next\s*$/m);
    expect(ignored).toMatch(/^\.git\s*$/m);
    expect(ignored).toMatch(/^\.env\s*$/m);
    expect(ignored).toMatch(/^\.env\.local\s*$/m);
    expect(ignored).toMatch(/^\.env\.\*\.local\s*$/m);
  });

  it('conserve les tests, qui couvrent le typecheck du build', () => {
    expect(ignored).not.toMatch(/\.test\.tsx?/);
  });
});

describe('next.config.ts', () => {
  it('produit un serveur autonome pour le stage runner', () => {
    expect(read('next.config.ts')).toMatch(/output:\s*'standalone'/);
  });
});
