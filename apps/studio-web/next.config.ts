import type { NextConfig } from 'next';

const apiOrigin = process.env.GAMERHUB_API_URL ?? 'http://127.0.0.1:3001';

const nextConfig: NextConfig = {
  agentRules: false,
  allowedDevOrigins: ['127.0.0.1'],
  // Design replies may take up to 120 seconds. Keep the proxy open long enough
  // for the API to return its own structured timeout response.
  experimental: { proxyTimeout: 150_000 },
  async rewrites() {
    return [
      {
        source: '/api/gamerhub/health',
        destination: `${apiOrigin.replace(/\/$/, '')}/health`,
      },
      {
        source: '/v1/:path*',
        destination: `${apiOrigin.replace(/\/$/, '')}/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
