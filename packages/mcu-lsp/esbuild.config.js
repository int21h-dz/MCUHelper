const esbuild = require("esbuild");
const path = require("path");

esbuild
  .build({
    entryPoints: [path.join(__dirname, "src/server.ts")],
    bundle: true,
    platform: "node",
    target: "node18",
    outfile: path.join(__dirname, "dist/server.js"),
    external: ["vscode-languageserver", "vscode-languageserver-textdocument", "vscode-languageserver/node"],
    alias: {
      "@mcuhelper/mcu-schema": path.join(__dirname, "../mcu-schema/src/index.ts"),
      "@mcuhelper/mcu-language": path.join(__dirname, "../mcu-language/src/index.ts"),
      "@mcuhelper/mcu-geometry": path.join(__dirname, "../mcu-geometry/src/index.ts"),
    },
  })
  .then(() => console.log("mcu-lsp server bundled"))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
