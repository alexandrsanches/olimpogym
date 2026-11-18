import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  experimental: {
    serverActions: {
      // comprovantes (PDF/foto) de até ~10 MB
      bodySizeLimit: "11mb",
    },
  },
};

export default nextConfig;
