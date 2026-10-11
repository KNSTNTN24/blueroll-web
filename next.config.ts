import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  // Headless Chromium for the HACCP Plan PDF: keep native packages out of the bundle.
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
};

export default nextConfig;
