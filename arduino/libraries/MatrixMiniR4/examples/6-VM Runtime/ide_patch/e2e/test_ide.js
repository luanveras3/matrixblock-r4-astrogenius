'use strict';
/*
 * End-to-end test for the BLE runtime IDE patch.
 * Launches MATRIXblock Mini R4.exe via Playwright's Electron API and asserts:
 *   1. Blockly.BytecodeVM was loaded.
 *   2. The "Enviar via BLE" / "Send via BLE" button was installed.
 *   3. Blockly.BytecodeVM.compile() emits valid bytecode for a hand-built
 *      workspace and records warnings for unsupported blocks.
 *   4. If a MATRIX-R4-Runtime is powered nearby, we can enumerate BLE
 *      devices (Web Bluetooth chooser only — no real upload here).
 *
 * Real bytecode → BLE → VM verification requires a physical R4 with the
 * runtime sketch. Without hardware, step 4 is skipped gracefully.
 *
 * Usage:  node test_ide.js
 */
const path = require('path');
const { _electron: electron } = require('playwright');

const EXE = 'C:\\matrixblock-r4\\MATRIXblock Mini R4.exe';

let passed = 0, failed = 0;
function ok(msg)   { console.log('  ok   ' + msg); passed++; }
function fail(msg) { console.error('  FAIL ' + msg); failed++; }
function group(t)  { console.log('\n== ' + t + ' =='); }

async function main() {
    console.log('Launching MATRIXblock Mini R4 via Playwright...');
    const app = await electron.launch({
        executablePath: EXE,
        args: [],
        timeout: 60000,
    });
    const page = await app.firstWindow({ timeout: 30000 });

    // Boot takes a moment — AstroGenius extensions run late and Blockly's
    // locale isn't ready immediately.
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(4000);

    try {
        // ---- 1. Generator was loaded -----------------------------------
        group('Blockly.BytecodeVM loading');
        const gen = await page.evaluate(() => {
            if (!window.Blockly) return { present: false, reason: 'no Blockly' };
            if (!Blockly.BytecodeVM) return { present: false, reason: 'no BytecodeVM' };
            const G = Blockly.BytecodeVM;
            return {
                present: true,
                hasCompile: typeof G.compile === 'function',
                hasAssemble: typeof G._assemble === 'function',
                opCount: Object.keys(G.OPS || {}).length,
                sampleHandlers: ['control_forever', 'control_repeat',
                                 'data_setvariableto', 'math_number',
                                 'operator_add']
                    .filter(name => typeof G[name] === 'function'),
            };
        });
        if (gen.present) ok('Blockly.BytecodeVM is defined');
        else fail('Blockly.BytecodeVM missing: ' + gen.reason);
        if (gen.hasCompile) ok('compile() method exists');
        else fail('compile() missing');
        if (gen.hasAssemble) ok('_assemble() method exists');
        else fail('_assemble() missing');
        if (gen.opCount >= 50) ok('opcode table has ' + gen.opCount + ' entries');
        else fail('opcode table too small: ' + gen.opCount);
        const sh = gen.sampleHandlers || [];
        if (sh.length === 5) ok('all 5 sample handlers registered');
        else fail('missing handlers, got: ' + JSON.stringify(sh));

        // ---- 2. Buttons are installed ----------------------------------
        group('Connect + Send buttons');
        await page.waitForSelector('#bleConnectNavLink', { timeout: 5000 });
        await page.waitForSelector('#bleUploadNavLink', { timeout: 5000 });
        const btns = await page.evaluate(() => {
            const c = document.getElementById('bleConnectNavLink');
            const s = document.getElementById('bleUploadNavLink');
            const up = document.getElementById('uploadNavLink');
            return {
                connectPresent: !!c,
                sendPresent: !!s,
                connectLabel: c ? c.querySelector('span').textContent.trim() : '',
                sendLabel: s ? s.querySelector('span').textContent.trim() : '',
                connectAfterUpload: up && up.nextElementSibling === c,
                sendAfterConnect: c && c.nextElementSibling === s,
            };
        });
        if (btns.connectPresent) ok('#bleConnectNavLink present');
        else fail('#bleConnectNavLink not found');
        if (btns.sendPresent) ok('#bleUploadNavLink present');
        else fail('#bleUploadNavLink not found');
        if (btns.connectAfterUpload) ok('Connect sits right after Upload');
        else fail('Connect not adjacent to Upload');
        if (btns.sendAfterConnect) ok('Send sits right after Connect');
        else fail('Send not adjacent to Connect');
        if (/Conectar|Connect/.test(btns.connectLabel))
            ok('Connect label: "' + btns.connectLabel + '"');
        else fail('Connect label wrong: ' + btns.connectLabel);
        if (/BLE|Enviar|Send/.test(btns.sendLabel))
            ok('Send label: "' + btns.sendLabel + '"');
        else fail('Send label wrong: ' + btns.sendLabel);

        // ---- 3. Compile a hand-built workspace -------------------------
        group('BytecodeVM.compile on synthetic workspace');
        const compileResult = await page.evaluate(() => {
            const G = Blockly.BytecodeVM;
            G.init({});
            function mk(type, fields, values, statements) {
                fields = fields || {}; values = values || {}; statements = statements || {};
                return {
                    type,
                    _fields: fields, _values: values, _statements: statements,
                    getFieldValue(n){ return this._fields[n]; },
                    getField(n){ return n in this._fields ? { name: n } : null; },
                    nextConnection: null,
                };
            }
            // Rebind traversal to our mock tree.
            G.valueToCode = function(b, n){
                const c = b._values[n]; if (!c) return '';
                const r = G[c.type].call(c, c);
                return Array.isArray(r) ? r[0] : (r || '');
            };
            G.statementToCode = function(b, n){
                const c = b._statements[n]; if (!c) return '';
                return G[c.type].call(c, c) || '';
            };
            // Fake blockToCode so scrub_ can walk our nextConnection chain
            // without going through the real Blockly plumbing.
            G.blockToCode = function(b) {
                if (!b) return '';
                const h = G[b.type];
                if (!h) return '';
                const r = h.call(b, b);
                const code = Array.isArray(r) ? r[0] : (r || '');
                // Value blocks (returning [code, order]) bypass scrub_.
                if (Array.isArray(r)) return code;
                return G.scrub_(b, code);
            };
            G.statementToCode = function(b, n) {
                const c = b._statements[n];
                if (!c) return '';
                return G.blockToCode(c);
            };
            // control_forever { control_wait 1s; data_setvariableto v=42 }
            const wait = mk('control_wait', {}, {
                TIMES: mk('math_number', { NUM: '1' })
            });
            const setv = mk('data_setvariableto', { VARIABLE: 'v1' }, {
                VALUE: mk('math_number', { NUM: '42' })
            });
            // Chain wait -> setv through nextConnection.targetBlock (matches
            // what Blockly.BytecodeVM.scrub_ expects).
            wait.nextConnection = { targetBlock: () => setv };
            const forever = mk('control_forever', {}, {}, { SUBSTACK: wait });
            // Emit the top-level block, then close with finish().
            const tokenChain = G.blockToCode(forever);
            const tokens = G.finish(tokenChain);
            const bytes = Array.from(G._assemble(tokens));
            return {
                bytes,
                length: bytes.length,
                warnings: G._warnings.slice(),
                vars: Object.assign({}, G._varSlots),
                head: bytes.slice(0, 8),
                tail: bytes.slice(-4),
            };
        });
        if (compileResult.length > 0)
            ok('compiled ' + compileResult.length + ' bytes');
        else fail('empty bytecode');
        // Final byte must be HALT (0x01)
        if (compileResult.bytes[compileResult.bytes.length - 1] === 0x01)
            ok('last byte is HALT (0x01)');
        else fail('program does not end in HALT: 0x' +
            compileResult.bytes[compileResult.bytes.length - 1].toString(16));
        if (compileResult.warnings.length === 0)
            ok('no warnings on simple workspace');
        else fail('unexpected warnings: ' + JSON.stringify(compileResult.warnings));
        if (Object.keys(compileResult.vars).length === 1)
            ok('exactly 1 variable slot allocated');
        else fail('wrong var count: ' + Object.keys(compileResult.vars).length);

        // ---- 3b. Unsupported block records a warning -------------------
        const warnRes = await page.evaluate(() => {
            const G = Blockly.BytecodeVM;
            G.init({});
            function mk(type, fields){ return {
                type, _fields: fields || {},
                getFieldValue(n){ return this._fields[n]; },
                getField(n){ return n in this._fields ? { name: n } : null; },
                nextConnection: null,
                _values: {}, _statements: {},
            }; }
            G.valueToCode = function(b, n){
                const c = b._values && b._values[n]; if (!c) return '';
                const r = G[c.type].call(c, c);
                return Array.isArray(r) ? r[0] : (r || '');
            };
            const j = mk('operator_join');
            G['operator_join'].call(j, j);
            return G._warnings.slice();
        });
        if (warnRes.length === 1 && warnRes[0].block === 'operator_join')
            ok('operator_join records a warning');
        else fail('warning not recorded: ' + JSON.stringify(warnRes));

        // ---- 4. Web Bluetooth availability -----------------------------
        group('Web Bluetooth surface');
        const bt = await page.evaluate(() => {
            return {
                hasNavBluetooth: typeof navigator.bluetooth === 'object',
                hasRequestDevice: typeof navigator?.bluetooth?.requestDevice === 'function',
            };
        });
        if (bt.hasNavBluetooth) ok('navigator.bluetooth exists in renderer');
        else fail('Web Bluetooth is not enabled in this Electron build');
        if (bt.hasRequestDevice) ok('requestDevice() is callable');
        else fail('requestDevice() missing');

        // ---- 3c. Arduino generator is wrapped with BLE runtime ---------
        group('Arduino generator BLE wrap');
        const arduinoWrap = await page.evaluate(() => {
            const A = Blockly.Arduino;
            const patched = typeof A.__originalFinish === 'function';
            const ws = Blockly.getMainWorkspace();
            ws.clear();
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
            const code = A.workspaceToCode(ws);
            return {
                patched,
                hasRuntimeInclude: code.indexOf('MiniR4BLERuntime.h') >= 0,
                hasUserSetup: code.indexOf('static void userSetup()') >= 0,
                hasUserLoop:  code.indexOf('static void userLoop()')  >= 0,
                hasDriverBegin: code.indexOf('BLERuntime.begin();') >= 0,
                hasDriverPoll:  code.indexOf('BLERuntime.poll();')  >= 0,
                snippet: code.slice(0, 300),
            };
        });
        if (arduinoWrap.patched) ok('Blockly.Arduino.finish patched');
        else fail('Blockly.Arduino.finish NOT patched');
        if (arduinoWrap.hasRuntimeInclude) ok('runtime include emitted');
        else fail('runtime include missing');
        if (arduinoWrap.hasUserSetup && arduinoWrap.hasUserLoop)
            ok('userSetup + userLoop present');
        else fail('user functions missing');
        if (arduinoWrap.hasDriverBegin && arduinoWrap.hasDriverPoll)
            ok('driver setup/loop call BLERuntime');
        else fail('driver missing BLERuntime calls: ' + arduinoWrap.snippet);

        // ---- 4b. Full BLE session with mocked hardware -----------------
        group('sendViaBLE with mocked BLE device');
        const bleFlow = await page.evaluate(async () => {
            // Test 3 replaced BytecodeVM.statementToCode/valueToCode/blockToCode
            // with mock traversal. Restore the real ones (inherited from
            // Blockly.Generator.prototype) so real blocks work again.
            const G = Blockly.BytecodeVM;
            delete G.statementToCode;
            delete G.valueToCode;
            delete G.blockToCode;

            // Build a small workspace via XML (matches how MATRIXblock loads
            // saved files; more reliable than newBlock+connect programmatic).
            const ws = Blockly.getMainWorkspace();
            ws.clear();
            const xmlStr =
                '<xml xmlns="http://www.w3.org/1999/xhtml">' +
                  '<block type="control_forever" x="20" y="20">' +
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

            // Install a mocked navigator.bluetooth that records writes.
            const writes = [];
            const notifyHandlers = [];
            const RX_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
            const TX_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
            const fakeDevice = {
                addEventListener: () => {},   // gattserverdisconnected hook
                gatt: {
                    connected: false,
                    connect: async function () { this.connected = true; return this._server; },
                    disconnect: function () { this.connected = false; },
                    _server: null,
                },
            };
            fakeDevice.gatt._server = {
                        getPrimaryService: async () => ({
                            getCharacteristic: async (uuid) => {
                                const u = String(uuid).toLowerCase();
                                if (u === RX_UUID) {
                                    return {
                                        _kind: 'rx',
                                        writeValueWithResponse: async (buf) => {
                                            const bytes = Array.from(new Uint8Array(buf));
                                            writes.push(bytes);
                                            // ACK the command byte, then if it
                                            // was RUN or INFO also fire a
                                            // STATE(running=0) so sendViaBLE's
                                            // halt-watcher unblocks.
                                            setTimeout(() => {
                                                const ack = new Uint8Array([0xA0, bytes[0], 0x00]);
                                                notifyHandlers.forEach(h => h({
                                                    target: { value: new DataView(ack.buffer) }
                                                }));
                                                if (bytes[0] === 0x04 /*RUN*/ || bytes[0] === 0x07 /*INFO*/) {
                                                    const state = new Uint8Array([
                                                        0xA1, 0 /*running*/, 0, 0,
                                                        1 /*err=HALTED*/, 14, 0
                                                    ]);
                                                    notifyHandlers.forEach(h => h({
                                                        target: { value: new DataView(state.buffer) }
                                                    }));
                                                }
                                            }, 0);
                                        }
                                    };
                                }
                                if (u === TX_UUID) {
                                    return {
                                        _kind: 'tx',
                                        startNotifications: async () => {},
                                        addEventListener: (evt, cb) => notifyHandlers.push(cb),
                                    };
                                }
                                throw new Error('unexpected characteristic uuid: ' + u);
                            },
                        }),
                    };
            // navigator.bluetooth is a readonly getter -- must use
            // Object.defineProperty to override in the renderer.
            Object.defineProperty(navigator, 'bluetooth', {
                configurable: true,
                writable: true,
                value: { requestDevice: async () => fakeDevice },
            });

            // New flow: Connect first (opens session), then click Send.
            document.getElementById('bleConnectNavLink').click();
            // Wait for the Connect button label to switch to "Desconectar".
            const connectDeadline = Date.now() + 3000;
            while (Date.now() < connectDeadline) {
                await new Promise(r => setTimeout(r, 50));
                const lbl = document.querySelector('#bleConnectNavLink span').textContent;
                if (/Desconectar|Disconnect/.test(lbl)) break;
            }
            // Then click Send.
            document.getElementById('bleUploadNavLink').click();

            // Wait for the upload to complete (upload runs synchronously via awaits
            // in the handler; give it a beat).
            const deadline = Date.now() + 5000;
            while (Date.now() < deadline) {
                await new Promise(r => setTimeout(r, 50));
                const logs = Array.from(document.querySelectorAll('.console-Div > div'))
                    .map(d => d.textContent);
                // Wait for the "halted" line -- that's the final log the
                // handler emits before releasing the busy flag.
                if (logs.find(l => /halted|conclu[ií]do|finished cleanly/i.test(l))) {
                    // Give sendViaBLE one more tick to clear busy=false.
                    await new Promise(r => setTimeout(r, 100));
                    return { writes, logs };
                }
            }
            const logs = Array.from(document.querySelectorAll('.console-Div > div'))
                .map(d => d.textContent);
            return { writes, logs, timeout: true };
        });

        if (bleFlow.timeout) fail('BLE mock never saw halt (timed out)');

        // Find frames by their command byte (order is now: INFO sanity ping,
        // START, CHUNK*, END, RUN, INFO poll*).
        const startFrame = bleFlow.writes.find(f => f[0] === 0x01);
        if (startFrame && startFrame.length === 3)
            ok('START frame present with 16-bit size');
        else fail('bad or missing START frame: ' + JSON.stringify(startFrame));

        // All CHUNK frames start with 0x02.
        const chunks = bleFlow.writes.filter(f => f[0] === 0x02);
        if (chunks.length > 0)
            ok(chunks.length + ' CHUNK frame(s) sent');
        else fail('no CHUNK frames');

        // END = 0x03
        const beforeRun = bleFlow.writes.find(f => f[0] === 0x03);
        if (beforeRun) ok('END frame sent');
        else fail('no END frame');

        // RUN = 0x04
        const run = bleFlow.writes.find(f => f[0] === 0x04);
        if (run) ok('RUN frame sent');
        else fail('no RUN frame');

        // Reassemble the payload from CHUNK bodies and check it ends in HALT (0x01)
        const payload = [];
        for (const c of chunks) for (let i = 1; i < c.length; i++) payload.push(c[i]);
        if (payload.length > 0 && payload[payload.length - 1] === 0x01)
            ok('payload ends in HALT (' + payload.length + ' bytes total)');
        else fail('payload does not end in HALT: ' +
            JSON.stringify(payload.slice(-4)));

        // ---- 5. Button click on empty workspace shows error ------------
        group('sendViaBLE handler on empty workspace');
        // Clear whatever the mock test left behind.
        await page.evaluate(() => {
            const ws = Blockly.getMainWorkspace();
            ws.clear();
        });
        const preClickLines = await page.evaluate(() =>
            document.querySelectorAll('.console-Div > div').length);
        await page.click('#bleUploadNavLink');
        // The handler logs synchronously before returning; small wait for DOM.
        await page.waitForTimeout(500);
        const postClick = await page.evaluate(() => {
            const lines = Array.from(document.querySelectorAll('.console-Div > div'))
                .map(d => d.textContent);
            return { lines, count: lines.length };
        });
        if (postClick.count > preClickLines)
            ok('console-Div received new log lines');
        else fail('console-Div did not update after click');
        const emptyMsg = postClick.lines.find(l =>
            /vazia|empty/i.test(l));
        if (emptyMsg) ok('empty-workspace warning shown: "' + emptyMsg + '"');
        else fail('no empty-workspace message; got: ' +
            JSON.stringify(postClick.lines.slice(-3)));

    } finally {
        await app.close();
    }

    console.log('\n=== ' + passed + ' passed, ' + failed + ' failed ===');
    process.exitCode = failed ? 1 : 0;
}

main().catch(e => {
    console.error('FATAL', e);
    process.exitCode = 1;
});
