'use strict';
/*
 * Blockly.BytecodeVM — alternate generator that emits MiniR4VM bytecode.
 *
 * Runs alongside Blockly.Arduino. The existing USB compile/upload path is
 * untouched; the new "Send via BLE" button drives this generator instead.
 *
 * Emit strategy (two-pass assembler):
 *   Handlers return whitespace-separated tokens as a plain string.
 *   Tokens are either hex byte pairs ("02", "d0") or symbolic ops:
 *     L:name;         label definition
 *     J:name;         JMP  (relative i16)
 *     JI:name;        JMP_IF
 *     JN:name;        JMP_IF_NOT
 *     C:name;         CALL (absolute u16)
 *   finish() concatenates setup + main + HALT and returns the token string.
 *   compile() runs the assembler over that string and returns a Uint8Array.
 *
 * Program shape produced:
 *   [ setup body ] L:main; [ main body ] J:main; HALT
 *
 * Matches Arduino generator semantics: the main workspace body auto-repeats
 * (equivalent to void loop()). Explicit control_forever is still allowed;
 * it becomes a nested loop.
 */

goog.provide('Blockly.BytecodeVM');
goog.require('Blockly.Generator');

Blockly.BytecodeVM = new Blockly.Generator('BytecodeVM');

// Maximum bytecode size the runtime accepts (mirrors MAX_PROGRAM in
// src/Modules/MiniR4BLERuntime.cpp). Single source of truth for the
// IDE; other modules (ble_upload.js size bar + fallback modal) read
// this instead of hard-coding.
Blockly.BytecodeVM.MAX_PROGRAM_BYTES = 6144;

// --- Precedence (all atomic; every value block returns a stack push) --------
Blockly.BytecodeVM.ORDER_ATOMIC = 0;
Blockly.BytecodeVM.ORDER_NONE = 99;

// --- Opcode table (mirrors src/Modules/MiniR4VM.h VMOp enum) ----------------
Blockly.BytecodeVM.OPS = {
    NOP: 0x00, HALT: 0x01,
    PUSH_I8: 0x02, PUSH_I16: 0x03, PUSH_I32: 0x04,
    POP: 0x05, DUP: 0x06, SWAP: 0x07,
    LOAD_VAR: 0x10, STORE_VAR: 0x11,
    ADD: 0x20, SUB: 0x21, MUL: 0x22, DIV: 0x23, MOD: 0x24,
    NEG: 0x25, ABS: 0x26, MIN: 0x27, MAX: 0x28, RANDOM: 0x29,
    EQ: 0x30, NEQ: 0x31, LT: 0x32, GT: 0x33, LTE: 0x34, GTE: 0x35,
    AND: 0x40, OR: 0x41, NOT: 0x42,
    JMP: 0x50, JMP_IF: 0x51, JMP_IF_NOT: 0x52, CALL: 0x53, RET: 0x54,
    DELAY_MS: 0x60, MILLIS: 0x61,
    LED_COLOR: 0x70, BUZZ_TONE: 0x71, BUZZ_STOP: 0x72,
    MOTOR_POWER: 0x80, MOTOR_SPEED: 0x81, MOTOR_ROTATE: 0x82,
    MOTOR_BRAKE: 0x83, MOTOR_DEGREES: 0x84, MOTOR_RESET: 0x85,
    SERVO_ANGLE: 0x90,
    IMU_EULER: 0xA0, IMU_ACCEL: 0xA1, IMU_RESET: 0xA2,
    BTN_PRESSED: 0xB0,
    OLED_CLEAR: 0xC0, OLED_CURSOR: 0xC1, OLED_PRINT_I: 0xC2, OLED_DISPLAY: 0xC3,
    PIN_MODE: 0xD0, DIGITAL_READ: 0xD1, DIGITAL_WRITE: 0xD2,
    ANALOG_READ: 0xD3, ANALOG_WRITE: 0xD4,
    DDC_BEGIN: 0xE0, DDC_SETPID: 0xE1, DDC_MOVE: 0xE2,
    DDC_MOVE_DEGS: 0xE3, DDC_MOVE_TIME: 0xE4, DDC_TURN: 0xE5,
    DDC_BRAKE: 0xE6, DDC_DEGREES: 0xE7, DDC_RESET: 0xE8,
    US_DISTANCE: 0xE9, MOTOR_SETREV: 0xEA, SERVO_SETHW: 0xEB,
    IMU_GYRO: 0xEC, LED_BRIGHT: 0xED, PWR_VOLT: 0xEE,
    MOTOR_SETPPR: 0xEF, RANDOM_SEED: 0xF0, ROUND: 0xF1,
};

// --- Per-compile state ------------------------------------------------------
Blockly.BytecodeVM.init = function (workspace) {
    this._labelCounter = 0;
    this._varSlots = Object.create(null);
    this._setupCode = '';
    this._warnings = [];
    this._scratchDepth = 0;
    this._maxScratchDepth = 0;
    // Procedures: keyed by procCode_ (Scratch mutation string). Populated by
    // _scanProcs() before workspaceToCode() so callers can resolve labels and
    // arg slots regardless of block visit order.
    this._procs = Object.create(null);
    this._procCode = '';        // proc bodies appended after HALT
    this._currentProc = null;   // set while emitting a definition body so
                                // argument reporters can resolve arg -> slot
    if (workspace && typeof workspace.getTopBlocks === 'function') {
        this._scanProcs(workspace);
    }
};

// Pre-pass: allocate a label + arg-slot table for every procedures_definition
// on the workspace. Runs before workspaceToCode() so procedures_call can look
// up its target even when the caller is emitted before the definition.
Blockly.BytecodeVM._scanProcs = function (workspace) {
    const tops = workspace.getTopBlocks(false) || [];
    for (let i = 0; i < tops.length; i++) {
        const def = tops[i];
        if (!def || def.type !== 'procedures_definition') continue;
        const proto = def.childBlocks_ && def.childBlocks_[0];
        if (!proto || !proto.procCode_) continue;
        const key = proto.procCode_;
        if (this._procs[key]) continue;   // duplicate definition; keep first

        const argNames = (proto.displayNames_ || []).slice();
        const argTypes = [];
        const argSlots = [];
        for (let j = 0; j < argNames.length; j++) {
            const child = proto.childBlocks_ && proto.childBlocks_[j];
            const t = child && child.type || 'argument_reporter_string_number';
            argTypes.push(t);
            if (t === 'argument_reporter_string_only') {
                argSlots.push(-1);   // sentinel: strings unsupported
            } else {
                argSlots.push(this.varSlot('proc:' + key + ':' + argNames[j]));
            }
        }
        this._procs[key] = {
            key: key,
            label: this.newLabel('proc'),
            argNames: argNames,
            argTypes: argTypes,
            argSlots: argSlots,
            defined: false,
        };
    }
};

// --- Helpers ----------------------------------------------------------------
Blockly.BytecodeVM.newLabel = function (prefix) {
    return (prefix || 'L') + '_' + (this._labelCounter++);
};

Blockly.BytecodeVM.varSlot = function (name) {
    if (!(name in this._varSlots)) {
        const used = Object.keys(this._varSlots).length;
        if (used >= 16) {
            throw new Error(
                'MiniR4VM supports at most 16 variables — this program uses more. ' +
                'Reduce the number of variables or use USB upload.'
            );
        }
        this._varSlots[name] = used;
    }
    return this._varSlots[name];
};

// Scratch slots grow downward from slot 15 so they don't collide with user
// variables (which grow upward from slot 0). Nested control_repeat uses this.
Blockly.BytecodeVM.pushScratchSlot = function () {
    this._scratchDepth++;
    if (this._scratchDepth > this._maxScratchDepth) {
        this._maxScratchDepth = this._scratchDepth;
    }
    return 16 - this._scratchDepth;
};

Blockly.BytecodeVM.popScratchSlot = function () {
    this._scratchDepth--;
};

Blockly.BytecodeVM.warn = function (blockType, msg) {
    this._warnings.push({ block: blockType, msg: msg });
};

// Emit a single opcode byte or immediate byte as one hex token.
Blockly.BytecodeVM.byte = function (v) {
    return (v & 0xFF).toString(16).padStart(2, '0') + ' ';
};

Blockly.BytecodeVM.op = Blockly.BytecodeVM.byte;

// Emit the narrowest push for a signed integer literal.
Blockly.BytecodeVM.pushInt = function (v) {
    v = v | 0;   // coerce to 32-bit signed
    if (v >= -128 && v <= 127) {
        return this.byte(this.OPS.PUSH_I8) + this.byte(v);
    }
    if (v >= -32768 && v <= 32767) {
        return this.byte(this.OPS.PUSH_I16) +
               this.byte(v) + this.byte(v >> 8);
    }
    return this.byte(this.OPS.PUSH_I32) +
           this.byte(v) + this.byte(v >> 8) +
           this.byte(v >> 16) + this.byte(v >>> 24);
};

// --- Blockly overrides ------------------------------------------------------
Blockly.BytecodeVM.scrubNakedValue = function (line) {
    // Naked value expression at statement level — discard its result.
    return line + this.byte(this.OPS.POP);
};

Blockly.BytecodeVM.quote_ = function (s) { return s; };

Blockly.BytecodeVM.scrub_ = function (block, code) {
    if (code === null) return '';
    const next = block.nextConnection && block.nextConnection.targetBlock();
    const nextCode = this.blockToCode(next) || '';
    return code + nextCode;
};

// --- finish / compile -------------------------------------------------------
// Layout: [ setup ] L:main; [ main ] J:main; HALT [ proc bodies ]
// Proc bodies live after HALT so control never falls into them; they are
// only reachable via CALL (absolute u16 patched by the assembler).
Blockly.BytecodeVM.finish = function (code) {
    const preLoop = this._setupCode || '';
    const trimmed = (code || '').trim();
    let body = '';
    if (trimmed.length > 0) {
        const mainLabel = this.newLabel('main');
        body = 'L:' + mainLabel + '; ' + trimmed + ' J:' + mainLabel + '; ';
    }
    const procs = this._procCode || '';
    return preLoop + body + this.byte(this.OPS.HALT) + procs;
};

/**
 * Compile a workspace to bytecode. Returns { bytes, warnings, variables }.
 * bytes:     Uint8Array — ready to send over BLE via START/CHUNK/END.
 * warnings:  array of { block, msg } — unsupported blocks the emitter skipped.
 * variables: { name -> slot } — for debugging the UI.
 */
Blockly.BytecodeVM.compile = function (workspace) {
    const tokens = this.workspaceToCode(workspace);
    const bytes = this._assemble(tokens);
    return {
        bytes: bytes,
        warnings: this._warnings.slice(),
        variables: Object.assign({}, this._varSlots),
    };
};

// --- Two-pass assembler -----------------------------------------------------
Blockly.BytecodeVM._assemble = function (text) {
    const rawTokens = text.split(/\s+/);
    const tokens = [];
    for (let i = 0; i < rawTokens.length; i++) {
        if (rawTokens[i].length) tokens.push(rawTokens[i]);
    }

    const labels = Object.create(null);
    const patches = [];   // { kind: 'REL16'|'ABS16', name, at }
    const bytes = [];

    for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i];
        if (tok.charAt(0) === 'L' && tok.charAt(1) === ':') {
            labels[tok.slice(2).replace(/;$/, '')] = bytes.length;
            continue;
        }
        // JMP / JMP_IF / JMP_IF_NOT / CALL
        if (tok.charAt(0) === 'J' || tok.charAt(0) === 'C') {
            let opcode, kind;
            let name;
            if (tok.indexOf('JI:') === 0) {
                opcode = this.OPS.JMP_IF; kind = 'REL16';
                name = tok.slice(3);
            } else if (tok.indexOf('JN:') === 0) {
                opcode = this.OPS.JMP_IF_NOT; kind = 'REL16';
                name = tok.slice(3);
            } else if (tok.indexOf('J:') === 0) {
                opcode = this.OPS.JMP; kind = 'REL16';
                name = tok.slice(2);
            } else if (tok.indexOf('C:') === 0) {
                opcode = this.OPS.CALL; kind = 'ABS16';
                name = tok.slice(2);
            } else {
                throw new Error('Unknown token: ' + tok);
            }
            name = name.replace(/;$/, '');
            bytes.push(opcode, 0, 0);
            patches.push({ kind: kind, name: name, at: bytes.length - 2 });
            continue;
        }
        // Plain hex byte
        const v = parseInt(tok, 16);
        if (Number.isNaN(v)) throw new Error('Bad token: ' + tok);
        bytes.push(v & 0xFF);
    }

    for (let i = 0; i < patches.length; i++) {
        const p = patches[i];
        const target = labels[p.name];
        if (target === undefined) {
            throw new Error('Unresolved label: ' + p.name);
        }
        if (p.kind === 'REL16') {
            const pcAfter = p.at + 2;
            const offset = target - pcAfter;
            if (offset < -32768 || offset > 32767) {
                throw new Error('Jump offset out of i16 range at byte ' + p.at);
            }
            bytes[p.at]     = offset & 0xFF;
            bytes[p.at + 1] = (offset >> 8) & 0xFF;
        } else {  // ABS16
            if (target < 0 || target > 65535) {
                throw new Error('CALL target out of u16 range');
            }
            bytes[p.at]     = target & 0xFF;
            bytes[p.at + 1] = (target >> 8) & 0xFF;
        }
    }

    if (bytes.length > Blockly.BytecodeVM.MAX_PROGRAM_BYTES) {
        const err = new Error(
            'Bytecode is ' + bytes.length + ' bytes; dataflash only holds ' +
            Blockly.BytecodeVM.MAX_PROGRAM_BYTES + '.'
        );
        err.byteSize = bytes.length;
        err.overCap  = true;
        throw err;
    }

    return new Uint8Array(bytes);
};
