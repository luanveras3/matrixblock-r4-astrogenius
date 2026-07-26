'use strict';
/*
 * Run every headless test in tools/ and report one summary.
 *
 * Deliberately not a test framework. Each suite is a plain node script that
 * prints "ok <name>" per assertion and exits non-zero on failure, so any one of
 * them can be run on its own while debugging — which is how they actually get
 * used. This just runs the set and adds up the result.
 *
 * The Playwright smoke test (test_app.js) is NOT included: it launches the
 * real Electron app, needs the patched app.asar already installed, and takes
 * the better part of a minute. Run it separately.
 *
 *   node tools/run_tests.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const dir = __dirname;
const suites = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).sort();

let failed = 0;
let asserts = 0;

for (const s of suites) {
    let out = '';
    let ok = true;
    try {
        out = execFileSync(process.execPath, [path.join(dir, s)],
                           { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
        ok = false;
        out = (e.stdout || '') + (e.stderr || '');
    }
    const n = (out.match(/^ok\s/gm) || []).length;
    asserts += n;
    if (ok) {
        console.log('PASS  ' + s + '  (' + n + ')');
    } else {
        failed++;
        console.log('FAIL  ' + s);
        // Only the failing lines and whatever followed them — the passing
        // output of a 60-assertion suite buries the one line that matters.
        const lines = out.split(/\r?\n/);
        const first = lines.findIndex((l) => /^(FAIL|Error|\s*at )/.test(l));
        console.log(lines.slice(first < 0 ? 0 : first).join('\n').trim());
    }
}

console.log('\n' + (failed ? failed + ' of ' + suites.length + ' suites FAILED'
                           : suites.length + ' suites passed') +
            ', ' + asserts + ' assertions');
process.exit(failed ? 1 : 0);
