import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CorrectionApp from './CorrectionApp';
import type { CorrectionResult } from '@/lib/types';

const SOURCE = 'La reunion a lieu demain a 14 heur.';

const RESULT: CorrectionResult = {
  source: SOURCE,
  corrected: 'La réunion a lieu demain a 14 heures.',
  errors: [
    {
      id: 'e3-10',
      excerpt: 'reunion',
      replacement: 'réunion',
      explanation: "Il manque l'accent aigu.",
      category: 'orthographe',
      severity: 'erreur',
      start: 3,
      end: 10,
    },
    {
      id: 'e30-34',
      excerpt: 'heur',
      replacement: 'heures',
      explanation: 'Le pluriel est obligatoire.',
      category: 'orthographe',
      severity: 'erreur',
      start: 30,
      end: 34,
    },
  ],
  warnings: [],
  language: 'fr',
  model: 'test-model',
};

function mockOk(body: unknown = RESULT): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
  );
}

function mockError(status: number, error: string, message: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ error, message }), { status })),
  );
}

/** `getByRole` désambiguïse le textarea du <section> qui porte le même titre. */
function getTextarea(): HTMLTextAreaElement {
  return screen.getByRole('textbox', { name: 'Texte à corriger' }) as HTMLTextAreaElement;
}

async function renderAndSubmit(): Promise<void> {
  const user = userEvent.setup();
  render(<CorrectionApp defaultLanguage="fr" maxInputChars={8000} />);

  const textarea = getTextarea();
  await user.clear(textarea);
  await user.type(textarea, SOURCE);
  await user.click(screen.getByRole('button', { name: 'Corriger le texte' }));
  await waitFor(() => expect(screen.getByTestId('corrected-output')).toBeInTheDocument());
}

beforeEach(() => {
  mockOk();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CorrectionApp — rendu du résultat', () => {
  it('affiche un mark par erreur, avec explication en infobulle', async () => {
    await renderAndSubmit();

    const marks = document.querySelectorAll('mark');
    expect(marks).toHaveLength(2);
    expect(marks[0]?.textContent).toBe('réunion');
    expect(marks[1]?.textContent).toBe('heures');
    expect(marks[0]?.getAttribute('title')).toContain('Orthographe');
    expect(marks[0]?.getAttribute('aria-label')).toContain('Il manque');
  });

  it('affiche le texte corrigé identique à source + remplacements', async () => {
    await renderAndSubmit();

    const output = screen.getByTestId('corrected-output');
    expect(output.textContent).toBe(RESULT.corrected);
  });

  it('affiche extrait, remplacement, explication, catégorie et sévérité pour chaque erreur', async () => {
    await renderAndSubmit();

    const buttons = screen.getAllByRole('button', { pressed: false });
    const first = buttons[0] as HTMLElement;

    expect(first).toHaveTextContent('Orthographe');
    expect(first).toHaveTextContent('Erreur');
    expect(first).toHaveTextContent('reunion');
    expect(first).toHaveTextContent('réunion');
    expect(first).toHaveTextContent("Il manque l'accent aigu.");
  });

  it('affiche les warnings renvoyés par le serveur', async () => {
    mockOk({ ...RESULT, warnings: ['1 anomalie non localisée dans le texte source (ignorée).'] });
    await renderAndSubmit();

    const warnings = screen.getByRole('list', { name: 'Avertissements' });
    expect(within(warnings).getByText(/1 anomalie non localisée/)).toBeInTheDocument();
  });

  it('filtre la liste par catégorie', async () => {
    mockOk({
      ...RESULT,
      errors: [
        RESULT.errors[0]!,
        { ...RESULT.errors[1]!, category: 'ponctuation' as const, id: 'e30-34b' },
      ],
    });
    const user = userEvent.setup();
    render(<CorrectionApp defaultLanguage="fr" maxInputChars={8000} />);
    await user.click(screen.getByRole('button', { name: 'Corriger le texte' }));
    await waitFor(() => expect(screen.getByTestId('corrected-output')).toBeInTheDocument());

    expect(screen.getByText('Orthographe', { selector: '[data-testid="categorie"]' })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Filtrer par catégorie'), 'ponctuation');
    expect(screen.queryByText('Orthographe', { selector: '[data-testid="categorie"]' })).toBeNull();
    expect(screen.getByText('Ponctuation', { selector: '[data-testid="categorie"]' })).toBeInTheDocument();
  });
});

describe('CorrectionApp — sélection depuis la liste', () => {
  it('sélectionne et met en évidence le passage dans le textarea de gauche', async () => {
    await renderAndSubmit();

    const textarea = getTextarea() as HTMLTextAreaElement;
    const spy = vi.spyOn(textarea, 'setSelectionRange');
    const firstCard = screen.getAllByRole('button', { pressed: false })[0] as HTMLElement;

    await userEvent.setup().click(firstCard);

    expect(spy).toHaveBeenCalledWith(3, 10);
    expect(document.activeElement).toBe(textarea);
  });

  it('sélectionne aussi au clic sur un mark du texte corrigé', async () => {
    await renderAndSubmit();

    const textarea = getTextarea() as HTMLTextAreaElement;
    const spy = vi.spyOn(textarea, 'setSelectionRange');

    await userEvent.setup().click(document.querySelectorAll('mark')[1] as HTMLElement);

    expect(spy).toHaveBeenCalledWith(30, 34);
  });
});

describe('CorrectionApp — bandeau d’erreur', () => {
  it('affiche « service non configuré » avec un bouton Réessayer', async () => {
    mockError(503, 'not_configured', 'Service de correction non configuré.');
    const user = userEvent.setup();
    render(<CorrectionApp defaultLanguage="fr" maxInputChars={8000} />);
    await user.click(screen.getByRole('button', { name: 'Corriger le texte' }));

    const banner = await screen.findByTestId('status-banner');
    expect(within(banner).getByText('Service non configuré')).toBeInTheDocument();
    expect(within(banner).getByText('Service de correction non configuré.')).toBeInTheDocument();
    expect(within(banner).getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });

  it('distingue erreur amont et timeout', async () => {
    mockError(502, 'upstream', 'le service de correction a répondu statut 401');
    const user = userEvent.setup();
    render(<CorrectionApp defaultLanguage="fr" maxInputChars={8000} />);
    await user.click(screen.getByRole('button', { name: 'Corriger le texte' }));

    const banner = await screen.findByTestId('status-banner');
    expect(within(banner).getByText('Erreur du service de correction')).toBeInTheDocument();
    cleanup();

    mockError(504, 'timeout', "Le service de correction n'a pas répondu à temps (60000 ms).");
    render(<CorrectionApp defaultLanguage="fr" maxInputChars={8000} />);
    await user.click(screen.getByRole('button', { name: 'Corriger le texte' }));

    expect(await screen.findByText('Délai dépassé')).toBeInTheDocument();
  });

  it('rejoue la requête quand on clique sur Réessayer', async () => {
    const fetchSpy = vi.fn(
      async () => new Response(JSON.stringify({ error: 'timeout', message: 'trop lent' }), { status: 504 }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const user = userEvent.setup();
    render(<CorrectionApp defaultLanguage="fr" maxInputChars={8000} />);

    await user.click(screen.getByRole('button', { name: 'Corriger le texte' }));
    const banner = await screen.findByTestId('status-banner');
    await user.click(within(banner).getByRole('button', { name: 'Réessayer' }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
  });
});

describe('CorrectionApp — saisie', () => {
  it('déclenche la correction avec Ctrl+Entrée', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify(RESULT), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const user = userEvent.setup();
    render(<CorrectionApp defaultLanguage="fr" maxInputChars={8000} />);

    await user.click(getTextarea());
    await user.keyboard('{Control>}{Enter}{/Control}');

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
  });

  it('empêche une double soumission pendant le chargement', async () => {
    let resolveFetch: ((value: Response) => void) | undefined;
    const fetchSpy = vi.fn(
      () => new Promise<Response>((resolve) => (resolveFetch = resolve)),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const user = userEvent.setup();
    render(<CorrectionApp defaultLanguage="fr" maxInputChars={8000} />);

    const submit = screen.getByRole('button', { name: 'Corriger le texte' });
    await user.click(submit);

    const loading = await screen.findByRole('button', { name: 'Correction en cours…' });
    expect(loading).toBeDisabled();

    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    resolveFetch?.(new Response(JSON.stringify(RESULT), { status: 200 }));
    await waitFor(() => expect(screen.getByTestId('corrected-output')).toBeInTheDocument());
  });

  it('affiche un compteur et refuse une saisie trop longue', async () => {
    const user = userEvent.setup();
    render(<CorrectionApp defaultLanguage="fr" maxInputChars={20} />);

    const textarea = getTextarea() as HTMLTextAreaElement;
    await user.clear(textarea);
    await user.type(textarea, '1234567890123456789012345');

    expect(screen.getByText(/\/ 20 caractères/)).toBeInTheDocument();
    expect(textarea).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Corriger le texte' })).toBeDisabled();
  });

  it('applique la limite configurée, y compris supérieure au défaut', () => {
    const long = 'a '.repeat(4500); // 9000 caractères
    const { unmount } = render(<CorrectionApp defaultLanguage="fr" maxInputChars={20_000} />);

    fireEvent.change(getTextarea(), { target: { value: long } });

    expect(screen.getByText(/9000 \/ 20000 caractères/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Corriger le texte' })).toBeEnabled();
    unmount();

    // Même saisie, limite par défaut : refusée.
    render(<CorrectionApp defaultLanguage="fr" maxInputChars={8000} />);
    fireEvent.change(getTextarea(), { target: { value: long } });

    expect(screen.getByText(/9000 \/ 8000 caractères/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Corriger le texte' })).toBeDisabled();
  });

  it('déclenche une correction au-delà de 8000 caractères si la limite le permet', async () => {
    const long = 'a '.repeat(4500); // 9000 caractères
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify(RESULT), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    render(<CorrectionApp defaultLanguage="fr" maxInputChars={20_000} />);

    fireEvent.change(getTextarea(), { target: { value: long } });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Corriger le texte' }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const init = (fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((JSON.parse(init.body as string) as { text: string }).text).toHaveLength(9000);
  });

  it('n’expose pas le compteur de caractères comme région live', () => {
    render(<CorrectionApp defaultLanguage="fr" maxInputChars={8000} />);

    const counter = screen.getByText(/\/ 8000 caractères/);
    // Une région live réécrite à chaque frappe ferait annoncer le compteur en boucle.
    expect(counter.closest('[aria-live]')).toBeNull();
  });

  it('annonce le dépassement de limite dans une région dédiée, pas le compteur', () => {
    render(<CorrectionApp defaultLanguage="fr" maxInputChars={20} />);

    // Le texte d'exemple dépasse déjà la limite : le message doit donc être là d'emblée.
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Le texte dépasse 20 caractères');
    expect(status).toHaveTextContent("aucun texte n’est tronqué automatiquement");
    expect(screen.getByRole('button', { name: 'Corriger le texte' })).toBeDisabled();
  });

  it("n'envoie jamais la configuration du LLM dans la requête", async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify(RESULT), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const user = userEvent.setup();
    render(<CorrectionApp defaultLanguage="fr" maxInputChars={8000} />);
    await user.click(screen.getByRole('button', { name: 'Corriger le texte' }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const init = (fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1];
    const payload = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['language', 'text']);
  });
});

describe('CorrectionApp — accessibilité', () => {
  it('expose un état vide compréhensible avant toute correction', () => {
    render(<CorrectionApp defaultLanguage="fr" maxInputChars={8000} />);

    expect(screen.getByText(/Le texte corrigé apparaîtra ici/)).toBeInTheDocument();
    expect(screen.getByText('Aucune correction pour le moment.')).toBeInTheDocument();
    expect(getTextarea()).toBeInTheDocument();
  });
});
