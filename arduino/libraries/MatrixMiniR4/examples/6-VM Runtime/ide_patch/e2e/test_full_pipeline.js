'use strict';
/*
 * Full-pipeline test:
 *   1. Launch MATRIXblock via Playwright.
 *   2. Build a simple blink workspace programmatically.
 *   3. Run Blockly.Arduino.workspaceToCode(ws) -- this goes through the BLE
 *      wrapper.
 *   4. Save the emitted .ino to a temp dir.
 *   5. Compile it with arduino-cli against the real MatrixMiniR4 library
 *      (which now includes MiniR4BLERuntime).
 *   6. Report firmware size + verify no compile errors.
 *
 * Success here means: from the IDE, USB compile produces a valid firmware
 * that keeps BLE alive. Without this, the whole "always-on BLE" story
 * doesn't hold.
 *
 * Usage:  node test_full_pipeline.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { _electron: electron } = require('playwright');

const EXE = 'C:\\matrixblock-r4\\MATRIXblock Mini R4.exe';
const CLI = 'C:\\matrixblock-r4\\arduino\\arduino-cli.exe';
const CLI_YAML = 'C:\\matrixblock-r4\\arduino\\arduino-cli.yaml';

async function main() {
    console.log('Launching MATRIXblock via Playwright...');
    const app = await electron.launch({ executablePath: EXE, timeout: 60000 });
    const page = await app.firstWindow({ timeout: 30000 });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(4000);

    let generatedCode = '';
    try {
        generatedCode = await page.evaluate(() => {
            const ws = Blockly.getMainWorkspace();
            ws.clear();
            // Simple blink: setup + repeating red/blue LED with 500ms waits.
            const xmlStr =
                '<xml xmlns="http://www.w3.org/1999/xhtml">' +
                  '<block type="control_setup" x="20" y="20">' +
                    '<statement name="SUBSTACK">' +
                      '<block type="control_wait">' +
                        '<value name="TIMES">' +
                          '<shadow type="math_number">' +
                            '<field name="NUM">1</field>' +
                          '</shadow>' +
                        '</value>' +
                      '</block>' +
                    '</statement>' +
                  '</block>' +
                '</xml>';
            const dom = Blockly.Xml.textToDom(xmlStr);
            Blockly.Xml.domToWorkspace(dom, ws);
            return Blockly.Arduino.workspaceToCode(ws);
        });
    } finally {
        await app.close();
    }

    if (!generatedCode || generatedCode.length < 20) {
        console.error('FAIL: generator returned nothing.');
        process.exit(1);
    }
    console.log('Generated ' + generatedCode.length + ' bytes of C++.');
    console.log('---- first 500 chars ----');
    console.log(generatedCode.slice(0, 500));
    console.log('-------------------------');

    // Sanity checks on the generated string.
    const expectedMarkers = [
        '#include "MatrixMiniR4.h"',
        '#include "Modules/MiniR4BLERuntime.h"',
        'static void userSetup()',
        'static void userLoop()',
        'BLERuntime.begin();',
        'BLERuntime.poll();',
        'if (!BLERuntime.isRunningVM())',
    ];
    for (const m of expectedMarkers) {
        if (generatedCode.indexOf(m) < 0) {
            console.error('FAIL: missing marker: ' + m);
            process.exit(1);
        }
        console.log('  ok  ' + m);
    }

    // Write to temp .ino and try to compile.
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbr4-pipeline-'));
    const sketchDir = path.join(workDir, 'Sketch');
    fs.mkdirSync(sketchDir);
    const inoPath = path.join(sketchDir, 'Sketch.ino');
    fs.writeFileSync(inoPath, generatedCode);
    console.log('Wrote sketch to ' + inoPath);

    try {
        console.log('Compiling with arduino-cli...');
        // arduino-cli.yaml uses "./" for data/user dirs, so CWD must be the
        // arduino/ folder for local platforms/libraries to resolve.
        const out = execSync(
            `"${CLI}" --config-file "${CLI_YAML}" compile ` +
            `--fqbn arduino:renesas_uno:unor4wifi "${inoPath}"`,
            {
                encoding: 'utf8',
                maxBuffer: 20 * 1024 * 1024,
                stdio: 'pipe',
                cwd: 'C:\\matrixblock-r4\\arduino',
            });
        // Extract the flash/RAM lines from the summary.
        const flashMatch = out.match(/Sketch uses \d+ bytes[^\n]*/);
        const ramMatch   = out.match(/Global variables use \d+ bytes[^\n]*/);
        if (flashMatch) console.log('  ' + flashMatch[0]);
        if (ramMatch)   console.log('  ' + ramMatch[0]);
        console.log('\nOK -- full pipeline works. Generated firmware compiles.');
    } catch (e) {
        console.error('FAIL: compile failed.');
        console.error(e.stdout || '');
        console.error(e.stderr || '');
        process.exit(1);
    } finally {
        fs.rmSync(workDir, { recursive: true, force: true });
    }
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
