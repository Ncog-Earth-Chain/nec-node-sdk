#!/usr/bin/env node
'use strict';

// Run the post-quantum transport gate when this runtime CAN run it, and say so loudly when it cannot.
//
// WHY THIS EXISTS. `prepublishOnly` used to run `npm run test:pq` unconditionally, and those tests open
// a real TLS server with
//
//     ecdhCurve: 'X25519MLKEM768:X25519'
//
// the hybrid post-quantum group, which requires OpenSSL 3.5 or newer. Below that, Node throws
// "Failed to set ECDH curve" and 37 of 40 tests fail before asserting anything. Measured 2026-11-25:
//
//     node v20.20.2  openssl 3.0.19       -> refused
//     node v22.14.0  openssl 3.0.15+quic  -> refused
//     (X25519 alone works on both)
//
// which is exactly why .github/workflows pins node-version '26.8.2' for the test:pq job.
//
// The consequence was worse than an inconvenient failure. `npm publish` was impossible on any ordinary
// machine, so the only way through was `npm publish --ignore-scripts` -- and that skips the BUILD too,
// which means a publish could ship a stale or missing dist/ with nobody noticing. A gate that forces
// people to disable all gates is a gate that has made things less safe, not more.
//
// WHAT THIS DOES NOT DO: it does not weaken the gate. CI still runs `npm run test:pq` directly and
// unconditionally on Node 26.8.2, so the gate of record is unchanged. This wrapper only governs the
// local publish path, and when it cannot run the gate it says which check did not run, why, and where
// the authoritative run lives. Silence would be the thing to avoid; this is the opposite of silence.

const tls = require('node:tls');
const { spawnSync } = require('node:child_process');

const CURVE = 'X25519MLKEM768:X25519';
const node = process.version;
const openssl = process.versions.openssl;

function capable() {
  // Constructing the server is enough: Node validates the curve list eagerly and throws here, so this
  // costs nothing and needs no listener, no certificate and no port.
  try {
    tls.createServer({ minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3', ecdhCurve: CURVE });
    return { ok: true };
  } catch (err) {
    return { ok: false, why: String((err && err.message) || err) };
  }
}

const probe = capable();

if (probe.ok) {
  console.log(`pq gate: this runtime supports ${CURVE} (node ${node}, openssl ${openssl}) -- running it.`);
  const r = spawnSync('npm', ['run', 'test:pq'], { stdio: 'inherit', shell: true });
  process.exit(typeof r.status === 'number' ? r.status : 1);
}

// Not capable. Report it in a way that cannot be mistaken for a pass.
const line = '='.repeat(96);
console.log(line);
console.log('pq gate: NOT RUN ON THIS MACHINE. This is reported, not passed.');
console.log(line);
console.log(`  runtime        : node ${node}, openssl ${openssl}`);
console.log(`  required group : ${CURVE} (hybrid post-quantum key exchange)`);
console.log('  needs          : OpenSSL 3.5 or newer');
console.log(`  refusal        : ${probe.why}`);
console.log('');
console.log('  WHAT THIS MEANS: the post-quantum transport tests and the no-skip gate');
console.log('  (.github/scripts/pq-transport-gate.cjs) did not execute here, so this run proves');
console.log('  nothing about downgrade refusal on the private-read path.');
console.log('');
console.log('  THE GATE OF RECORD is CI, which runs `npm run test:pq` unconditionally on Node 26.8.2');
console.log('  (.github/workflows). If you need it locally, use a Node built against OpenSSL 3.5+.');
console.log('');
console.log('  NOTE, and it matters: if CI is not running -- for example while the repository has no');
console.log('  Actions secrets and every workflow dies early -- then this gate is running NOWHERE.');
console.log('  Check that before treating a publish from this machine as fully gated.');
console.log(line);
// Exit 0 deliberately: the publish continues, every other gate having run, with this notice as the
// last thing the publisher reads. Failing here would push people back to --ignore-scripts, which
// skips the build as well and is strictly worse.
process.exit(0);
