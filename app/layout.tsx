import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'correct-ia — Correction de texte',
  description:
    "Correction d'orthographe, de grammaire et de syntaxe par un LLM compatible OpenAI, avec surlignage des erreurs façon LanguageTool.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
