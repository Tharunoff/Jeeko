const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Monorepo support: Metro needs to watch the workspace root (so it notices
// changes in @personalos/core, which lives outside this app's own folder)
// and needs to be able to resolve node_modules hoisted to the workspace root.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules")
];
// @personalos/core ships raw TypeScript (no build step) — resolve its
// package.json "main" (src/index.ts) directly rather than requiring a dist build.
config.resolver.disableHierarchicalLookup = false;

// expo-sqlite's web implementation loads a wa-sqlite .wasm file directly;
// Metro needs to treat .wasm as a binary asset (not try to parse/transform it as JS).
if (!config.resolver.assetExts.includes("wasm")) {
  config.resolver.assetExts.push("wasm");
}

module.exports = config;
