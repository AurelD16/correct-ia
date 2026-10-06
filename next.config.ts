import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // `standalone` produit un serveur autonome dans `.next/standalone`, avec ses
  // propres `node_modules` réduites au strict nécessaire : c'est ce que copie le
  // stage `runner` du Dockerfile. `next build` et `next start` continuent de
  // fonctionner en local sans changement.
  output: 'standalone',
};

export default nextConfig;
