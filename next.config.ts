import type { NextConfig } from 'next';

const rootDomain = process.env.ROOT_DOMAIN ?? 'localhost';

const nextConfig: NextConfig = {
  output: 'standalone',
  serverActions: {
    allowedOrigins: [rootDomain, `*.${rootDomain}`],
  },
};

export default nextConfig;
