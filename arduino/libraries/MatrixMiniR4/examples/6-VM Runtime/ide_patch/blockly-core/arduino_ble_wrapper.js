'use strict';
/*
 * Post-processor that wraps every USB-compiled sketch with the MiniR4 BLE
 * runtime. After Blockly.Arduino.finish() produces the user's sketch, we
 * rename setup/loop to userSetup/userLoop and emit a top-level setup/loop
 * that boots BLERuntime and yields to it before running user code.
 *
 * Effect: any sketch flashed from the IDE stays reachable over BLE at
 * "MATRIX-R4-Runtime". Wireless bytecode uploads from the IDE take over
 * automatically; erasing the stored bytecode (BLE ERASE command) falls
 * back to the compiled user code.
 *
 * Idempotent: if the generated string already contains the runtime include,
 * we assume the wrap has already been applied and return unchanged.
 *
 * Opt-out at runtime: hold BTN_UP + BTN_DOWN together for 3 seconds. See
 * src/Modules/MiniR4BLERuntime.h for details.
 */
goog.provide('Blockly.Arduino.bleWrapper');
goog.require('Blockly.Arduino');

(function () {
    if (!Blockly.Arduino || typeof Blockly.Arduino.finish !== 'function') {
        console.warn('[BLE wrapper] Blockly.Arduino.finish not present; skipping.');
        return;
    }
    if (Blockly.Arduino.__originalFinish) return;   // already patched

    Blockly.Arduino.__originalFinish = Blockly.Arduino.finish;

    Blockly.Arduino.finish = function (code) {
        const raw = Blockly.Arduino.__originalFinish.call(this, code);
        console.log('[BLE wrapper] finish() invoked, raw ' +
                    (raw ? raw.length : 0) + ' chars');
        if (raw && raw.indexOf('MiniR4BLERuntime') >= 0) {
            console.log('[BLE wrapper] already wrapped, pass through');
            return raw;
        }
        const wrapped = wrapWithBLERuntime(raw);
        console.log('[BLE wrapper] wrap applied, output ' +
                    (wrapped ? wrapped.length : 0) + ' chars, contains runtime include=' +
                    (wrapped && wrapped.indexOf('MiniR4BLERuntime.h') >= 0));
        return wrapped;
    };

    // If the body is a single `while (true) { ... }` (or `while (1)`), return
    // just the inner block. Depth counter matches braces so any `while(true)`
    // that starts and ends the whole body is detected regardless of what
    // lives inside. If the body has anything before/after that while, we
    // leave it alone.
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
                    // Anything after the closing brace? If so, keep original.
                    const tail = trimmed.substring(i + 1).replace(/\s+/g, '');
                    if (tail.length !== 0) return body;
                    return trimmed.substring(openBrace + 1, i);
                }
            }
        }
        return body;
    }

    // Extract the body between `void setup()` (or `loop()`) and its matching
    // closing brace, using a depth counter so nested { } don't fool us.
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

    // Rewrite every `delay(N)` call in `src` to `BLERuntime.delay(N)` so the
    // BLE stack stays serviced while the user code sleeps. Word-boundary + a
    // lookbehind for a non-`.` character make sure we don't touch identifiers
    // like `myDelay(500)` or attribute accesses like `foo.delay(1)`.
    // Case-sensitive so `Delay(...)` (some libraries) is left alone.
    function rewriteDelays(src) {
        if (!src) return src;
        return src.replace(
            /(^|[^A-Za-z0-9_.])delay(\s*\()/g,
            '$1BLERuntime.delay$2');
    }

    function wrapWithBLERuntime(src) {
        if (!src) return src;

        const setup = extractFunctionBody(src, 'void setup()');
        const loop  = extractFunctionBody(src, 'void loop()');
        if (!setup || !loop) {
            // Unexpected shape -- pass through untouched so we never break USB
            // compile when the generator format changes.
            console.warn('[BLE wrapper] could not locate setup/loop; passing through.');
            return src;
        }

        // Rebuild the file with:
        //   - everything before setup() untouched (imports/defines/user fns)
        //   - static void userSetup() { <setup body> }
        //   - static void userLoop()  { <loop body>  }
        //   - real setup() / loop() that drive BLERuntime + fall back to user code
        //
        // The BLE runtime include is prepended to the existing MatrixMiniR4.h.
        //
        // Choose the earlier of setup/loop as the split point so anything
        // between them (rare in Blockly output, but possible) is preserved.
        const splitAt = Math.min(setup.headerStart, loop.headerStart);
        let head = src.substring(0, splitAt);

        // Trim any accidental leftover "void setup()" / "void loop()" text after
        // splitAt (loop might come before setup in weird outputs).
        // Simpler: reconstruct from head + userSetup + userLoop + real driver.
        head = head.replace(/\n*$/, '\n');

        // Ensure the runtime include is present.
        const runtimeInclude = '#include "Modules/MiniR4BLERuntime.h"';
        if (head.indexOf(runtimeInclude) < 0) {
            // Insert right after the last #include line.
            const includeRegex = /(^|\n)#include[^\n]*\n/g;
            let m, lastEnd = -1;
            while ((m = includeRegex.exec(head)) !== null) {
                lastEnd = m.index + m[0].length;
            }
            if (lastEnd > 0) {
                head = head.substring(0, lastEnd) + runtimeInclude + '\n' +
                       head.substring(lastEnd);
            } else {
                head = runtimeInclude + '\n' + head;
            }
        }

        const userSetup =
            'static void userSetup()\n{\n' +
            setup.body.replace(/^\n+|\n+$/g, '') + '\n' +
            '}\n\n';

        // MATRIXblock's control_forever emits `while(true) { ... }` wrapping
        // the whole loop body. That would starve BLERuntime.poll() forever
        // because our driver calls userLoop() from the main loop() and
        // never gets control back. Arduino's loop() is already auto-repeating,
        // so we strip a single outer `while (true) { ... }` (or `while (1)`).
        // Nested while(true) inside user code is left untouched -- that will
        // still starve BLE, but at that point the student made a real choice.
        const loopBody = stripOuterWhileTrue(
            loop.body.replace(/^\n+|\n+$/g, ''));
        const userLoop =
            'static void userLoop()\n{\n' + loopBody + '\n}\n\n';
        const driver =
            'void setup()\n{\n' +
            '  userSetup();\n' +
            '  BLERuntime.begin();\n' +
            '}\n\n' +
            'void loop()\n{\n' +
            '  BLERuntime.poll();\n' +
            '  if (!BLERuntime.isRunningVM()) { userLoop(); }\n' +
            '}\n';

        return rewriteDelays(head + userSetup + userLoop + driver);
    }

    // Expose for testing.
    Blockly.Arduino.__wrapWithBLERuntime = wrapWithBLERuntime;
    Blockly.Arduino.__rewriteDelays      = rewriteDelays;

    console.log('[BLE wrapper] Blockly.Arduino.finish patched.');
})();
