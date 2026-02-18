/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Skip ESLint during build — ESLint 9 flat config is incompatible with Next.js 14's built-in runner
  eslint: {
    ignoreDuringBuilds: true,
  },

  // Tree-shake ethers.js — only bundle the submodules actually imported
  experimental: {
    optimizePackageImports: ["ethers"],
  },

  webpack: (config) => {
    config.resolve.fallback = { fs: false, net: false, tls: false };
    return config;
  },
};

export default nextConfig;
