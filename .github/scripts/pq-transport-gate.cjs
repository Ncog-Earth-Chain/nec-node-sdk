'use strict';

// A green Jest exit with skipped hybrid assertions is not transport qualification.
// Keep this gate in test:pq itself so local publication and CI enforce the same rule.
const fs = require('fs');
const path = require('path');
const reportPath = path.resolve(process.cwd(), process.argv[2] || 'coverage/pq-jest-report.json');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const suites = report.testResults || [];
const tests = suites.flatMap(suite => suite.assertionResults || []);
const required = [
  'real hybrid connection authenticates before sending and uses one socket',
  'actual Ddb private-read callback uses connector and refuses downgrade: X25519MLKEM768',
  'actual Ddb private-read callback uses connector and refuses downgrade: X25519',
  'classical negotiated group refuses before request bytes',
  'wrong trusted pin refuses before request bytes',
  'private transaction outcome uses the exact authenticated hybrid socket without widening mutation access',
  'private transaction mutation uses its authenticated one-use hybrid socket: ddb_previewPrivateBatch',
  'private transaction mutation uses its authenticated one-use hybrid socket: ddb_putPayloadBatch',
  'private transaction mutation uses its authenticated one-use hybrid socket: ddb_submitSignedTransaction',
  'private evidence uses its authenticated one-use hybrid socket: ddb_getPrivateAssignmentEvidence',
  'private evidence uses its authenticated one-use hybrid socket: ddb_getPrivateTransactionSnapshotEvidence',
  'private evidence uses its authenticated one-use hybrid socket: ddb_getPrivateTransactionFinalityEvidence',
  'trusted validating-node factory authenticates bootstrap before signing evidence',
  'trusted source bootstrap refuses before signing or private bytes: pin',
  'trusted source bootstrap refuses before signing or private bytes: downgrade',
];
if (report.success !== true || tests.length === 0 || report.numFailedTests !== 0 ||
    report.numPendingTests !== 0 || report.numTodoTests !== 0 ||
    suites.some(suite => suite.status !== 'passed' || !/\.pq\.test\.ts$/.test(suite.name)) ||
    tests.some(test => test.status !== 'passed') ||
    required.some(title => !tests.some(test => test.title === title && test.status === 'passed'))) {
  console.error('PQ transport gate: every collected assertion and required real-TLS witness must pass; skips are refused');
  process.exit(1);
}
console.log(`PQ transport gate: ${tests.length} assertions passed; no skipped/todo/failed cases`);
