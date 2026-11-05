import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* Autorise le domaine de prévisualisation à charger les chunks dev /_next/* */
  allowedDevOrigins: ["*.space-z.ai"],
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
