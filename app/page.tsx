import { getDefaultLanguage } from '@/lib/env';
import CorrectionApp from '@/components/CorrectionApp';
import { MAX_INPUT_CHARS_FALLBACK } from '@/components/textLimits';

// La page est un composant serveur : elle lit la configuration et la transmet en
// props. Aucune variable d'environnement n'NEXT_PUBLIC_ n'est utilisée, donc rien
// de ce qui touche au LLM n'atteint le bundle navigateur.
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
        maxInputChars={MAX_INPUT_CHARS_FALLBACK}
      />
    </main>
  );
}
