// Packs the whole dashboard into one HTML file: script, styles and fonts all
// inline, nothing fetched at runtime. Double-click the result and it runs.
//
//   dist/SYNDICATE-OS.html           complete page, opens straight from disk
//   dist/syndicate-os.artifact.html  the same app without the <html>/<head>
//                                    wrapper, for hosts that supply their own
//   dist/syndicate-os.demo.html      as above, locked to the scripted demo: it
//                                    can never call Claude or store anything
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "dist");
const modules = path.join(root, "node_modules");

// --- script: the app and every library it uses, as one classic script -------
const bundle = await build({
  absWorkingDir: root,
  entryPoints: ["standalone/main.tsx"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "none",
  write: false,
  logLevel: "error",
});
// Inline script text must never contain a closing script tag or an HTML comment opener.
const script = bundle.outputFiles[0].text
  .replaceAll("</script", "<\\/script")
  .replaceAll("<!--", "<\\!--");

// --- styles: the same globals.css the Next.js app compiles -------------------
const cliPackage = JSON.parse(
  readFileSync(path.join(modules, "@tailwindcss/cli/package.json"), "utf8"),
);
const cliEntry = path.join(
  modules,
  "@tailwindcss/cli",
  typeof cliPackage.bin === "string" ? cliPackage.bin : cliPackage.bin.tailwindcss,
);
const css = execFileSync(process.execPath, [cliEntry, "-i", "src/app/globals.css", "--minify"], {
  cwd: root,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"],
});

// --- fonts: the Latin cuts of both faces, embedded ---------------------------
const fontData = (pkg, file) =>
  readFileSync(path.join(modules, pkg, "files", file)).toString("base64");
const inter = fontData("@fontsource-variable/inter", "inter-latin-wght-normal.woff2");
const mono = fontData(
  "@fontsource-variable/jetbrains-mono",
  "jetbrains-mono-latin-wght-normal.woff2",
);

// Unlayered on purpose: these must beat a host page's own body reset, which
// Tailwind's layered base styles cannot.
const shell = `
@font-face{font-family:"Inter Variable";font-style:normal;font-weight:100 900;font-display:swap;src:url(data:font/woff2;base64,${inter}) format("woff2")}
@font-face{font-family:"JetBrains Mono Variable";font-style:normal;font-weight:100 800;font-display:swap;src:url(data:font/woff2;base64,${mono}) format("woff2")}
:root{--font-inter:"Inter Variable";--font-jetbrains-mono:"JetBrains Mono Variable";color-scheme:dark}
html,body,#root{height:100%}
body{margin:0;background:#050505;color:#eaeaea;font-family:var(--font-inter),ui-sans-serif,system-ui,sans-serif;font-size:16px;line-height:1.5;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
`;

const styles = `<style>${css.replaceAll("</style", "<\\/style")}${shell}</style>\n`;
const head = `<title>SYNDICATE.OS</title>\n${styles}`;
const body = `<div id="root"></div>\n<script>${script}</script>\n`;
// The demo copy sets one flag before the app starts. With it the dashboard
// never looks for Claude or for storage, so it stays scripted wherever it is opened.
const demo = `<title>SYNDICATE.OS Demo</title>\n${styles}<script>window.__SYNDICATE_DEMO__=true</script>\n${body}`;

const icon = encodeURIComponent(readFileSync(path.join(root, "src/app/icon.svg"), "utf8"));
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#050505">
<link rel="icon" href="data:image/svg+xml,${icon}">
${head}</head>
<body>
${body}</body>
</html>
`;

mkdirSync(outDir, { recursive: true });
const outputs = [
  ["SYNDICATE-OS.html", page],
  ["syndicate-os.artifact.html", head + body],
  ["syndicate-os.demo.html", demo],
];
for (const [name, content] of outputs) {
  writeFileSync(path.join(outDir, name), content);
  console.log(`dist/${name}  ${(Buffer.byteLength(content) / 1024).toFixed(0)} KB`);
}
