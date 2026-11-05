import { readFileSync, rmSync } from "node:fs";
import { resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";

const publicDir = resolve(".output/public");
const manifestPath = resolve(publicDir, ".vite/manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const roots = [
  "node_modules/@tanstack/react-start/dist/plugin/default-entry/client.tsx",
  "frontend/src/routes/home/route.tsx?tsr-split=component",
  "frontend/src/routes/home/index.tsx?tsr-split=component",
];
const deferredModules = [
  {
    route: roots[1],
    module: "frontend/src/components/app-shell/app-shell.tsx",
  },
  {
    route: roots[2],
    module: "frontend/src/components/app-shell/home-screen.tsx",
  },
];

for (const root of roots) {
  if (!manifest[root]) throw new Error(`Missing /home bundle entry: ${root}`);
}

for (const { route, module } of deferredModules) {
  if (!manifest[route].dynamicImports?.includes(module)) {
    throw new Error(`${module} must remain deferred from ${route}`);
  }
}

const visited = new Set();
function visit(key) {
  if (visited.has(key)) return;
  const entry = manifest[key];
  if (!entry) throw new Error(`Missing imported bundle entry: ${key}`);
  visited.add(key);
  for (const dependency of entry.imports ?? []) visit(dependency);
}
for (const root of roots) visit(root);

const jsFiles = new Set(
  [...visited].map((key) => manifest[key].file).filter((file) => file?.endsWith(".js")),
);
const gzipBytes = [...jsFiles].reduce((total, file) => {
  const assetPath = resolve(publicDir, file);
  if (!assetPath.startsWith(`${publicDir}${sep}`)) {
    throw new Error(`Bundle asset is outside the public directory: ${file}`);
  }
  return total + gzipSync(readFileSync(assetPath), { level: 9 }).byteLength;
}, 0);
const limitBytes = 250 * 1024;
const size = (gzipBytes / 1024).toFixed(2);
const limit = (limitBytes / 1024).toFixed(2);

rmSync(manifestPath);
rmSync(resolve(publicDir, ".vite"), { recursive: true, force: true });

console.log(
  `/home static JavaScript: ${size} KiB gzip (${jsFiles.size} files; limit ${limit} KiB)`,
);
if (gzipBytes > limitBytes) {
  throw new Error(`/home static JavaScript exceeds the ${limit} KiB gzip budget`);
}
