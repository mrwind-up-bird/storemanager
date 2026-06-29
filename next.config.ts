import type { NextConfig } from 'next';

const rootDomain = process.env.ROOT_DOMAIN ?? 'localhost';

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: __dirname,
  experimental: {
    // forbidden()/redirect() interrupts used by the session↔tenant 403 invariant (Task 10).
    authInterrupts: true,
    serverActions: {
      allowedOrigins: [rootDomain, `*.${rootDomain}`],
    },
  },
};

export default nextConfig;
