import type { NextConfig } from 'next';

const rootDomain = process.env.ROOT_DOMAIN ?? 'localhost';

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: __dirname,
  experimental: {
    serverActions: {
      allowedOrigins: [rootDomain, `*.${rootDomain}`],
    },
  },
};

export default nextConfig;
