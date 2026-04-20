import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  allowedDevOrigins: [
    "preview-chat-bb94adf5-decf-4a23-8019-5bf4d60c7b51.space.z.ai",
  ],
};

export default nextConfig;
