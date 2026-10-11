import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  // Headless Chromium for the HACCP Plan PDF: keep native packages out of the bundle.
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  // The Chromium binaries (brotli archives) are read from disk at runtime, so tracing misses them.
  outputFileTracingIncludes: {
    "/api/haccp-plan/pdf": ["./node_modules/@sparticuz/chromium/bin/**/*"],
  },
};

export default nextConfig;
