/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The MCP server package ships TypeScript source directly, so let Next transpile it.
  transpilePackages: ["@0xauto/mcp-server"],
  webpack: (config) => {
    // The MCP server package uses NodeNext-style ".js" import specifiers that point
    // at ".ts" source files. Teach webpack to resolve those to the TypeScript sources.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
      ...(config.resolve.extensionAlias ?? {}),
    };
    return config;
  },
};

export default nextConfig;
