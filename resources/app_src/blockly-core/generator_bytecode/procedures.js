'use strict';
/*
 * Blockly.BytecodeVM handlers for Scratch-style procedures.
 *
 * IDE-side blocks:
 *   procedures_definition        hat wrapping a procedures_prototype child
 *   procedures_prototype         decorative header (procCode_, displayNames_)
 *   procedures_call              call statement (procCode_, argumentIds_)
 *   argument_reporter_boolean    boolean arg reader inside the body
 *   argument_reporter_string_number  number arg reader inside the body
 *   argument_reporter_string_only    string arg reader (VM has no strings)
 *
 * Calling convention (see the design note in the ceiling-lever session):
 *   caller pushes args left-to-right onto the operand stack, then CALL abs.
 *   callee STOREs them into pre-allocated var slots in reverse (LIFO natural
 *   pop order), runs body, then RET. No return value (Scratch procs are void).
 *
 * The pre-pass in Blockly.BytecodeVM._scanProcs() runs at init() and populates
 * G._procs so callers can look up the label + argSlots even if the
 * procedures_call block is emitted before its procedures_definition.
 */
goog.provide('Blockly.BytecodeVM.procedures');
goog.require('Blockly.BytecodeVM');

// procedures_definition -- emit the body into _procCode (out-of-line) and
// return null so the main body doesn't get the definition inlined.
Blockly.BytecodeVM['procedures_definition'] = function (block) {
    const G = Blockly.BytecodeVM;
    const proto = block.childBlocks_ && block.childBlocks_[0];
    if (!proto || !proto.procCode_) return null;
    const proc = G._procs[proto.procCode_];
    if (!proc) return null;   // scan missed it; nothing sensible to do
    if (proc.defined) {
        G.warn('procedures_definition',
            'duplicate definition for "' + proc.key + '"; keeping first');
        return null;
    }

    // Store args in reverse: last-pushed sits on top of the stack, so we pop
    // it into the LAST slot first. Skip string-arg sentinels: for those the
    // caller emitted a PUSH_I8 0 placeholder, so we still need to POP it,
    // but we don't have a slot to persist it into.
    let prelude = '';
    for (let i = proc.argSlots.length - 1; i >= 0; i--) {
        const slot = proc.argSlots[i];
        if (slot < 0) {
            prelude += G.byte(G.OPS.POP);
        } else {
            prelude += G.byte(G.OPS.STORE_VAR) + G.byte(slot);
        }
    }

    // Recurse into the body with _currentProc set so argument_reporter_*
    // knows which arg -> slot map to consult.
    const prev = G._currentProc;
    G._currentProc = proc;
    const bodyBlock = (typeof block.getNextBlock === 'function')
        ? block.getNextBlock() : null;
    const body = bodyBlock ? (G.blockToCode(bodyBlock) || '') : '';
    G._currentProc = prev;

    proc.defined = true;
    G._procCode +=
        'L:' + proc.label + '; ' +
        prelude +
        body +
        G.byte(G.OPS.RET);
    return null;
};

// procedures_prototype -- decorative; never emits code on its own. Guard
// in case Blockly ever calls into it (blockToCode on a top-level prototype).
Blockly.BytecodeVM['procedures_prototype'] = function () { return null; };
Blockly.BytecodeVM['procedures_declaration'] = function () { return null; };

// procedures_call -- push args left-to-right, then CALL absolute.
Blockly.BytecodeVM['procedures_call'] = function (block) {
    const G = Blockly.BytecodeVM;
    const key = block.procCode_;
    const proc = key ? G._procs[key] : null;
    if (!proc) {
        G.warn('procedures_call',
            'call to undefined procedure "' + (key || '?') + '"');
        return '';
    }
    const argIds = block.argumentIds_ || [];
    let pushes = '';
    for (let i = 0; i < argIds.length; i++) {
        const argBlock = (typeof block.getInputTargetBlock === 'function')
            ? block.getInputTargetBlock(argIds[i]) : null;
        let argCode = '';
        if (argBlock) {
            const handler = G[argBlock.type];
            if (handler) {
                const r = handler.call(argBlock, argBlock);
                argCode = Array.isArray(r) ? r[0] : (r || '');
            }
        }
        if (!argCode) argCode = G.pushInt(0);   // unwired arg -> 0
        pushes += argCode;
    }
    return pushes + 'C:' + proc.label + '; ';
};

// argument_reporter_string_number / argument_reporter_boolean -- resolve
// the arg name in the current procedure's slot table.
function argReporter(block, kind) {
    const G = Blockly.BytecodeVM;
    const name = String(block.getFieldValue('VALUE') || '');
    const proc = G._currentProc;
    if (!proc) {
        G.warn(kind, 'argument reporter "' + name + '" used outside a procedure');
        return [G.pushInt(0), G.ORDER_ATOMIC];
    }
    const idx = proc.argNames.indexOf(name);
    if (idx < 0) {
        G.warn(kind, 'unknown argument "' + name + '" in ' + proc.key);
        return [G.pushInt(0), G.ORDER_ATOMIC];
    }
    const slot = proc.argSlots[idx];
    if (slot < 0) {
        return [G.pushInt(0), G.ORDER_ATOMIC];
    }
    return [G.byte(G.OPS.LOAD_VAR) + G.byte(slot), G.ORDER_ATOMIC];
}

Blockly.BytecodeVM['argument_reporter_string_number'] = function (block) {
    return argReporter(block, 'argument_reporter_string_number');
};
Blockly.BytecodeVM['argument_reporter_boolean'] = function (block) {
    return argReporter(block, 'argument_reporter_boolean');
};

// String args: the VM has no string type. Emit a zero placeholder and warn
// once so the compile still succeeds. The caller side emits PUSH_I8 0 too
// (see procedures_call's unwired-arg fallback and _scanProcs's slot=-1).
Blockly.BytecodeVM['argument_reporter_string_only'] = function (block) {
    const G = Blockly.BytecodeVM;
    G.warn('argument_reporter_string_only',
        'string arguments are not supported by the VM; using 0');
    return [G.pushInt(0), G.ORDER_ATOMIC];
};
