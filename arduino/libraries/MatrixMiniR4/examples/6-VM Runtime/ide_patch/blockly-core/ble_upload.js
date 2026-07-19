'use strict';
/*
 * MATRIXblock BLE runtime uploader.
 *
 * Adds two nav buttons next to Upload:
 *   - "Conectar" / "Desconectar": opens/closes a persistent GATT session with
 *     MATRIX-R4-Runtime. Icon color reflects state.
 *   - "Enviar via BLE": compiles the workspace and streams bytecode over the
 *     open session. If no session is open, this button asks the user to
 *     connect first.
 *
 * The existing USB compile+upload path is not modified.
 *
 * Wire protocol mirrors examples/6-VM Runtime/python_client/miniR4_client.py.
 */
(function () {
    // --- i18n (self-contained; reads locale from Blockly.ScratchMsgs) --------
    const STRINGS = {
        en: {
            connect:        'Connect',
            disconnect:     'Disconnect',
            connectTitle:   'Open a BLE session with a MATRIX-R4-Runtime',
            disconnectTitle:'Close the current BLE session',
            connecting:     'Connecting to %s...',
            connectedMsg:   'Connected. Session ready.',
            disconnected:   'Disconnected.',
            connectFail:    'Could not connect: %s',
            notConnected:   'Not connected. Click "Connect" first.',
            modalTitle:     'BLE connection',
            modalHubName:   'Hub name (optional)',
            modalHubHint:   'Leave "MATRIX-" alone to list every hub in range, or type the exact name to jump straight to it.',
            modalSearch:    'Search',
            modalCancel:    'Cancel',
            modalClose:     'Close',
            modalStatusIdle:'Idle',
            modalStatusBusy:'Working...',
            modalStatusConn:'Connected to %s',
            cancelled:      'Cancelled by user.',
            modalRename:    'Rename this hub',
            modalRenameHint:'Up to 24 printable ASCII characters. Takes effect after the R4 restarts.',
            modalRenameSave:'Save',
            renameEmpty:    'Name is empty.',
            renameTooLong:  'Name too long (max %d).',
            renameBadChar:  'Only printable ASCII is allowed.',
            renameOk:       'Name saved. Restart the R4 for it to take effect.',
            renameFail:     'Rename failed (status %d).',
            btnLabel:       'Send via BLE',
            btnTitle:       'Compile blocks to bytecode and send to the R4 over BLE',
            unsupported:    'Web Bluetooth is not available in this environment.',
            compiling:      'Compiling workspace...',
            compiledOK:     'Compiled: %d bytes, %d variable(s).',
            compileFail:    'Compile failed: %s',
            uploading:      'Uploading %d bytes...',
            uploadDone:     'Uploaded in %d ms (%d B/s effective).',
            starting:       'Starting program on R4...',
            halted:         'Program finished cleanly.',
            vmError:        'VM error %d at PC %d.',
            unsupportedBlocks: '%d unsupported block(s) skipped. See details below.',
            unsupportedTypes: 'Unhandled block types: %s',
            reject:         'START rejected (status %d).',
            chunkReject:    'CHUNK at offset %d rejected (status %d).',
            endReject:      'END rejected (status %d). Flash persistence may have failed.',
            runReject:      'RUN rejected (status %d).',
            emptyWorkspace: 'The workspace is empty.',
            trivialPayload: 'Compiled payload is trivial (%d bytes) -- likely all your blocks are unsupported by the BLE runtime yet. USB upload still works.',
        },
        'pt-BR': {
            connect:        'Conectar',
            disconnect:     'Desconectar',
            connectTitle:   'Abrir sessao BLE com um MATRIX-R4-Runtime',
            disconnectTitle:'Encerrar a sessao BLE atual',
            connecting:     'Conectando a %s...',
            connectedMsg:   'Conectado. Sessao pronta.',
            disconnected:   'Desconectado.',
            connectFail:    'Nao foi possivel conectar: %s',
            notConnected:   'Sem conexao. Clique em "Conectar" primeiro.',
            modalTitle:     'Conexao BLE',
            modalHubName:   'Nome do hub (opcional)',
            modalHubHint:   'Deixe "MATRIX-" para listar todos os hubs no ar, ou digite o nome exato para conectar direto.',
            modalSearch:    'Buscar',
            modalCancel:    'Cancelar',
            modalClose:     'Fechar',
            modalStatusIdle:'Ocioso',
            modalStatusBusy:'Trabalhando...',
            modalStatusConn:'Conectado a %s',
            cancelled:      'Cancelado pelo usuario.',
            modalRename:    'Renomear este hub',
            modalRenameHint:'Ate 24 caracteres ASCII imprimiveis. Aplica apos reiniciar o R4.',
            modalRenameSave:'Salvar',
            renameEmpty:    'Nome vazio.',
            renameTooLong:  'Nome muito longo (max %d).',
            renameBadChar:  'Somente ASCII imprimivel e permitido.',
            renameOk:       'Nome salvo. Reinicie o R4 para aplicar.',
            renameFail:     'Falha ao renomear (status %d).',
            btnLabel:       'Enviar via BLE',
            btnTitle:       'Compila os blocos para bytecode e envia para o R4 por BLE',
            unsupported:    'Web Bluetooth nao esta disponivel neste ambiente.',
            compiling:      'Compilando area de trabalho...',
            compiledOK:     'Compilado: %d bytes, %d variavel(is).',
            compileFail:    'Falha na compilacao: %s',
            uploading:      'Enviando %d bytes...',
            uploadDone:     'Enviado em %d ms (%d B/s efetivo).',
            starting:       'Iniciando programa no R4...',
            halted:         'Programa concluido com sucesso.',
            vmError:        'Erro do VM: codigo %d no PC %d.',
            unsupportedBlocks: '%d bloco(s) nao suportados foram ignorados. Veja detalhes abaixo.',
            unsupportedTypes: 'Tipos nao suportados: %s',
            reject:         'START recusado (status %d).',
            chunkReject:    'CHUNK no offset %d recusado (status %d).',
            endReject:      'END recusado (status %d). A gravacao na flash pode ter falhado.',
            runReject:      'RUN recusado (status %d).',
            emptyWorkspace: 'A area de trabalho esta vazia.',
            trivialPayload: 'Programa compilado tem apenas %d byte(s) -- provavelmente todos seus blocos ainda nao sao suportados pelo runtime BLE. O upload por USB continua funcionando.',
        },
    };
    function locale() {
        try {
            const l = Blockly && Blockly.ScratchMsgs && Blockly.ScratchMsgs.currentLocale_;
            if (l && STRINGS[l]) return l;
        } catch (e) {}
        return 'en';
    }
    function tr(k) { return STRINGS[locale()][k] || STRINGS.en[k]; }
    function fmt(t) {
        const args = Array.prototype.slice.call(arguments, 1);
        let i = 0;
        return t.replace(/%[ds]/g, () => (args[i++] !== undefined ? args[i - 1] : ''));
    }

    // --- Protocol constants (must match MiniR4_BLE_Runtime.ino) --------------
    const NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
    const NUS_RX      = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
    const NUS_TX      = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
    const DEFAULT_DEVICE_NAME = 'MATRIX-R4-Runtime';
    const REQUIRED_PREFIX     = 'MATRIX-';
    const DEVICE_NAME_KEY = 'ble.deviceName';
    function normalizeHubName(raw) {
        const clean = (raw || '').trim();
        if (!clean) return REQUIRED_PREFIX;
        if (clean.toUpperCase().startsWith(REQUIRED_PREFIX)) return clean;
        return REQUIRED_PREFIX + clean;
    }
    function getDeviceName() {
        try {
            const stored = window.localStorage.getItem(DEVICE_NAME_KEY);
            if (stored && stored.trim()) return stored.trim();
        } catch (e) {}
        return DEFAULT_DEVICE_NAME;
    }
    function setDeviceName(name) {
        const clean = (name || '').trim();
        try {
            if (clean && clean !== DEFAULT_DEVICE_NAME) {
                window.localStorage.setItem(DEVICE_NAME_KEY, clean);
            } else {
                window.localStorage.removeItem(DEVICE_NAME_KEY);
            }
        } catch (e) {}
    }

    const CMD_START = 0x01, CMD_CHUNK = 0x02, CMD_END = 0x03;
    const CMD_RUN   = 0x04, CMD_STOP  = 0x05, CMD_ERASE = 0x06;
    const CMD_INFO  = 0x07, CMD_SET_NAME = 0x08;
    const RSP_ACK   = 0xA0, RSP_STATE = 0xA1;

    const CHUNK_SIZE = 60;
    const ACK_TIMEOUT_MS = 3000;
    const MAX_HUB_NAME = 24;

    // --- Logging: browser console + code-Div panel + floating overlay -------
    let overlayEl = null;
    function overlay() {
        if (overlayEl && document.body.contains(overlayEl)) return overlayEl;
        overlayEl = document.createElement('div');
        overlayEl.id = 'bleUploadOverlay';
        overlayEl.style.cssText =
            'position:fixed;bottom:8px;right:8px;max-width:420px;' +
            'max-height:40vh;overflow:auto;z-index:99999;' +
            'background:rgba(30,30,30,0.92);color:#eee;padding:6px 10px;' +
            'border-radius:6px;font:12px/1.4 monospace;box-shadow:0 2px 8px rgba(0,0,0,.4);';
        (document.body || document.documentElement).appendChild(overlayEl);
        return overlayEl;
    }
    function log(msg, kind) {
        const prefix = '[BLE] ';
        if (kind === 'error') console.error(prefix + msg);
        else console.log(prefix + msg);
        const panel = document.querySelector('.console-Div');
        if (panel) {
            const line = document.createElement('div');
            line.textContent = prefix + msg;
            if (kind === 'error') line.style.color = '#c62828';
            else if (kind === 'ok') line.style.color = '#2e7d32';
            else line.style.color = '#555';
            line.style.font = '12px/1.4 monospace';
            panel.appendChild(line);
            panel.scrollTop = panel.scrollHeight;
        }
        const ov = overlay();
        const line2 = document.createElement('div');
        line2.textContent = prefix + msg;
        if (kind === 'error') line2.style.color = '#ff7676';
        else if (kind === 'ok') line2.style.color = '#8bd88b';
        ov.appendChild(line2);
        ov.scrollTop = ov.scrollHeight;
    }

    // --- Persistent session state -------------------------------------------
    // We keep a single Session across button clicks so "Enviar" reuses the
    // GATT link opened by "Conectar".
    const state = {
        device: null,
        session: null,
        connecting: false,
        uploading: false,
        cancelRequested: false,   // set by cancel(); checked at every await point
    };

    // Thrown from inside connect()/uploadProgram() when the user hits Cancel
    // so callers can distinguish deliberate abort from a real BLE failure.
    class CancelledError extends Error {
        constructor() { super('cancelled'); this.name = 'CancelledError'; }
    }

    // Instant-cancel plumbing. Every await in the connect/upload paths races
    // against `cancelPromise`. Calling cancel() rejects that promise, so the
    // caller unblocks in the same microtask tick rather than waiting for the
    // underlying native operation to time out on its own.
    let cancelPromise = null;
    let cancelReject  = null;
    function armCancel() {
        state.cancelRequested = false;
        cancelPromise = new Promise((_, rej) => { cancelReject = rej; });
        cancelPromise.catch(() => {});   // silence "unhandled rejection" when nobody races
    }
    function disarmCancel() {
        state.cancelRequested = false;
        cancelPromise = null;
        cancelReject  = null;
    }
    function raceCancel(op) {
        return cancelPromise ? Promise.race([op, cancelPromise]) : op;
    }
    function sleepCancelable(ms) {
        return raceCancel(new Promise(r => setTimeout(r, ms)));
    }

    // Watchdog for silent disconnects. Two failure modes to cover:
    //  1. gatt.disconnect() called on either side -> gattserverdisconnected
    //     fires reliably, listener in connect() handles cleanup.
    //  2. Peripheral vanishes without a clean LL_TERMINATE_IND (R4 hardware
    //     reset, USB unplug, BLE stack crash). Chromium sometimes keeps
    //     gatt.connected == true here even though the link is dead -- the
    //     .connected flag alone can't be trusted.
    // Countermeasure: active heartbeat. Every 3 s we send CMD_INFO; if the
    // send fails (write error) or the ACK times out, the peripheral is gone
    // and we tear the local session down so the modal / LED reflect reality.
    let watchdogInterval = null;
    let heartbeatInFlight = false;
    async function heartbeatTick() {
        if (heartbeatInFlight) { log('[hb] previous tick still in flight, skipping'); return; }
        if (!state.session)    { log('[hb] no session'); return; }
        if (state.uploading)   { log('[hb] user upload in progress, skipping'); return; }
        heartbeatInFlight = true;
        const t0 = performance.now();
        log('[hb] ping');
        try {
            await state.session.send(CMD_INFO);
            log('[hb] pong in ' + Math.round(performance.now() - t0) + ' ms', 'ok');
        } catch (e) {
            log('BLE link dropped (heartbeat: ' +
                ((e && e.message) || e) + ').', 'error');
            stopWatchdog();
            disconnect();
        } finally {
            heartbeatInFlight = false;
        }
    }
    function startWatchdog() {
        stopWatchdog();
        log('[wd] watchdog armed (3 s interval)');
        watchdogInterval = setInterval(() => {
            if (!state.session) { stopWatchdog(); return; }
            const gatt = state.device && state.device.gatt;
            const connected = !!(gatt && gatt.connected);
            log('[wd] tick, gatt.connected=' + connected);
            if (!connected) {
                log('BLE link dropped (watchdog: gatt.connected=false).', 'error');
                stopWatchdog();
                disconnect();
                return;
            }
            heartbeatTick();
        }, 3000);
    }
    function stopWatchdog() {
        if (watchdogInterval) {
            clearInterval(watchdogInterval);
            watchdogInterval = null;
        }
        heartbeatInFlight = false;
    }

    function cancel() {
        console.log('[BLE] cancel() invoked, connecting=' + state.connecting +
                    ' uploading=' + state.uploading);
        if (!state.connecting && !state.uploading) return;
        state.cancelRequested = true;
        // Reject the shared cancel-promise -- every await currently racing
        // against it will throw CancelledError on the next microtask.
        if (cancelReject) cancelReject(new CancelledError());
        // Tear down the GATT link too so native Chromium calls
        // (getPrimaryService, writeValueWithResponse) unblock instead of
        // sitting on their internal ~15 s timeout. The picker itself is
        // OS-controlled and cannot be dismissed programmatically.
        try {
            if (state.device && state.device.gatt) state.device.gatt.disconnect();
        } catch (e) {}
        updateModal();
    }

    // --- BLE session helper -------------------------------------------------
    class Session {
        constructor(rxChar, txChar) {
            this.rx = rxChar;
            this.tx = txChar;
            this._pending = null;   // { resolve, reject } for the in-flight send
            this._sendChain = null; // serialises overlapping send() calls
            this._onState = null;
            this._notifyBound = ev => this._onNotify(ev);
            txChar.addEventListener('characteristicvaluechanged', this._notifyBound);
        }
        _onNotify(ev) {
            const dv = ev.target.value;
            if (!dv || dv.byteLength === 0) return;
            const tag = dv.getUint8(0);
            if (tag === RSP_ACK && dv.byteLength >= 3) {
                const cmd = dv.getUint8(1), status = dv.getUint8(2);
                if (this._pending) {
                    const p = this._pending; this._pending = null;
                    p.resolve({ cmd, status });
                }
            } else if (tag === RSP_STATE && dv.byteLength >= 7) {
                const st = {
                    running: dv.getUint8(1),
                    pc:      dv.getUint8(2) | (dv.getUint8(3) << 8),
                    err:     dv.getUint8(4),
                    size:    dv.getUint8(5) | (dv.getUint8(6) << 8),
                };
                if (this._onState) this._onState(st);
            }
        }
        // Public entry point. All sends are strictly serialised -- the R4
        // protocol is one cmd at a time and two overlapping sends steal each
        // other's ACKs (this bit us on the watchdog heartbeat colliding with
        // a user upload). Queueing is cheap: each send finishes within its
        // own <= 5 s bound so nothing sits in the chain for long.
        async send(cmd, payload) {
            const prev = this._sendChain || Promise.resolve();
            let release;
            this._sendChain = new Promise(r => release = r);
            try { await prev; } catch (_) { /* swallow: prior send's error is not our problem */ }
            try {
                return await this._sendOne(cmd, payload);
            } finally {
                release();
            }
        }
        async _sendOne(cmd, payload) {
            payload = payload || new Uint8Array(0);
            const frame = new Uint8Array(1 + payload.length);
            frame[0] = cmd;
            frame.set(payload, 1);

            // Set up the ACK slot BEFORE the write so a very fast ACK can't
            // land before the pending is registered.
            let resolveAck, rejectAck;
            const ackPromise = new Promise((res, rej) => { resolveAck = res; rejectAck = rej; });
            const pending = { resolve: resolveAck, reject: rejectAck };
            this._pending = pending;

            // Timers use referential equality on `pending` so they only ever
            // touch their own slot, never a subsequent send's slot.
            const ackTimer = setTimeout(() => {
                if (this._pending === pending) {
                    this._pending = null;
                    rejectAck(new Error('ACK timeout for cmd 0x' + cmd.toString(16)));
                }
            }, ACK_TIMEOUT_MS);

            try {
                const writeTimeout = new Promise((_, rej) =>
                    setTimeout(() => rej(new Error(
                        'BLE write timeout for cmd 0x' + cmd.toString(16) +
                        ' -- is the R4 running the BLE runtime?')), 5000));
                await Promise.race([this.rx.writeValueWithResponse(frame), writeTimeout]);
                return await ackPromise;
            } finally {
                clearTimeout(ackTimer);
                if (this._pending === pending) this._pending = null;
            }
        }
        async uploadProgram(bytes) {
            const size = bytes.length;
            const t0 = performance.now();
            let ack = await raceCancel(this.send(CMD_START, new Uint8Array([size & 0xFF, (size >> 8) & 0xFF])));
            if (ack.status !== 0) throw new Error(fmt(tr('reject'), ack.status));
            for (let off = 0; off < size; off += CHUNK_SIZE) {
                const chunk = bytes.slice(off, Math.min(off + CHUNK_SIZE, size));
                ack = await raceCancel(this.send(CMD_CHUNK, chunk));
                if (ack.status !== 0) {
                    throw new Error(fmt(tr('chunkReject'), off, ack.status));
                }
            }
            ack = await raceCancel(this.send(CMD_END));
            if (ack.status !== 0) throw new Error(fmt(tr('endReject'), ack.status));
            return performance.now() - t0;
        }
        async run() {
            const ack = await this.send(CMD_RUN);
            if (ack.status !== 0) throw new Error(fmt(tr('runReject'), ack.status));
        }
    }

    // --- Connect / Disconnect ------------------------------------------------
    async function connect() {
        console.log('[BLE] connect() invoked, connecting=' + state.connecting +
                    ' session=' + !!state.session);
        if (state.connecting) return;
        if (state.session) return;
        if (!navigator.bluetooth) { log(tr('unsupported'), 'error'); return; }
        state.connecting = true;
        armCancel();
        updateConnectButton();
        updateModal();
        const deviceName = getDeviceName();
        try {
            // If the caller has a concrete name in mind (anything past
            // "MATRIX-"), filter for exact match -- fast path, main.js
            // auto-select fires immediately. Otherwise fall back to a
            // namePrefix scan so the native picker can enumerate every
            // MATRIX-* hub in the room; that's the recovery path when the
            // user forgot the exact hub name after renaming.
            const wantsSpecific = deviceName.length > REQUIRED_PREFIX.length;
            const filters = wantsSpecific
                ? [{ name: deviceName }]
                : [{ namePrefix: REQUIRED_PREFIX }];
            log(fmt(tr('connecting'), wantsSpecific ? deviceName : REQUIRED_PREFIX + '*'));
            state.device = await raceCancel(navigator.bluetooth.requestDevice({
                filters: filters,
                optionalServices: [NUS_SERVICE],
            }));
            state.device.addEventListener('gattserverdisconnected', () => {
                log(tr('disconnected'));
                state.session = null;
                // Preserve state.device only while an active connect() call
                // is in the retry loop -- otherwise the R4 rebooting via USB
                // upload leaves us pinned to a stale BluetoothDevice handle
                // and the next Connect click fails with "Connection Error".
                if (!state.connecting) {
                    state.device = null;
                }
                updateConnectButton();
            });
            // Chromium/Windows Web Bluetooth quirk: gatt.connect() sometimes
            // resolves before the ATT link is really ready and the next
            // getPrimaryService throws "GATT Server is disconnected".
            // Retry with backoff, up to 4 attempts (~2s total).
            // Retry loop for the Chromium/Windows Web Bluetooth quirk where
            // gatt.connect() resolves but the next getPrimaryService throws
            // "GATT Server is disconnected". Just retrying the discovery
            // call rarely recovers -- Chromium's internal state stays broken
            // until the GATT link is torn down and rebuilt. So on failure
            // we force a disconnect and reconnect from scratch. This mirrors
            // what a human does when they cancel + retry manually.
            let server = null;
            let service = null;
            for (let attempt = 0; attempt < 4; attempt++) {
                try {
                    if (!state.device.gatt.connected) {
                        server = await raceCancel(state.device.gatt.connect());
                    } else {
                        server = state.device.gatt;
                    }
                    service = await raceCancel(server.getPrimaryService(NUS_SERVICE));
                    break;
                } catch (e) {
                    if (e instanceof CancelledError) throw e;
                    if (attempt === 3) throw e;
                    log('Retry ' + (attempt + 1) + '/3: ' +
                        ((e && e.message) || e), 'info');
                    // Tear down the GATT link so the next iteration starts
                    // fresh. Wrap in try/catch: if we never opened it, this
                    // is a no-op.
                    try { state.device.gatt.disconnect(); } catch (_) {}
                    await sleepCancelable(400 * (attempt + 1));
                }
            }
            const rx = await raceCancel(service.getCharacteristic(NUS_RX));
            const tx = await raceCancel(service.getCharacteristic(NUS_TX));
            await raceCancel(tx.startNotifications());
            state.session = new Session(rx, tx);
            // Sanity ping: ask the R4 for its current STATE. If we don't get
            // a response within 3s we know the R4 accepted the GATT session
            // but isn't running the runtime protocol -- much better error
            // than letting the first upload chunk hang forever.
            try {
                const gotState = new Promise(resolve => {
                    state.session._onState = () => resolve(true);
                    setTimeout(() => resolve(false), 3000);
                });
                await raceCancel(state.session.send(CMD_INFO));
                const alive = await raceCancel(gotState);
                state.session._onState = null;
                if (!alive) {
                    log('R4 accepted the connection but did not answer the ' +
                        'runtime protocol. Is it running the BLE runtime firmware?',
                        'error');
                    await disconnect();
                    return;
                }
            } catch (e) {
                if (e instanceof CancelledError) throw e;
                log('Sanity ping failed: ' + ((e && e.message) || e), 'error');
                await disconnect();
                return;
            }
            log(tr('connectedMsg'), 'ok');
            startWatchdog();
        } catch (e) {
            if (e instanceof CancelledError) {
                log(tr('cancelled'));
                try { if (state.device && state.device.gatt && state.device.gatt.connected) state.device.gatt.disconnect(); } catch (_) {}
            } else {
                log(fmt(tr('connectFail'), (e && e.message) || String(e)), 'error');
            }
            state.device = null;
            state.session = null;
        } finally {
            state.connecting = false;
            disarmCancel();
            updateConnectButton();
            updateModal();
        }
    }

    async function disconnect() {
        console.log('[BLE] disconnect() invoked, session=' + !!state.session);
        stopWatchdog();
        if (state.device && state.device.gatt && state.device.gatt.connected) {
            try { state.device.gatt.disconnect(); } catch (e) {}
        }
        state.session = null;
        state.device = null;
        log(tr('disconnected'));
        updateConnectButton();
        updateModal();
    }

    // --- Compile helpers ----------------------------------------------------
    function collectAllBlockTypes(workspace) {
        // Return a Set of every block type in the workspace tree.
        const seen = new Set();
        const roots = workspace.getTopBlocks(false);
        function walk(b) {
            if (!b) return;
            seen.add(b.type);
            // getDescendants(false) returns b + all children recursively.
            if (typeof b.getDescendants === 'function') {
                for (const d of b.getDescendants(false)) seen.add(d.type);
            } else {
                for (const inp of (b.inputList || [])) {
                    if (inp.connection && inp.connection.targetBlock()) {
                        walk(inp.connection.targetBlock());
                    }
                }
                if (b.nextConnection && b.nextConnection.targetBlock()) {
                    walk(b.nextConnection.targetBlock());
                }
            }
        }
        roots.forEach(walk);
        return seen;
    }

    // --- Send bytecode over the open session --------------------------------
    async function sendViaBLE() {
        console.log('[BLE] sendViaBLE() invoked, session=' + !!state.session +
                    ' uploading=' + state.uploading);
        if (state.uploading) { log('Upload already in progress.', 'error'); return; }
        if (!window.Blockly || !Blockly.BytecodeVM) {
            log('Blockly.BytecodeVM not loaded.', 'error');
            return;
        }
        const workspace = Blockly.getMainWorkspace
            ? Blockly.getMainWorkspace() : Blockly.mainWorkspace;
        if (!workspace || workspace.getTopBlocks().length === 0) {
            log(tr('emptyWorkspace'), 'error');
            return;
        }

        state.uploading = true;
        armCancel();
        updateModal();
        try {
            log(tr('compiling'));
            let compiled;
            try {
                compiled = Blockly.BytecodeVM.compile(workspace);
            } catch (e) {
                log(fmt(tr('compileFail'), e.message), 'error');
                return;
            }
            const varCount = Object.keys(compiled.variables).length;
            log(fmt(tr('compiledOK'), compiled.bytes.length, varCount), 'ok');

            // Report any block types the generator didn't handle.
            const types = collectAllBlockTypes(workspace);
            const unhandled = [];
            for (const t of types) {
                if (typeof Blockly.BytecodeVM[t] !== 'function') unhandled.push(t);
            }
            if (unhandled.length) {
                log(fmt(tr('unsupportedTypes'), unhandled.join(', ')), 'error');
            }
            if (compiled.warnings.length) {
                log(fmt(tr('unsupportedBlocks'), compiled.warnings.length), 'error');
                compiled.warnings.forEach(w => log('  - ' + w.block + ': ' + w.msg));
            }
            // Payload of 1 byte = HALT only, meaning everything was skipped.
            if (compiled.bytes.length <= 1) {
                log(fmt(tr('trivialPayload'), compiled.bytes.length), 'error');
                return;
            }

            if (!state.session) {
                log(tr('notConnected'), 'error');
                return;
            }

            log(fmt(tr('uploading'), compiled.bytes.length));
            const uploadMs = await state.session.uploadProgram(compiled.bytes);
            const bps = Math.round(compiled.bytes.length / (uploadMs / 1000));
            log(fmt(tr('uploadDone'), Math.round(uploadMs), bps), 'ok');

            log(tr('starting'));
            // Kick the VM. Programs with a control_forever body never HALT,
            // so we must NOT hold state.uploading while waiting for it. Fire
            // the run command, then release the lock; a background listener
            // still surfaces HALT / VM error events as they arrive.
            await raceCancel(state.session.run());
            state.session._onState = (s) => {
                if (s.running === 0) {
                    if (s.err && s.err !== 1 /* HALTED */) {
                        log(fmt(tr('vmError'), s.err, s.pc), 'error');
                    } else {
                        log(tr('halted'), 'ok');
                    }
                    state.session._onState = null;
                }
            };
        } catch (e) {
            if (e instanceof CancelledError) log(tr('cancelled'));
            else log('Unhandled: ' + ((e && e.message) || e), 'error');
        } finally {
            state.uploading = false;
            disarmCancel();
            updateModal();
        }
    }

    // --- BLE control modal --------------------------------------------------
    // A single self-styled modal that hosts the connect / search / cancel /
    // disconnect flow so the user never gets stuck on a retry loop with no
    // way out. Uses a custom lightweight overlay (no bootstrap-js dependency)
    // to stay decoupled from whatever the IDE build ships.
    let modalEl = null;
    function ensureModal() {
        if (modalEl && document.body.contains(modalEl)) return modalEl;
        modalEl = document.createElement('div');
        modalEl.id = 'bleControlModal';
        modalEl.style.cssText =
            'position:fixed;inset:0;display:none;align-items:center;' +
            'justify-content:center;background:rgba(0,0,0,.45);' +
            'z-index:100000;font:14px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;';
        modalEl.innerHTML =
            '<div style="background:#fff;color:#111;border-radius:8px;' +
            'width:420px;max-width:92vw;padding:18px 20px;box-shadow:0 8px 32px rgba(0,0,0,.35);">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
                '<h5 id="bleModalTitle" style="margin:0;font:600 16px/1.2 inherit;">BLE</h5>' +
                '<button id="bleModalClose" type="button" style="background:none;border:0;font-size:20px;cursor:pointer;color:#555;">&times;</button>' +
              '</div>' +
              '<div style="margin-bottom:10px;">' +
                '<label id="bleModalNameLabel" for="bleModalName" style="display:block;font-weight:600;margin-bottom:4px;">Hub name</label>' +
                '<input id="bleModalName" type="text" style="width:100%;padding:6px 8px;border:1px solid #ccc;border-radius:4px;font:inherit;" placeholder="MATRIX-R4-Runtime" />' +
                '<div id="bleModalNameHint" style="font-size:12px;color:#666;margin-top:4px;"></div>' +
              '</div>' +
              '<div id="bleModalStatus" style="margin:12px 0;padding:8px 10px;background:#f4f4f5;border-radius:4px;font-family:monospace;font-size:12px;color:#333;"></div>' +
              '<div id="bleModalRenameBox" style="display:none;margin:12px 0;padding:10px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:4px;">' +
                '<label id="bleModalRenameLabel" for="bleModalRename" style="display:block;font-weight:600;margin-bottom:4px;font-size:13px;">Rename this hub</label>' +
                '<div style="display:flex;gap:6px;">' +
                  '<input id="bleModalRename" type="text" maxlength="24" style="flex:1;padding:6px 8px;border:1px solid #bfdbfe;border-radius:4px;font:inherit;" />' +
                  '<button id="bleModalRenameSave" type="button" style="padding:6px 12px;border:0;background:#059669;color:#fff;border-radius:4px;cursor:pointer;">Save</button>' +
                '</div>' +
                '<div id="bleModalRenameHint" style="font-size:11px;color:#3b82f6;margin-top:4px;"></div>' +
              '</div>' +
              '<div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">' +
                '<button id="bleModalCancel" type="button" style="padding:6px 14px;border:1px solid #dc2626;background:#fff;color:#dc2626;border-radius:4px;cursor:pointer;">Cancel</button>' +
                '<button id="bleModalDisconnect" type="button" style="padding:6px 14px;border:1px solid #64748b;background:#fff;color:#64748b;border-radius:4px;cursor:pointer;">Disconnect</button>' +
                '<button id="bleModalSearch" type="button" style="padding:6px 14px;border:0;background:#2563eb;color:#fff;border-radius:4px;cursor:pointer;">Search</button>' +
              '</div>' +
            '</div>';
        document.body.appendChild(modalEl);

        // Wire once.
        modalEl.addEventListener('click', (ev) => {
            if (ev.target === modalEl) closeModal();   // click backdrop
        });
        document.getElementById('bleModalClose').addEventListener('click', closeModal);
        document.getElementById('bleModalSearch').addEventListener('click', () => {
            const name = document.getElementById('bleModalName').value;
            setDeviceName(name);
            connect();
        });
        document.getElementById('bleModalCancel').addEventListener('click', cancel);
        document.getElementById('bleModalDisconnect').addEventListener('click', () => {
            disconnect();
        });
        document.getElementById('bleModalRenameSave').addEventListener('click', () => {
            const name = document.getElementById('bleModalRename').value;
            renameHub(name);
        });
        return modalEl;
    }

    // Push a new BLE local name to the connected R4 via CMD_SET_NAME. Client-
    // side we also update the stored filter so the next Search picks the
    // renamed hub without the user having to retype it. The rename takes
    // effect on the R4 after a reboot -- ArduinoBLE can't flip the
    // advertised local name mid-run.
    async function renameHub(rawName) {
        const name = normalizeHubName(rawName);
        // normalizeHubName always returns at least "MATRIX-"; require some
        // suffix so we're not asking the R4 to persist the bare prefix.
        if (name === REQUIRED_PREFIX) { log(tr('renameEmpty'), 'error'); return; }
        if (name.length > MAX_HUB_NAME) {
            log(fmt(tr('renameTooLong'), MAX_HUB_NAME), 'error');
            return;
        }
        for (let i = 0; i < name.length; i++) {
            const c = name.charCodeAt(i);
            if (c < 0x20 || c > 0x7E) { log(tr('renameBadChar'), 'error'); return; }
        }
        if (!state.session) { log(tr('notConnected'), 'error'); return; }
        try {
            const bytes = new Uint8Array(name.length);
            for (let i = 0; i < name.length; i++) bytes[i] = name.charCodeAt(i);
            const ack = await state.session.send(CMD_SET_NAME, bytes);
            if (ack.status !== 0) {
                log(fmt(tr('renameFail'), ack.status), 'error');
                return;
            }
            setDeviceName(name);
            log(tr('renameOk'), 'ok');
            updateModal();
        } catch (e) {
            if (e instanceof CancelledError) { log(tr('cancelled')); return; }
            log('Rename error: ' + ((e && e.message) || e), 'error');
        }
    }

    function openModal() {
        const m = ensureModal();
        document.getElementById('bleModalTitle').textContent = tr('modalTitle');
        document.getElementById('bleModalNameLabel').textContent = tr('modalHubName');
        document.getElementById('bleModalNameHint').textContent = tr('modalHubHint');
        document.getElementById('bleModalSearch').textContent = tr('modalSearch');
        document.getElementById('bleModalCancel').textContent = tr('modalCancel');
        document.getElementById('bleModalDisconnect').textContent = tr('disconnect');
        document.getElementById('bleModalClose').title = tr('modalClose');
        document.getElementById('bleModalName').value = getDeviceName();
        document.getElementById('bleModalRenameLabel').textContent = tr('modalRename');
        document.getElementById('bleModalRenameHint').textContent = tr('modalRenameHint');
        document.getElementById('bleModalRenameSave').textContent = tr('modalRenameSave');
        document.getElementById('bleModalRename').value = getDeviceName();
        m.style.display = 'flex';
        updateModal();
    }
    function closeModal() {
        if (modalEl) modalEl.style.display = 'none';
    }
    function updateModal() {
        if (!modalEl || modalEl.style.display === 'none') return;
        const busy = state.connecting || state.uploading;
        const connected = !!state.session;
        const nameField = document.getElementById('bleModalName');
        const search    = document.getElementById('bleModalSearch');
        const cancelBtn = document.getElementById('bleModalCancel');
        const disc      = document.getElementById('bleModalDisconnect');
        const status    = document.getElementById('bleModalStatus');
        const renameBox = document.getElementById('bleModalRenameBox');
        if (nameField)  nameField.disabled = busy || connected;
        if (search)     search.disabled    = busy || connected;
        if (cancelBtn)  cancelBtn.style.display = busy ? '' : 'none';
        if (disc)       disc.style.display     = (connected && !busy) ? '' : 'none';
        if (renameBox)  renameBox.style.display = (connected && !busy) ? '' : 'none';
        if (status) {
            if (busy)       status.textContent = tr('modalStatusBusy');
            else if (connected) status.textContent = fmt(tr('modalStatusConn'), getDeviceName());
            else            status.textContent = tr('modalStatusIdle');
        }
    }

    // --- Toolbar buttons ----------------------------------------------------
    function updateConnectButton() {
        const btn = document.getElementById('bleConnectNavLink');
        if (!btn) return;
        const icon = btn.querySelector('i');
        const span = btn.querySelector('span');
        if (state.connecting) {
            btn.title = tr('connecting');
            if (span) span.innerHTML = '&nbsp;' + tr('connect') + '...';
            if (icon) { icon.className = 'bi bi-bluetooth'; icon.style.color = '#f59e0b'; }
        } else if (state.session) {
            btn.title = tr('disconnectTitle');
            if (span) span.innerHTML = '&nbsp;' + tr('disconnect');
            if (icon) { icon.className = 'bi bi-bluetooth-fill'; icon.style.color = '#22c55e'; }
        } else {
            btn.title = tr('connectTitle');
            if (span) span.innerHTML = '&nbsp;' + tr('connect');
            if (icon) { icon.className = 'bi bi-bluetooth'; icon.style.color = '#94a3b8'; }
        }
    }

    function installButtons() {
        const uploadLink = document.getElementById('uploadNavLink');
        if (!uploadLink) {
            console.log('[BLE] installButtons: no #uploadNavLink yet, will retry');
            return;
        }
        const parent = uploadLink.parentNode;

        // Insertion order (into parent, after uploadLink):
        //   uploadLink -> [connectBtn] -> [sendBtn] -> ...existing...
        if (!document.getElementById('bleConnectNavLink')) {
            console.log('[BLE] installing Connect button');
            const c = document.createElement('a');
            c.className = 'nav-link d-flex align-items-center active';
            c.id = 'bleConnectNavLink';
            c.style.cursor = 'pointer';
            c.innerHTML =
                '<i class="bi bi-bluetooth" style="color:#94a3b8"></i>' +
                '<span id="bleConnectButton">&nbsp;' + tr('connect') + '</span>';
            c.addEventListener('click', (ev) => {
                ev.preventDefault(); ev.stopPropagation();
                openModal();
            });
            parent.insertBefore(c, uploadLink.nextSibling);
            updateConnectButton();
        }

        if (!document.getElementById('bleUploadNavLink')) {
            console.log('[BLE] installing Send button');
            const s = document.createElement('a');
            s.className = 'nav-link d-flex align-items-center active';
            s.id = 'bleUploadNavLink';
            s.title = tr('btnTitle');
            s.style.cursor = 'pointer';
            s.innerHTML =
                '<i class="bi bi-broadcast"></i>' +
                '<span id="bleUploadButton">&nbsp;' + tr('btnLabel') + '</span>';
            s.addEventListener('click', (ev) => {
                ev.preventDefault(); ev.stopPropagation();
                sendViaBLE();
            });
            const connectBtn = document.getElementById('bleConnectNavLink');
            parent.insertBefore(s, connectBtn ? connectBtn.nextSibling : uploadLink.nextSibling);
        }

        // Refresh labels a few times so late locale switches take effect.
        let tries = 0;
        const iv = setInterval(() => {
            updateConnectButton();
            const sbtn = document.getElementById('bleUploadButton');
            if (sbtn) sbtn.innerHTML = '&nbsp;' + tr('btnLabel');
            if (++tries > 10) clearInterval(iv);
        }, 500);
    }

    console.log('[BLE] ble_upload.js module loaded (v3 connect+send)');
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', installButtons);
    } else {
        installButtons();
    }
    setTimeout(installButtons, 1500);
    setTimeout(installButtons, 3000);
    setTimeout(installButtons, 5000);
})();
