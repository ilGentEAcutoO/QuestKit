// Copies the source `theme.css` into `dist/styles.css` after tsdown finishes.
// We could chain this via a tsdown hook, but a tiny Node post-build script
// keeps the bundler config focused on JS and matches the convention used
// in lots of small TS libraries.
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });
copyFileSync("src/styles/theme.css", "dist/styles.css");
console.log("[copy-styles] dist/styles.css written");
