// scripts/convert-wasm-to-base64.js
const fs = require('fs');
const path = require('path');

const inputPath = process.argv[2];
const outputPath = process.argv[3] || 'wasm-base64.ts';

if (!inputPath) {
  console.error("Usage: node convert-wasm-to-base64.js <input.wasm> [output.ts]");
  process.exit(1);
}

if (!fs.existsSync(inputPath)) {
  console.error("Input file not found:", inputPath);
  process.exit(1);
}

const wasmBuffer = fs.readFileSync(inputPath);
const base64 = wasmBuffer.toString('base64');

const outputContent = `// Auto-generated from ${path.basename(inputPath)}
export const wasmBase64 = "${base64}";
`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, outputContent);
console.log(`✅ WASM converted to base64: ${outputPath}`);
