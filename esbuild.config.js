const esbuild = require("esbuild");
const path = require("path");
const fs = require("fs");

async function build() {
  console.log("Starting stateless bundle build...");

  // Ensure output directory exists
  const outDir = path.join(__dirname, "extension", "stateless", "dist");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // Copy WASM files from onnxruntime-web to extension/stateless/wasm/
  const wasmSourceDir = path.join(__dirname, "node_modules", "onnxruntime-web", "dist");
  const wasmDestDir = path.join(__dirname, "extension", "stateless", "wasm");
  if (!fs.existsSync(wasmDestDir)) {
    fs.mkdirSync(wasmDestDir, { recursive: true });
  }

  if (fs.existsSync(wasmSourceDir)) {
    const files = fs.readdirSync(wasmSourceDir);
    for (const file of files) {
      if (file.startsWith("ort-wasm") && (file.endsWith(".wasm") || file.endsWith(".mjs") || file.endsWith(".js"))) {
        fs.copyFileSync(path.join(wasmSourceDir, file), path.join(wasmDestDir, file));
        console.log(`Copied runtime binary/module: ${file}`);
      }
    }
  }

  // Bundle worker script
  await esbuild.build({
    entryPoints: [path.join(__dirname, "extension", "stateless", "runtime", "model-worker.js")],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["chrome115"],
    outfile: path.join(outDir, "model-worker.bundle.js"),
    define: {
      "process.env.NODE_ENV": '"production"',
      "import.meta.url": "self.location.href",
    },
    minify: false,
    sourcemap: false,
  });

  console.log("Model worker bundled successfully -> extension/stateless/dist/model-worker.bundle.js");
}

build().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
