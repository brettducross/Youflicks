import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "pg",
    "@prisma/adapter-pg",
    "@prisma/client",
    "sharp",
    "file-type",
    "@aws-sdk/client-s3",
  ],
  experimental: {
    proxyClientMaxBodySize: "512mb",
  },
  // Dev is bound to 0.0.0.0 so Cloud Agent preview (and browsers) can
  // reach it as 127.0.0.1. Next.js otherwise treats that as a foreign
  // origin and blocks /_next/static, which prevents auth forms from hydrating.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
        ],
      },
    ];
  },
};

export default nextConfig;
