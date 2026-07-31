import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@hrms/ui'],
  output: 'standalone',
};

export default nextConfig;
