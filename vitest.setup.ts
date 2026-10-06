import '@testing-library/jest-dom/vitest';
import { beforeEach, vi } from 'vitest';

// Les modules serveur journalisent (modèle, latence, jetons) : on coupe la sortie
// pour garder des rapports lisibles. `restoreMocks` réinitialise les spies entre
// chaque test, il faut donc les poser à chaque fois.
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
