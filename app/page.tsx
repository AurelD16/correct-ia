import { getDefaultLanguage, getMaxInputChars } from '@/lib/env';
import CorrectionApp from '@/components/CorrectionApp';

// La page est un composant serveur : elle lit la configuration et la transmet en
// props. Seules la langue et la limite de saisie sont exposées au client, ni l'une
// ni l'autre n'est un secret ; aucune variable d'environnement n'est préfixée par
// `NEXT_PUBLIC_`, donc rien de ce qui touche au LLM n'atteint le bundle navigateur.
//
// Rendue à la requête plutôt qu'à la compilation : la limite affichée suit l'env
// d'exécution, y compris quand il est injecté au démarrage du conteneur.
export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[110rem] flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          Correcteur de texte
        </h1>
        <p className="max-w-3xl text-sm text-slate-600">
          Collez un texte à gauche, obtenez à droite la version corrigée avec chaque
          erreur surlignée, et la liste des corrections proposées.
        </p>
      </header>
      <CorrectionApp
        defaultLanguage={getDefaultLanguage()}
        maxInputChars={getMaxInputChars()}
      />
    </main>
  );
}
