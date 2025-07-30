// scripts/convert-wasm-to-base64.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const inputPath = process.argv[2];
const outputPath = process.argv[3] || 'wasm-base64.ts';
const exportName = process.argv[4] || 'wasmBase64';

if (!inputPath) {
  console.error("Usage: node convert-wasm-to-base64.js <input.wasm> [output.ts] [exportName]");
  process.exit(1);
}

if (!fs.existsSync(inputPath)) {
  console.error("Input file not found:", inputPath);
  process.exit(1);
}

// 1. Read the original wasm file as buffer
const wasmBuffer = fs.readFileSync(inputPath);

// 2. Gzip compress the buffer
const gzipped = zlib.gzipSync(wasmBuffer);

// 3. Encode compressed buffer to base64
const base64 = gzipped.toString('base64');

// 4. Generate TypeScript output
const outputContent = `// Auto-generated from ${path.basename(inputPath)} (gzip compressed)
export const ${exportName} = "${base64}";
`;

// 5. Write to output file
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, outputContent);

console.log(`✅ WASM compressed and converted to base64: ${outputPath}`);
console.log(`Exported variable name: ${exportName}`);
console.log(`Original size: ${wasmBuffer.length} bytes`);
console.log(`Compressed size: ${gzipped.length} bytes`);
