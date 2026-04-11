import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /** Enables `output: "standalone"` for smaller Docker images (`next build` produces `.next/standalone`). */
  output: "standalone",
};

export default nextConfig;
