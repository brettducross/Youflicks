import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "@prisma/adapter-pg", "@prisma/client"],
  // Dev is bound to 0.0.0.0 so Cloud Agent preview (and browsers) can
  // reach it as 127.0.0.1. Next.js otherwise treats that as a foreign
  // origin and blocks /_next/static, which prevents auth forms from hydrating.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
