'use strict';
/*
 * Post-processor that wraps every compiled sketch with the MiniR4 WiFi
 * runtime (feature/wifi-tcp-ota). After Blockly.Arduino.finish() produces
 * the user's sketch, we rename setup/loop to userSetup/userLoop and emit a
 * driver setup/loop that boots WiFiRuntime before user code runs.
 *
 * Effect: any sketch flashed from the IDE — via USB cable or WiFi OTA —
 * keeps the hub reachable on the network for the next wireless upload.
 * The BTN_UP recovery check lives inside WiFiRuntime.begin(), which is why
 * the driver calls it BEFORE userSetup(): a user sketch that blocks forever
 * can never lock the hub out of OTA mode.
 *
 * Differences from the BLE branch's arduino_ble_wrapper.js (the reference):
 *  - MiniR4.begin() is hoisted out of userSetup() into the driver so the
 *    runtime (buttons/OLED/dataflash) is initialised before the recovery
 *    check; the generator emits it as the first setup statement, but we
 *    fall back gracefully if that shape ever changes;
 *  - delay(N) is rewritten to WiFiRuntime.safeDelay(N) so long waits keep
 *    servicing the TCP/UDP stack (the starvation lesson from BLE).
 *
 * Idempotent: output containing MiniR4WiFiRuntime is returned unchanged.
 * Loaded from views/main.html as a plain script AFTER blockly-core/arduino.js.
 */
(function () {
    if (!window.Blockly || !Blockly.Arduino || typeof Blockly.Arduino.finish !== 'function') {
        console.warn('[WiFi wrapper] Blockly.Arduino.finish not present; skipping.');
        return;
    }
    if (Blockly.Arduino.__originalFinishWifi) return;   // already patched

    Blockly.Arduino.__originalFinishWifi = Blockly.Arduino.finish;

    Blockly.Arduino.finish = function (code) {
        const raw = Blockly.Arduino.__originalFinishWifi.call(this, code);
        if (raw && raw.indexOf('MiniR4WiFiRuntime') >= 0) {
            return raw;   // already wrapped
        }
        return wrapWithWiFiRuntime(raw);
    };

    // If the body is a single `while (true) { ... }` (or `while (1)`), return
    // just the inner block — Arduino's loop() already repeats, and an outer
    // forever-loop would starve WiFiRuntime.poll().
    function stripOuterWhileTrue(body) {
        const trimmed = body.replace(/^\s+|\s+$/g, '');
        const m = trimmed.match(/^while\s*\(\s*(?:true|1)\s*\)\s*\{/i);
        if (!m) return body;
        const openBrace = m[0].length - 1;
        let depth = 1;
        for (let i = openBrace + 1; i < trimmed.length; i++) {
            const ch = trimmed.charAt(i);
            if (ch === '{') depth++;
            else if (ch === '}') {
                depth--;
                if (depth === 0) {
                    const tail = trimmed.substring(i + 1).replace(/\s+/g, '');
                    if (tail.length !== 0) return body;
                    return trimmed.substring(openBrace + 1, i);
                }
            }
        }
        return body;
    }

    function extractFunctionBody(src, fnHeader) {
        const start = src.indexOf(fnHeader);
        if (start < 0) return null;
        const openBrace = src.indexOf('{', start);
        if (openBrace < 0) return null;
        let depth = 1;
        for (let i = openBrace + 1; i < src.length; i++) {
            const ch = src.charAt(i);
            if (ch === '{') depth++;
            else if (ch === '}') {
                depth--;
                if (depth === 0) {
                    return {
                        headerStart: start,
                        bodyStart: openBrace + 1,
                        bodyEnd: i,
                        end: i + 1,
                        body: src.substring(openBrace + 1, i),
                    };
                }
            }
        }
        return null;
    }

    // Rewrite every bare `delay(N)` into `WiFiRuntime.safeDelay(N)`. The
    // boundary guard skips identifiers (`myDelay(`) and member accesses
    // (`foo.delay(`); case-sensitive so `Delay(` from libraries is untouched.
    function rewriteDelays(src) {
        if (!src) return src;
        return src.replace(
            /(^|[^A-Za-z0-9_.])delay(\s*\()/g,
            '$1WiFiRuntime.safeDelay$2');
    }

    // R3 v2 — mirror the print blocks to the wireless console.
    //
    // Serial.print/println keep working exactly as before over USB; the
    // rewritten call also ships the finished line as a {"t":"log"} frame, so
    // a student running without a cable sees their prints in the IDE console.
    // `println(` cannot be matched by the `print(` pattern (the paren must
    // follow immediately), so the two replacements are independent.
    // Serial.begin/read/available/write are deliberately untouched.
    function rewriteSerialPrints(src) {
        if (!src) return src;
        return src
            .replace(/(^|[^A-Za-z0-9_.])Serial\.println(\s*\()/g,
                     '$1WiFiRuntime.logPrintln$2')
            .replace(/(^|[^A-Za-z0-9_.])Serial\.print(\s*\()/g,
                     '$1WiFiRuntime.logPrint$2');
    }

    // Produce a fresh 32-bit sketch ID for this build. The runtime stores it
    // alongside a saved VM program; a mismatch on the next boot is how we
    // detect that a USB or OTA reflash replaced the native sketch, and drop
    // the stale bytecode instead of auto-running it against a program that no
    // longer exists. Same scheme as the BLE branch. 0 and 0xFFFFFFFF are
    // reserved sentinels ("any sketch" / erased flash).
    function generateSketchId() {
        let n = 0;
        while (n === 0 || n === 0xFFFFFFFF) {
            n = (Math.random() * 0x100000000) >>> 0;
        }
        return n;
    }

    function formatSketchIdLiteral(id) {
        return '0x' + id.toString(16).padStart(8, '0').toUpperCase() + 'u';
    }

    function wrapWithWiFiRuntime(src) {
        if (!src) return src;

        const setup = extractFunctionBody(src, 'void setup()');
        const loop  = extractFunctionBody(src, 'void loop()');
        if (!setup || !loop) {
            console.warn('[WiFi wrapper] could not locate setup/loop; passing through.');
            return src;
        }

        const splitAt = Math.min(setup.headerStart, loop.headerStart);
        let head = src.substring(0, splitAt).replace(/\n*$/, '\n');

        const runtimeInclude = '#include "Modules/MiniR4WiFiRuntime.h"';
        const sketchIdDefine =
            '#define MINIR4_SKETCH_ID ((uint32_t)' +
            formatSketchIdLiteral(generateSketchId()) + ')';
        const injected = runtimeInclude + '\n' + sketchIdDefine;
        if (head.indexOf(runtimeInclude) < 0) {
            const includeRegex = /(^|\n)#include[^\n]*\n/g;
            let m, lastEnd = -1;
            while ((m = includeRegex.exec(head)) !== null) {
                lastEnd = m.index + m[0].length;
            }
            if (lastEnd > 0) {
                head = head.substring(0, lastEnd) + injected + '\n' +
                       head.substring(lastEnd);
            } else {
                head = injected + '\n' + head;
            }
        }

        // Hoist MiniR4.begin() out of the user setup so the driver can run
        // it before WiFiRuntime.begin() (recovery check needs buttons/OLED).
        let setupBody = setup.body.replace(/^\n+|\n+$/g, '');
        const beginRe = /(^|\n)[ \t]*MiniR4\s*\.\s*begin\s*\(\s*\)\s*;[ \t]*/;
        const hasMiniBegin = beginRe.test(setupBody);
        if (hasMiniBegin) {
            setupBody = setupBody.replace(beginRe, '$1');
        }

        const userSetup =
            'static void userSetup()\n{\n' + setupBody + '\n}\n\n';

        const loopBody = stripOuterWhileTrue(
            loop.body.replace(/^\n+|\n+$/g, ''));
        const userLoop =
            'static void userLoop()\n{\n' + loopBody + '\n}\n\n';

        // If the generator's setup did not contain MiniR4.begin() (shape
        // change), fall back to the BLE-branch order: userSetup() first,
        // WiFiRuntime.begin() second. Recovery still works as long as the
        // user setup terminates.
        // R2: an ephemeral VM program (uploaded via "Send VM") takes over
        // execution from userLoop while it's running. When the VM halts or
        // the user stops it, userLoop resumes. This is the "3 modes"
        // integration point: OTA sketches expose their userLoop, VM
        // uploads temporarily replace it, USB is untouched.
        // setSketchId must precede begin(): begin() decides there and then
        // whether a VM program saved in dataflash belongs to this sketch.
        const driver = hasMiniBegin
            ? ('void setup()\n{\n' +
               '  MiniR4.begin();\n' +
               '  WiFiRuntime.setSketchId(MINIR4_SKETCH_ID);\n' +
               '  WiFiRuntime.begin();\n' +
               '  userSetup();\n' +
               '}\n\n' +
               'void loop()\n{\n' +
               '  WiFiRuntime.poll();\n' +
               '  if (!WiFiRuntime.isRunningVM()) { userLoop(); }\n' +
               '}\n')
            : ('void setup()\n{\n' +
               '  userSetup();\n' +
               '  WiFiRuntime.setSketchId(MINIR4_SKETCH_ID);\n' +
               '  WiFiRuntime.begin();\n' +
               '}\n\n' +
               'void loop()\n{\n' +
               '  WiFiRuntime.poll();\n' +
               '  if (!WiFiRuntime.isRunningVM()) { userLoop(); }\n' +
               '}\n');

        // Rewrites run last, over the whole assembled sketch: the driver
        // itself contains no delay/Serial.print calls, and doing it once
        // here is cheaper than doing it per fragment.
        return rewriteSerialPrints(
            rewriteDelays(head + userSetup + userLoop + driver));
    }

    // Expose for testing.
    Blockly.Arduino.__wrapWithWiFiRuntime = wrapWithWiFiRuntime;
    Blockly.Arduino.__rewriteWifiDelays   = rewriteDelays;
    Blockly.Arduino.__rewriteWifiPrints   = rewriteSerialPrints;
    Blockly.Arduino.__generateSketchId    = generateSketchId;
    Blockly.Arduino.__formatSketchIdLit   = formatSketchIdLiteral;

    console.log('[WiFi wrapper] Blockly.Arduino.finish patched.');
})();
