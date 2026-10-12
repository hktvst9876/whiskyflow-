import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WebAssembly + data files that must be loaded with Node's own resolver.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
