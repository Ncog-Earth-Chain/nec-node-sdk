#!/usr/bin/env node
/*
 * Skip ledger. Reads the JSON report the Test step already wrote and fails if the set of tests that
 * did not actually run is anything other than the one block this repo has declared, or if any of the
 * assertions CI is supposed to be enforcing quietly stopped being enforced.
 *
 * WHY. `jest --ci` exits 0 on a skipped test, so "14 skipped" and "14 deleted" and "14 more added to
 * the skip list next month" are all the same green tick. This repo already relies on that number
 * being exactly what it says: 14 of its 159 tests are the `the Trimix IDE copy agrees with the SDK`
 * block, which reads a file out of a sibling checkout a single-repo runner does not have.
 *
 * BE HONEST ABOUT WHAT THIS DOES AND DOES NOT COVER. It does NOT check the Trimix IDE's copy of
 * deriveDbName -- nothing in this repository can, and as of 2026-09-06 nothing in the IDE repository
 * does either (see the note on the Test step in ci.yml, which was measured). What it does is stop the
 * skip set from drifting: the block must still be exactly 14 tests, no other test anywhere in the
 * suite may be skipped or todo, and the SDK-side half of that same parity -- the 13 live-schema
 * deriveDbName cases and the four assertions around them -- must be reported PASSED, by name.
 * Deleting them, renaming them, or marking them .skip turns this step red instead of green.
 *
 * Usage: node .github/scripts/skip-ledger-gate.cjs [path/to/jest-report.json]
 *   The Test step writes coverage/jest-report.json (coverage/ is already gitignored).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const reportPath = path.resolve(process.cwd(), process.argv[2] || 'coverage/jest-report.json');

// -------------------------------------------------------------------------------------------------
// THE LEDGER. Every test allowed not to run. Adding an entry here is a deliberate, reviewable act;
// adding a `.skip` in a test file without one turns this step red.
// -------------------------------------------------------------------------------------------------
const SKIP_LEDGER = [
  {
    file: 'ddb-schema-name.test.ts',
    block: 'the Trimix IDE copy agrees with the SDK',
    count: 14,
    why:
      'reads ../../ncog-trimix-ide/.../ddbSchemaName.ts, which actions/checkout does not give a ' +
      'single-repo runner. Passes in a monorepo checkout, pending on CI. NOT covered elsewhere yet.',
  },
  {
    file: 'key-registry.test.ts',
    block: 'LIVE deployed node accepts the SDK calldata (eth_call)',
    count: 9,
    why:
      'describe.skip unless NEC_LIVE_RPC is set (tests/key-registry.test.ts, `const liveDescribe = ' +
      'LIVE_RPC ? describe : describe.skip`). A runner has no deployed node to eth_call against, so ' +
      'this is deterministic rather than flaky. The Go-verifier parity it would prove is exactly what ' +
      'cannot be checked without a live chain -- keep it declared rather than deleted, so the day a ' +
      'live endpoint exists in CI these nine start running instead of staying invisible.',
  },
];

// -------------------------------------------------------------------------------------------------
// THE CENSUS. Tests that must be reported PASSED -- the SDK-side half of the schema-name parity that
// the CI header claims is enforced on every push.
// -------------------------------------------------------------------------------------------------
const LIVE_SCHEMA_BLOCK = 'deriveDbName against schemas a real node actually created';
const LIVE_CASE_RE = /^derives the live schema c_[0-9a-f]{40} from 0x[0-9a-f]{40}$/;
const LIVE_CASE_COUNT = 13;
const MUST_PASS_TITLES = [
  'the retired name_last6 scheme matches NONE of the live schemas',
  'two live contracts that SHARE a name still get distinct schemas',
  'normalizes the forms a caller actually types to the ONE live schema',
  'refuses an address that cannot name a schema instead of returning one',
];

let failures = 0;
function check(name, ok, detail) {
  if (!ok) failures++;
  console.log((ok ? '  ok  ' : '  FAIL') + ' ' + name + (detail ? '  [' + detail + ']' : ''));
}

// A failure list has to stay readable in a CI log; 13 full jest names on one line is not.
function summarize(items, max) {
  const n = max || 4;
  if (items.length === 0) return '';
  const head = items.slice(0, n).join(' ;; ');
  return items.length > n ? head + ' ;; (+' + (items.length - n) + ' more)' : head;
}

if (!fs.existsSync(reportPath)) {
  console.error(
    'skip-ledger gate: no jest report at ' + reportPath + '.\n' +
    'The Test step must run jest with `--json --outputFile=coverage/jest-report.json`. ' +
    'A missing report is a failure, not a skip -- otherwise this gate disappears the moment the ' +
    'Test step is edited.'
  );
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

const tests = [];
for (const suite of report.testResults || []) {
  const file = path.basename(suite.name || '');
  for (const a of suite.assertionResults || []) {
    tests.push({
      file,
      block: (a.ancestorTitles || [])[0] || '',
      title: a.title,
      status: a.status,
    });
  }
}

console.log('skip ledger -- report: ' + reportPath);
console.log(
  '  jest reported: ' + report.numTotalTests + ' total / ' + report.numPassedTests + ' passed / ' +
  report.numPendingTests + ' pending / ' + report.numTodoTests + ' todo / ' +
  report.numFailedTests + ' failed'
);

check('report parsed and non-empty', tests.length > 0, tests.length + ' assertions');
check('jest reported no failures', (report.numFailedTests || 0) === 0, String(report.numFailedTests));
check('no test.todo placeholders', (report.numTodoTests || 0) === 0, String(report.numTodoTests));

// 1. Nothing outside the ledger may be anything other than passed.
const inLedger = (t) => SKIP_LEDGER.some((e) => e.file === t.file && e.block === t.block);
const strays = tests.filter((t) => t.status !== 'passed' && !inLedger(t));
check(
  'every test that did not run is in the declared ledger',
  strays.length === 0,
  strays.length === 0
    ? 'no undeclared skips'
    : summarize(strays.map((t) => t.status + ' ' + t.block + ' > ' + t.title))
);

// 2. Each declared block must still be exactly the size it claims, and its tests must be either
//    passed (monorepo checkout) or pending (single-repo runner) -- never failed, never gone.
for (const e of SKIP_LEDGER) {
  const got = tests.filter((t) => t.file === e.file && t.block === e.block);
  check(
    'ledger block "' + e.block + '" is still ' + e.count + ' tests',
    got.length === e.count,
    got.length + ' found'
  );
  const bad = got.filter((t) => t.status !== 'passed' && t.status !== 'pending');
  check(
    'ledger block "' + e.block + '" is passed-or-pending only',
    bad.length === 0,
    bad.length === 0 ? [...new Set(got.map((t) => t.status))].join('+') : summarize(bad.map((t) => t.status + ' ' + t.title))
  );
}

// 3. The census: the SDK-side parity assertions must have PASSED, by name.
const liveBlock = tests.filter((t) => t.file === 'ddb-schema-name.test.ts' && t.block === LIVE_SCHEMA_BLOCK);
const liveCases = liveBlock.filter((t) => LIVE_CASE_RE.test(t.title));
check(
  'the ' + LIVE_CASE_COUNT + ' live-schema deriveDbName cases are present',
  liveCases.length === LIVE_CASE_COUNT,
  liveCases.length + ' found'
);
const liveNotPassed = liveCases.filter((t) => t.status !== 'passed');
check(
  'all live-schema deriveDbName cases PASSED (not skipped)',
  liveNotPassed.length === 0,
  summarize(liveNotPassed.map((t) => t.status + ' ' + t.title)) || 'all passed'
);
for (const title of MUST_PASS_TITLES) {
  const t = liveBlock.find((x) => x.title === title);
  check('"' + title + '" PASSED', !!t && t.status === 'passed', t ? t.status : 'MISSING');
}

if (failures > 0) {
  console.error('\nskip-ledger gate: ' + failures + ' FAILED check(s).');
  process.exit(1);
}
console.log('\nskip-ledger gate: the skip set is exactly what this repo declared.');
