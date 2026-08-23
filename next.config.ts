import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin the workspace root: the parent directory isn't a git repo, which
  // otherwise makes Next.js guess the wrong root for package-lock.json.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
