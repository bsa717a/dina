import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: [
    "pdf-parse",
    "@prisma/client",
    "prisma",
    "@slack/socket-mode",
    "ws",
  ],
};

export default nextConfig;
