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
            connecting:     'Connecting to MATRIX-R4-Runtime...',
            connectedMsg:   'Connected. Session ready.',
            disconnected:   'Disconnected.',
            connectFail:    'Could not connect: %s',
            notConnected:   'Not connected. Click "Connect" first.',
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
            connecting:     'Conectando ao MATRIX-R4-Runtime...',
            connectedMsg:   'Conectado. Sessao pronta.',
            disconnected:   'Desconectado.',
            connectFail:    'Nao foi possivel conectar: %s',
            notConnected:   'Sem conexao. Clique em "Conectar" primeiro.',
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
    const DEVICE_NAME = 'MATRIX-R4-Runtime';

    const CMD_START = 0x01, CMD_CHUNK = 0x02, CMD_END = 0x03;
    const CMD_RUN   = 0x04, CMD_STOP  = 0x05, CMD_ERASE = 0x06, CMD_INFO = 0x07;
    const RSP_ACK   = 0xA0, RSP_STATE = 0xA1;

    const CHUNK_SIZE = 60;
    const ACK_TIMEOUT_MS = 3000;

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
    };

    // --- BLE session helper -------------------------------------------------
    class Session {
        constructor(rxChar, txChar) {
            this.rx = rxChar;
            this.tx = txChar;
            this._pending = null;
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
        async send(cmd, payload) {
            payload = payload || new Uint8Array(0);
            const frame = new Uint8Array(1 + payload.length);
            frame[0] = cmd;
            frame.set(payload, 1);
            const ackPromise = new Promise((resolve, reject) => {
                this._pending = { resolve, reject };
                setTimeout(() => {
                    if (this._pending) {
                        this._pending = null;
                        reject(new Error('ACK timeout for cmd 0x' + cmd.toString(16)));
                    }
                }, ACK_TIMEOUT_MS);
            });
            // Race the write against a hard timeout so a hung BLE stack
            // surfaces an error instead of an indefinite wait.
            const writeTimeout = new Promise((_, reject) =>
                setTimeout(() => reject(new Error(
                    'BLE write timeout for cmd 0x' + cmd.toString(16) +
                    ' -- is the R4 running the BLE runtime?')), 5000));
            await Promise.race([this.rx.writeValueWithResponse(frame), writeTimeout]);
            return ackPromise;
        }
        async uploadProgram(bytes) {
            const size = bytes.length;
            const t0 = performance.now();
            let ack = await this.send(CMD_START, new Uint8Array([size & 0xFF, (size >> 8) & 0xFF]));
            if (ack.status !== 0) throw new Error(fmt(tr('reject'), ack.status));
            for (let off = 0; off < size; off += CHUNK_SIZE) {
                const chunk = bytes.slice(off, Math.min(off + CHUNK_SIZE, size));
                ack = await this.send(CMD_CHUNK, chunk);
                if (ack.status !== 0) {
                    throw new Error(fmt(tr('chunkReject'), off, ack.status));
                }
            }
            ack = await this.send(CMD_END);
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
        updateConnectButton();
        try {
            log(tr('connecting'));
            state.device = await navigator.bluetooth.requestDevice({
                filters: [{ name: DEVICE_NAME }],
                optionalServices: [NUS_SERVICE],
            });
            state.device.addEventListener('gattserverdisconnected', () => {
                log(tr('disconnected'));
                state.session = null;
                state.device = null;
                updateConnectButton();
            });
            const server = await state.device.gatt.connect();
            const service = await server.getPrimaryService(NUS_SERVICE);
            const rx = await service.getCharacteristic(NUS_RX);
            const tx = await service.getCharacteristic(NUS_TX);
            await tx.startNotifications();
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
                await state.session.send(CMD_INFO);
                const alive = await gotState;
                state.session._onState = null;
                if (!alive) {
                    log('R4 accepted the connection but did not answer the ' +
                        'runtime protocol. Is it running the BLE runtime firmware?',
                        'error');
                    await disconnect();
                    return;
                }
            } catch (e) {
                log('Sanity ping failed: ' + ((e && e.message) || e), 'error');
                await disconnect();
                return;
            }
            log(tr('connectedMsg'), 'ok');
        } catch (e) {
            log(fmt(tr('connectFail'), (e && e.message) || String(e)), 'error');
            state.device = null;
            state.session = null;
        } finally {
            state.connecting = false;
            updateConnectButton();
        }
    }

    async function disconnect() {
        console.log('[BLE] disconnect() invoked, session=' + !!state.session);
        if (state.device && state.device.gatt && state.device.gatt.connected) {
            try { state.device.gatt.disconnect(); } catch (e) {}
        }
        state.session = null;
        state.device = null;
        log(tr('disconnected'));
        updateConnectButton();
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
            const haltPromise = new Promise(resolve => {
                state.session._onState = (s) => {
                    if (s.running === 0) {
                        if (s.err && s.err !== 1 /* HALTED */) {
                            log(fmt(tr('vmError'), s.err, s.pc), 'error');
                        } else {
                            log(tr('halted'), 'ok');
                        }
                        resolve();
                    }
                };
            });
            await state.session.run();
            // Poll for STATE while program runs.
            const pollHandle = setInterval(() => {
                if (state.session) {
                    state.session.send(CMD_INFO).catch(() => {});
                }
            }, 500);
            await Promise.race([
                haltPromise,
                new Promise(r => setTimeout(r, 60000)),
            ]);
            clearInterval(pollHandle);
        } catch (e) {
            log('Unhandled: ' + ((e && e.message) || e), 'error');
        } finally {
            state.uploading = false;
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
                if (state.session) disconnect();
                else connect();
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
