import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* instrumentation.ts boots the chess mini-service in dev — see README */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
