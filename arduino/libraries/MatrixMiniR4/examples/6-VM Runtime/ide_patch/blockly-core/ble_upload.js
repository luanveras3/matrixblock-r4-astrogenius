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
            // --- Robot status sidebar (phase 1: connection, battery, VM, IMU) ---
            sbTitle:        'Robot',
            sbSectionConn:  'Connection',
            sbSectionVm:    'Program',
            sbSectionImu:   'Orientation',
            sbHub:          'Hub',
            sbBattery:      'Battery',
            sbVmState:      'State',
            sbVmRunning:    'Running',
            sbVmIdle:       'Idle',
            sbVmError:      'Error %d',
            sbVmSize:       'Program %d B',
            sbVmPc:         'PC %d',
            sbImuRoll:      'Roll',
            sbImuPitch:     'Pitch',
            sbImuYaw:       'Yaw',
            sbButtons:      'Buttons',
            sbBtnDown:      'DOWN',
            sbBtnUp:        'UP',
            sbHide:         'Hide',
            hudTabCode:     'Code',
            hudTabHud:      'HUD',
            hudTabLog:      'Log',
            sbLogEmpty:     'No BLE activity yet. Connect to a hub to start.',
            sbAwaitingConn: 'Waiting for a BLE connection...',
            sbUptime:       'Uptime',
            // --- Sub-tabs + Ports (phase 3a) ---
            sbSubTabState:  'State',
            sbSubTabPorts:  'Ports',
            sbSectionMotors:'Motors',
            sbSectionAnalog:'Analog (A1/A2/A3)',
            sbSectionDigital:'Digital (D1/D2/D3/D4)',
            sbEncoder:      'enc',
            sbSpeed:        'deg/s',
            sbAnalogUnit:   'V',
            sbPortsHint:    'Pick the sensor plugged into each port. Choice is saved per port. \"Raw pins\" always shows the two physical pins (L=left, R=right of the connector).',
            // --- Per-port sensor picker (phase 3b) ---
            sbModeRaw:      'Raw pins',
            sbModeSwitch:   'Switch',
            sbModePir:      'PIR (motion)',
            sbModePot:      'Potentiometer',
            sbModeDht:      'DHT temp/hum',
            sbModeLaser:    'Laser v2 (ToF)',
            sbModeNone:     '--',
            sbSwOpen:       'OPEN',
            sbSwClosed:     'CLOSED',
            sbPirMotion:    'MOTION',
            sbPirIdle:      'idle',
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
            // --- Painel de estado do robo (fase 1) ---
            sbTitle:        'Robo',
            sbSectionConn:  'Conexao',
            sbSectionVm:    'Programa',
            sbSectionImu:   'Orientacao',
            sbHub:          'Hub',
            sbBattery:      'Bateria',
            sbVmState:      'Estado',
            sbVmRunning:    'Rodando',
            sbVmIdle:       'Parado',
            sbVmError:      'Erro %d',
            sbVmSize:       'Programa %d B',
            sbVmPc:         'PC %d',
            sbImuRoll:      'Roll',
            sbImuPitch:     'Pitch',
            sbImuYaw:       'Yaw',
            sbButtons:      'Botoes',
            sbBtnDown:      'DOWN',
            sbBtnUp:        'UP',
            sbHide:         'Esconder',
            hudTabCode:     'Codigo',
            hudTabHud:      'HUD',
            hudTabLog:      'Log',
            sbLogEmpty:     'Nenhuma atividade BLE ainda. Conecte-se a um hub para comecar.',
            sbAwaitingConn: 'Aguardando conexao BLE...',
            sbUptime:       'Tempo ligado',
            sbSubTabState:  'Estado',
            sbSubTabPorts:  'Portas',
            sbSectionMotors:'Motores',
            sbSectionAnalog:'Analogicos (A1/A2/A3)',
            sbSectionDigital:'Digitais (D1/D2/D3/D4)',
            sbEncoder:      'enc',
            sbSpeed:        'graus/s',
            sbAnalogUnit:   'V',
            sbPortsHint:    'Escolha o sensor plugado em cada porta. A escolha fica salva por porta. \"Pinos crus\" mostra sempre os dois pinos fisicos (L=esquerda, R=direita do conector).',
            sbModeRaw:      'Pinos crus',
            sbModeSwitch:   'Chave (switch)',
            sbModePir:      'PIR (movimento)',
            sbModePot:      'Potenciometro',
            sbModeDht:      'DHT temp/umid',
            sbModeLaser:    'Laser v2 (ToF)',
            sbModeNone:     '--',
            sbSwOpen:       'ABERTO',
            sbSwClosed:     'FECHADO',
            sbPirMotion:    'MOVIMENTO',
            sbPirIdle:      'parado',
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
    const CMD_INFO  = 0x07, CMD_SET_NAME = 0x08, CMD_TELEMETRY = 0x09;
    const RSP_ACK   = 0xA0, RSP_STATE = 0xA1, RSP_TELEMETRY = 0xA2;
    const TELEMETRY_INTERVAL_MS = 200;   // 5 Hz sidebar refresh

    const CHUNK_SIZE = 60;
    const ACK_TIMEOUT_MS = 3000;
    const MAX_HUB_NAME = 24;

    // --- Logging: browser console + Log tab pane ----------------------------
    // The floating overlay is gone -- users found it distracting. Logs now go
    // to the browser console (always) and to the "Log" tab inside the right
    // sidebar (opt-in view: only visible when the user clicks the Log tab).
    // We buffer entries so ones emitted before the tab is mounted still show
    // up on first render.
    const LOG_MAX = 500;                // ring buffer cap, oldest dropped
    const logBuffer = [];               // { msg, kind, ts }
    function log(msg, kind) {
        const prefix = '[BLE] ';
        if (kind === 'error') console.error(prefix + msg);
        else console.log(prefix + msg);
        const entry = { msg: prefix + msg, kind: kind, ts: Date.now() };
        logBuffer.push(entry);
        if (logBuffer.length > LOG_MAX) logBuffer.shift();
        appendLogLine(entry);
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

    // --- Robot HUD + Log tabs (phase 1 polished) ----------------------------
    // Injected as a 3-tab bar inside the IDE's right column (.control-Div),
    // sibling to the existing .code-Div. Tabs: Code (default, existing Monaco
    // view), HUD (robot dashboard), Log (BLE activity trace). Both new panes
    // occupy the same 60% slot above .console-Div so there is no floating
    // overlay covering the workspace.
    //
    // Palette + typography mirror #astro-tab-bar in views/main.html: brand
    // teal #008184 with a #006466 border below and white ink at ~75% alpha
    // for inactive tabs, full alpha for the active one.
    let hudMounted = false;
    let codeTab = null, hudTab = null, logTab = null;
    let codeDiv = null, hudDiv = null, logDiv = null;
    let activePane = 'code';               // 'code' | 'hud' | 'log'
    let bleConnected = false;              // gates auto-flip on disconnect
    let telemetryInterval = null;
    let telemetryInFlight = false;

    const BRAND_TEAL      = '#008184';
    const BRAND_TEAL_DARK = '#006466';
    const BRAND_AMBER     = '#ffd166';

    function mountHud() {
        if (hudMounted) return true;
        const controlDiv = document.querySelector('.control-Div');
        codeDiv = document.querySelector('.code-Div');
        if (!controlDiv || !codeDiv) return false;   // IDE not ready yet

        // Tab bar mirrors the .astro-tab-bar idiom from views/main.html but
        // scoped to the right column (smaller footprint).
        const tabBar = document.createElement('div');
        tabBar.id = 'bleHudTabs';
        tabBar.style.cssText =
            'display:flex;align-items:stretch;background:' + BRAND_TEAL + ';' +
            'border-bottom:2px solid ' + BRAND_TEAL_DARK + ';min-height:28px;' +
            'border-top-left-radius:.5em;border-top-right-radius:.5em;' +
            'overflow:hidden;margin-bottom:0;flex-shrink:0;';

        codeTab = mkTab('bleHudTabCode', 'hudTabCode', () => setPane('code'));
        hudTab  = mkTab('bleHudTabHud',  'hudTabHud',  () => setPane('hud'));
        logTab  = mkTab('bleHudTabLog',  'hudTabLog',  () => setPane('log'));
        tabBar.appendChild(codeTab);
        tabBar.appendChild(hudTab);
        tabBar.appendChild(logTab);

        // HUD pane -- content dashboard, matches .code-Div's box shape.
        hudDiv = document.createElement('div');
        hudDiv.id = 'bleHudPane';
        hudDiv.style.cssText = paneBaseStyle() + 'display:none;';
        hudDiv.innerHTML = hudHtml();

        // Log pane -- BLE activity trace, opt-in only.
        logDiv = document.createElement('div');
        logDiv.id = 'bleLogPane';
        logDiv.style.cssText = paneBaseStyle() +
            'font:11px/1.45 Menlo,Consolas,monospace;padding:8px 10px;display:none;';
        logDiv.innerHTML =
            '<div id="bleLogEmpty" style="color:#9b9b9b;font-style:italic;' +
              'font-family:-apple-system,Segoe UI,sans-serif;">' +
              tr('sbLogEmpty') + '</div>' +
            '<div id="bleLogList"></div>';

        // Restyle .code-Div: it lives ABOVE the tab bar in default IDE, but we
        // want it BELOW our tabs. Also lose its top rounded corners so it
        // reads as continuous with the tab bar.
        codeDiv.style.borderTopLeftRadius  = '0';
        codeDiv.style.borderTopRightRadius = '0';

        // Order: tabBar, codeDiv, hudDiv, logDiv, consoleDiv untouched.
        controlDiv.insertBefore(tabBar, codeDiv);
        codeDiv.parentNode.insertBefore(hudDiv, codeDiv.nextSibling);
        codeDiv.parentNode.insertBefore(logDiv, hudDiv.nextSibling);

        // The IDE's default sizing has .code-Div (60%) + .console-Div (40%)
        // filling .control-Div (100%). Adding our tab bar (~30 px) on top
        // used to overflow the parent by that much and push the console's
        // bottom controls off-screen. Steal that height from .code-Div so
        // 30 px tab + calc(60% - 30 px) code + 40% console = 100% again.
        function syncHeight() {
            const barH = tabBar.getBoundingClientRect().height || 30;
            codeDiv.style.height = 'calc(60% - ' + barH + 'px)';
            const h = codeDiv.getBoundingClientRect().height;
            if (h > 0) {
                hudDiv.style.height = h + 'px';
                logDiv.style.height = h + 'px';
            }
        }
        syncHeight();
        window.addEventListener('resize', syncHeight);

        hudMounted = true;
        wireCollapsibles();
        wireSubTabs();
        wirePortModes();           // restore per-port sensor picks (phase 3b)
        setSubTab(loadSubTab());   // restore last sub-tab (state|ports)
        // Backfill any log lines emitted before mount.
        for (let i = 0; i < logBuffer.length; i++) appendLogLine(logBuffer[i]);
        setPane('code');   // start on Code; connect() flips to HUD
        return true;
    }

    function paneBaseStyle() {
        return 'width:100%;height:60%;' +
            'border:1px solid hsla(0,0%,0%,.15);border-top:0;' +
            'border-bottom-left-radius:.5em;border-bottom-right-radius:.5em;' +
            'overflow:auto;padding:14px 16px;box-sizing:border-box;' +
            'background:#fff;font:13px/1.5 -apple-system,Segoe UI,sans-serif;' +
            'color:#222;';
    }

    function mkTab(id, labelKey, onClick) {
        const b = document.createElement('button');
        b.id = id;
        b.dataset.labelKey = labelKey;
        b.style.cssText = tabBaseStyle();
        b.textContent = tr(labelKey);
        b.addEventListener('click', onClick);
        b.addEventListener('mouseenter', () => {
            if (b.dataset.active !== '1') b.style.background = 'rgba(0,0,0,0.15)';
        });
        b.addEventListener('mouseleave', () => {
            if (b.dataset.active !== '1') b.style.background = 'transparent';
        });
        return b;
    }
    function tabBaseStyle() {
        return 'flex:1;background:transparent;border:0;padding:6px 10px;' +
            'font-size:12px;color:rgba(255,255,255,0.75);cursor:pointer;' +
            'font-family:-apple-system,Segoe UI,sans-serif;' +
            'border-right:1px solid rgba(0,0,0,0.2);user-select:none;';
    }
    function paintTab(el, active) {
        if (!el) return;
        el.dataset.active = active ? '1' : '0';
        el.style.color = active ? '#fff' : 'rgba(255,255,255,0.75)';
        el.style.fontWeight = active ? '600' : '400';
        el.style.background = active ? 'rgba(0,0,0,0.25)' : 'transparent';
    }
    function setPane(name) {
        if (!hudMounted) return;
        activePane = name;
        codeDiv.style.display = (name === 'code') ? '' : 'none';
        hudDiv.style.display  = (name === 'hud')  ? 'block' : 'none';
        logDiv.style.display  = (name === 'log')  ? 'block' : 'none';
        paintTab(codeTab, name === 'code');
        paintTab(hudTab,  name === 'hud');
        paintTab(logTab,  name === 'log');
        if (name === 'code') {
            try {
                if (typeof monaco !== 'undefined' && monaco.editor) {
                    const eds = monaco.editor.getEditors();
                    if (eds && eds[0]) eds[0].layout();
                }
            } catch (_) {}
        } else {
            // Sync non-code panes to whatever .code-Div ended up at (its
            // height is now calc(60% - tabBarH) so panes match it exactly).
            const h = codeDiv.getBoundingClientRect().height;
            if (h > 0) {
                hudDiv.style.height = h + 'px';
                logDiv.style.height = h + 'px';
            }
        }
        if (name === 'log') {
            // Snap to newest on open.
            logDiv.scrollTop = logDiv.scrollHeight;
        }
    }

    // Collapsible sections. Each has a chevron header (button) that flips a
    // body's display + saves the collapsed state under localStorage key
    // MATRIX_HUD_COLLAPSED_KEY so the user's preferences survive reloads.
    const MATRIX_HUD_COLLAPSED_KEY = 'matrix-hud-collapsed';
    function loadCollapsed() {
        try {
            const raw = window.localStorage.getItem(MATRIX_HUD_COLLAPSED_KEY);
            return raw ? (JSON.parse(raw) || {}) : {};
        } catch (_) { return {}; }
    }
    function saveCollapsed(map) {
        try { window.localStorage.setItem(MATRIX_HUD_COLLAPSED_KEY, JSON.stringify(map)); }
        catch (_) {}
    }

    function hudHtml() {
        const collapsed = loadCollapsed();
        // A collapsible <section id> with <header> (chevron + i18n label) and
        // <body>. Header is a real <button> so keyboard toggle works.
        const section = (id, labelKey, bodyHtml) => {
            const isColl = !!collapsed[id];
            return (
              '<div class="ble-hud-section" data-section-id="' + id + '" ' +
                'style="margin-bottom:10px;border-bottom:1px solid #eee;padding-bottom:8px;">' +
                '<button type="button" class="ble-hud-section-header" ' +
                  'data-section-id="' + id + '" ' +
                  'style="width:100%;background:transparent;border:0;padding:4px 0;' +
                    'cursor:pointer;display:flex;align-items:center;gap:8px;' +
                    'color:' + BRAND_TEAL + ';font-size:11px;font-weight:700;' +
                    'text-transform:uppercase;letter-spacing:.06em;' +
                    'text-align:left;font-family:inherit;">' +
                  '<span class="ble-hud-chevron" style="display:inline-block;width:10px;' +
                    'transition:transform .15s ease;transform:rotate(' +
                    (isColl ? '-90' : '0') + 'deg);">&#9662;</span>' +
                  '<span data-label-key="' + labelKey + '">' + tr(labelKey) + '</span>' +
                '</button>' +
                '<div class="ble-hud-section-body" ' +
                  'style="padding:4px 0 2px 0;display:' + (isColl ? 'none' : 'block') + ';">' +
                  bodyHtml +
                '</div>' +
              '</div>');
        };
        const row = (labelKey, valueId) =>
            '<div style="display:flex;justify-content:space-between;padding:2px 0;">' +
              '<span data-label-key="' + labelKey + '" style="color:#4a4a4a;">' +
                tr(labelKey) + '</span>' +
              '<span id="' + valueId + '" style="color:#222;font-weight:600;' +
                'font-variant-numeric:tabular-nums;">--</span>' +
            '</div>';
        // 3-col grid for axis triplets (IMU / Accel / Gyro).
        const axisGrid = (cells) =>
            '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">' +
              cells + '</div>';
        const axisCell = (labelKey, valueId) =>
            '<div style="text-align:center;">' +
              '<div data-label-key="' + labelKey + '" style="color:#9b9b9b;' +
                'font-size:10px;text-transform:uppercase;letter-spacing:.05em;">' +
                tr(labelKey) + '</div>' +
              '<div id="' + valueId + '" style="font-weight:700;font-size:16px;' +
                'color:#222;font-variant-numeric:tabular-nums;">--</div>' +
            '</div>';
        // Sub-tab bar for Estado / Portas. Underline-style toggle -- lighter
        // than the top-level Code/HUD/Log tabs so the visual hierarchy stays
        // main-tabs > sub-tabs > sections.
        const subTab = (id, key) =>
            '<button id="' + id + '" type="button" data-label-key="' + key + '" ' +
              'class="ble-hud-subtab" style="flex:1;background:transparent;border:0;' +
              'border-bottom:2px solid transparent;padding:6px 8px;' +
              'font:600 12px/1.2 -apple-system,Segoe UI,sans-serif;' +
              'color:#666;cursor:pointer;letter-spacing:.03em;">' + tr(key) + '</button>';

        // "Ports" sub-pane content: 3 collapsible sections
        const motorCell = (n) =>
            '<div style="text-align:center;">' +
              '<div style="color:#9b9b9b;font-size:10px;text-transform:uppercase;' +
                'letter-spacing:.05em;">M' + n + '</div>' +
              '<div id="sbM' + n + 'Deg" style="font-weight:700;font-size:15px;' +
                'color:#222;font-variant-numeric:tabular-nums;">--</div>' +
              '<div id="sbM' + n + 'Spd" style="color:#9b9b9b;font-size:10px;' +
                'font-variant-numeric:tabular-nums;">--</div>' +
            '</div>';
        // ---- Analog sub-cells (kept ids "sbA<pin>Raw/Volt" so fill loop is unchanged) ----
        const analogCell = (arduinoPin, sideLabel) =>
            '<div style="text-align:center;">' +
              '<div style="color:#9b9b9b;font-size:9px;text-transform:uppercase;' +
                'letter-spacing:.05em;">' + sideLabel + ' <span style="opacity:.6;">A' + arduinoPin + '</span></div>' +
              '<div id="sbA' + arduinoPin + 'Raw" style="font-weight:700;font-size:14px;' +
                'color:#222;font-variant-numeric:tabular-nums;">--</div>' +
              '<div id="sbA' + arduinoPin + 'Volt" style="color:#9b9b9b;font-size:10px;' +
                'font-variant-numeric:tabular-nums;">--</div>' +
            '</div>';
        // ---- Digital chip (id "sbD<pin>") ----
        const digitalChip = (arduinoPin, sideLabel) =>
            '<div style="text-align:center;">' +
              '<div style="color:#9b9b9b;font-size:9px;text-transform:uppercase;' +
                'letter-spacing:.05em;margin-bottom:2px;">' + sideLabel + ' <span style="opacity:.6;">p' + arduinoPin + '</span></div>' +
              '<div id="sbD' + arduinoPin + '" style="text-align:center;padding:4px 0;' +
                'border-radius:4px;background:#f1f1f1;color:#9b9b9b;' +
                'font-size:10px;font-weight:700;letter-spacing:.04em;">--</div>' +
            '</div>';

        // ---- Per-port sensor picker (phase 3b) ------------------------------
        // Each port card has:
        //   - header with port name + <select> that picks the sensor mode
        //   - one <div class="port-body port-body-<mode>"> per supported mode
        //     (only the selected one is visible; others get display:none)
        // The pin ids inside "raw" body stay the same, so the existing fill
        // loop keeps writing values regardless of which mode is showing.
        // Selection persists per port in localStorage.
        const modeOpt = (mode) =>
            '<option value="' + mode + '" data-label-key="sbMode' +
              mode.charAt(0).toUpperCase() + mode.slice(1) + '">' +
              tr('sbMode' + mode.charAt(0).toUpperCase() + mode.slice(1)) +
            '</option>';
        // Small L/R toggle to pick which physical pin of the connector is the
        // sensor signal. MATRIX modules don't follow a uniform convention
        // (switch=R, pot=L, PIR varies), so we let the user flip per port.
        // Hidden for "raw" mode (raw always shows both pins).
        const sideToggle = (portName) =>
            '<div class="port-side-toggle" data-port="' + portName + '" ' +
              'style="display:inline-flex;border:1px solid #ddd;border-radius:3px;' +
              'overflow:hidden;font-size:10px;font-weight:700;">' +
              '<button type="button" class="port-side-btn" data-port="' + portName + '" ' +
                'data-side="L" style="border:0;padding:1px 6px;background:#fff;' +
                'color:#555;cursor:pointer;">L</button>' +
              '<button type="button" class="port-side-btn" data-port="' + portName + '" ' +
                'data-side="R" style="border:0;padding:1px 6px;background:#fff;' +
                'color:#555;cursor:pointer;border-left:1px solid #ddd;">R</button>' +
            '</div>';
        const portHeader = (portName, modes) =>
            '<div style="display:flex;align-items:center;justify-content:space-between;' +
              'gap:4px;margin-bottom:6px;">' +
              '<span style="color:#555;font-size:11px;font-weight:700;' +
                'letter-spacing:.06em;">' + portName + '</span>' +
              '<div style="display:flex;align-items:center;gap:4px;">' +
                sideToggle(portName) +
                '<select class="port-mode-sel" data-port="' + portName + '" ' +
                  'style="font:11px -apple-system,Segoe UI,sans-serif;' +
                  'border:1px solid #ddd;border-radius:3px;padding:1px 2px;' +
                  'background:#fff;color:#555;cursor:pointer;max-width:90px;">' +
                  modes.map(modeOpt).join('') +
                '</select>' +
              '</div>' +
            '</div>';
        const rawDigitalBody = (portName, leftPin, rightPin) =>
            '<div id="sbBody-' + portName + '-raw" class="port-body">' +
              '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">' +
                digitalChip(leftPin, 'L') + digitalChip(rightPin, 'R') +
              '</div>' +
            '</div>';
        // Big single-value body for switch/PIR. "sbSensor-<port>" is the label,
        // "sbSensorHint-<port>" is a smaller line saying which physical pin
        // triggered so students can debug wiring without leaving the mode.
        const sensorBody = (portName, mode) =>
            '<div id="sbBody-' + portName + '-' + mode + '" class="port-body" style="display:none;">' +
              '<div id="sbSensor-' + portName + '-' + mode + '" ' +
                'style="text-align:center;padding:10px 0;border-radius:4px;' +
                'background:#f1f1f1;color:#9b9b9b;font-size:13px;font-weight:800;' +
                'letter-spacing:.06em;">--</div>' +
              '<div id="sbSensorHint-' + portName + '-' + mode + '" ' +
                'style="text-align:center;color:#9b9b9b;font-size:9px;' +
                'margin-top:3px;font-variant-numeric:tabular-nums;">&nbsp;</div>' +
            '</div>';
        const digitalPortCard = (portName, leftPin, rightPin) =>
            '<div style="border:1px solid #eee;border-radius:6px;padding:6px;background:#fafafa;">' +
              portHeader(portName, ['raw', 'switch', 'pir']) +
              rawDigitalBody(portName, leftPin, rightPin) +
              sensorBody(portName, 'switch') +
              sensorBody(portName, 'pir') +
            '</div>';
        const rawAnalogBody = (portName, leftPin, rightPin) =>
            '<div id="sbBody-' + portName + '-raw" class="port-body">' +
              '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">' +
                analogCell(leftPin, 'L') + analogCell(rightPin, 'R') +
              '</div>' +
            '</div>';
        // Pot body: percentage bar + raw + volts. Uses whichever pin (L or R)
        // is actively moving; falls back to L if both idle. The picked pin id
        // is written to sbPotPin-<port> for wiring debug.
        const potBody = (portName) =>
            '<div id="sbBody-' + portName + '-pot" class="port-body" style="display:none;">' +
              '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:6px;">' +
                '<span id="sbPotPct-' + portName + '" style="font-weight:800;' +
                  'font-size:18px;color:#222;font-variant-numeric:tabular-nums;">--%</span>' +
                '<span id="sbPotDet-' + portName + '" style="color:#9b9b9b;font-size:10px;' +
                  'font-variant-numeric:tabular-nums;">--</span>' +
              '</div>' +
              '<div style="height:6px;background:#f1f1f1;border-radius:3px;margin-top:4px;overflow:hidden;">' +
                '<div id="sbPotBar-' + portName + '" style="height:100%;width:0%;' +
                  'background:' + BRAND_TEAL + ';transition:width .15s;"></div>' +
              '</div>' +
            '</div>';
        const analogPortCard = (portName, leftPin, rightPin) =>
            '<div style="border:1px solid #eee;border-radius:6px;padding:6px;background:#fafafa;">' +
              portHeader(portName, ['raw', 'pot']) +
              rawAnalogBody(portName, leftPin, rightPin) +
              potBody(portName) +
            '</div>';
        const portsPane =
            section('sbSecMotors', 'sbSectionMotors',
                '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">' +
                  motorCell(1) + motorCell(2) + motorCell(3) + motorCell(4) +
                '</div>') +
            section('sbSecAnalog', 'sbSectionAnalog',
                '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;">' +
                  analogPortCard('A1', 1, 0) +
                  analogPortCard('A2', 3, 2) +
                  analogPortCard('A3', 4, 5) +
                '</div>') +
            section('sbSecDigital', 'sbSectionDigital',
                '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px;">' +
                  digitalPortCard('D1', 3, 2)  +
                  digitalPortCard('D2', 5, 4)  +
                  digitalPortCard('D3', 12, 11) +
                  digitalPortCard('D4', 13, 10) +
                '</div>' +
                '<div data-label-key="sbPortsHint" style="color:#9b9b9b;' +
                  'font-size:10px;font-style:italic;margin-top:8px;">' +
                  tr('sbPortsHint') + '</div>');

        // "Estado" sub-pane = the original phase 1/2 sections.
        const statePane =
            section('sbSecConn', 'sbSectionConn',
                row('sbHub',     'sbHub') +
                row('sbBattery', 'sbBatt') +
                '<div style="height:6px;background:#f1f1f1;border-radius:3px;' +
                  'margin:4px 0 4px 0;overflow:hidden;">' +
                  '<div id="sbBattBar" style="height:100%;width:0%;background:' +
                    BRAND_TEAL + ';transition:width .3s,background .3s;"></div>' +
                '</div>' +
                row('sbUptime',  'sbUptime')) +
            section('sbSecVm',   'sbSectionVm',
                row('sbVmState', 'sbVmState') +
                '<div id="sbVmDetail" style="color:#9b9b9b;font-size:11px;margin-top:2px;"></div>') +
            section('sbSecImu',  'sbSectionImu',
                axisGrid(
                    axisCell('sbImuRoll',  'sbImuRollVal') +
                    axisCell('sbImuPitch', 'sbImuPitchVal') +
                    axisCell('sbImuYaw',   'sbImuYawVal'))) +
            section('sbSecBtn',  'sbButtons',
                '<div>' +
                  '<span id="sbBtnDown" style="display:inline-block;padding:3px 10px;' +
                    'margin-right:6px;border-radius:4px;background:#f1f1f1;color:#9b9b9b;' +
                    'font-size:11px;font-weight:600;letter-spacing:.05em;">DOWN</span>' +
                  '<span id="sbBtnUp"   style="display:inline-block;padding:3px 10px;' +
                    'border-radius:4px;background:#f1f1f1;color:#9b9b9b;' +
                    'font-size:11px;font-weight:600;letter-spacing:.05em;">UP</span>' +
                '</div>');

        return (
            '<div id="bleHudAwaiting" style="display:none;color:#9b9b9b;' +
              'font-style:italic;padding:6px 0 10px 0;" data-label-key="sbAwaitingConn">' +
              tr('sbAwaitingConn') + '</div>' +
            '<div id="bleHudSubTabs" style="display:flex;gap:0;margin-bottom:10px;' +
              'border-bottom:1px solid #eee;">' +
              subTab('bleHudSubTabState', 'sbSubTabState') +
              subTab('bleHudSubTabPorts', 'sbSubTabPorts') +
            '</div>' +
            '<div id="bleHudSubPaneState">' + statePane + '</div>' +
            '<div id="bleHudSubPanePorts" style="display:none;">' + portsPane + '</div>'
        );
    }

    // Sub-tab state (persists across sessions). Default: 'state'.
    const MATRIX_HUD_SUBTAB_KEY = 'matrix-hud-subtab';
    function loadSubTab() {
        try {
            const v = window.localStorage.getItem(MATRIX_HUD_SUBTAB_KEY);
            return (v === 'ports') ? 'ports' : 'state';
        } catch (_) { return 'state'; }
    }
    function saveSubTab(name) {
        try { window.localStorage.setItem(MATRIX_HUD_SUBTAB_KEY, name); } catch (_) {}
    }
    function setSubTab(name) {
        if (!hudDiv) return;
        const stateBtn = hudDiv.querySelector('#bleHudSubTabState');
        const portsBtn = hudDiv.querySelector('#bleHudSubTabPorts');
        const statePane = hudDiv.querySelector('#bleHudSubPaneState');
        const portsPane = hudDiv.querySelector('#bleHudSubPanePorts');
        if (!stateBtn || !portsBtn) return;
        const isPorts = (name === 'ports');
        statePane.style.display = isPorts ? 'none' : '';
        portsPane.style.display = isPorts ? '' : 'none';
        const active = 'color:' + BRAND_TEAL + ';border-bottom-color:' + BRAND_TEAL + ';';
        const idle   = 'color:#666;border-bottom-color:transparent;';
        stateBtn.style.cssText = stateBtn.style.cssText
            .replace(/color:[^;]+;/g, '').replace(/border-bottom-color:[^;]+;/g, '') +
            (isPorts ? idle : active);
        portsBtn.style.cssText = portsBtn.style.cssText
            .replace(/color:[^;]+;/g, '').replace(/border-bottom-color:[^;]+;/g, '') +
            (isPorts ? active : idle);
        saveSubTab(name);
    }
    function wireSubTabs() {
        if (!hudDiv) return;
        hudDiv.addEventListener('click', (ev) => {
            const b = ev.target.closest('#bleHudSubTabState, #bleHudSubTabPorts');
            if (!b) return;
            setSubTab(b.id === 'bleHudSubTabPorts' ? 'ports' : 'state');
        });
    }

    // ---- Per-port sensor picker persistence (phase 3b) ---------------------
    // Maps a MATRIX port (D1..D4, A1..A3) to the user's picked sensor mode.
    // Stored in localStorage as 'matrix-hud-port-<name>'. Default 'raw'.
    // PORT_PINS gives the physical Arduino-pin pair per port ({left, right})
    // so sensor renderers can index into t.analog/t.digitalBits without
    // re-deriving the pinout mapping.
    const PORT_KEY_PREFIX = 'matrix-hud-port-';
    const PORT_SIDE_KEY_PREFIX = 'matrix-hud-port-side-';
    const PORT_PINS = {
        'D1': [3, 2],   'D2': [5, 4],   'D3': [12, 11], 'D4': [13, 10],
        'A1': [1, 0],   'A2': [3, 2],   'A3': [4, 5],
    };
    // MATRIX modules don't share a uniform signal-pin side (confirmed on
    // hardware: switch=R, pot=L, PIR varies by module). Default per sensor;
    // user can flip with the L/R toggle in the port header.
    const DEFAULT_SIDE_BY_MODE = {
        raw:    'R',
        switch: 'R',
        pir:    'L',
        pot:    'L',
        dht:    'R',
        laser:  'R',
    };
    // Modes where the L/R toggle should be visible (raw shows both pins so
    // the toggle would be meaningless there).
    const SIDED_MODES = { switch: 1, pir: 1, pot: 1 };
    function loadPortMode(portName) {
        try {
            const v = window.localStorage.getItem(PORT_KEY_PREFIX + portName);
            return v || 'raw';
        } catch (_) { return 'raw'; }
    }
    function savePortMode(portName, mode) {
        try {
            window.localStorage.setItem(PORT_KEY_PREFIX + portName, mode);
        } catch (_) {}
    }
    function loadPortSide(portName, mode) {
        try {
            const v = window.localStorage.getItem(PORT_SIDE_KEY_PREFIX + portName + '-' + mode);
            if (v === 'L' || v === 'R') return v;
        } catch (_) {}
        return DEFAULT_SIDE_BY_MODE[mode] || 'R';
    }
    function savePortSide(portName, mode, side) {
        try {
            window.localStorage.setItem(PORT_SIDE_KEY_PREFIX + portName + '-' + mode, side);
        } catch (_) {}
    }
    // Repaint the L/R toggle for a port: highlight the active side, hide
    // entirely if the current mode has no side concept (raw).
    function refreshSideToggle(portName) {
        if (!hudDiv) return;
        const container = hudDiv.querySelector(
            '.port-side-toggle[data-port="' + portName + '"]');
        if (!container) return;
        const mode = loadPortMode(portName);
        if (!SIDED_MODES[mode]) {
            container.style.display = 'none';
            return;
        }
        container.style.display = '';
        const side = loadPortSide(portName, mode);
        const btns = container.querySelectorAll('button.port-side-btn');
        for (let i = 0; i < btns.length; i++) {
            const isActive = btns[i].dataset.side === side;
            btns[i].style.background = isActive ? BRAND_TEAL : '#fff';
            btns[i].style.color      = isActive ? '#fff'     : '#555';
        }
    }
    // Toggle which mode body is visible for this port. Called on mount to
    // apply persisted picks and again on every <select> change.
    function applyPortMode(portName, mode) {
        if (!hudDiv) return;
        const bodies = hudDiv.querySelectorAll(
            '[id^="sbBody-' + portName + '-"]');
        for (let i = 0; i < bodies.length; i++) {
            const b = bodies[i];
            const bMode = b.id.substring(('sbBody-' + portName + '-').length);
            b.style.display = (bMode === mode) ? '' : 'none';
        }
    }
    function wirePortModes() {
        if (!hudDiv) return;
        // Restore each picker + L/R toggle to their saved values.
        const sels = hudDiv.querySelectorAll('select.port-mode-sel');
        for (let i = 0; i < sels.length; i++) {
            const sel = sels[i];
            const portName = sel.dataset.port;
            const saved = loadPortMode(portName);
            for (let j = 0; j < sel.options.length; j++) {
                if (sel.options[j].value === saved) { sel.selectedIndex = j; break; }
            }
            applyPortMode(portName, sel.value);
            refreshSideToggle(portName);
        }
        hudDiv.addEventListener('change', (ev) => {
            const sel = ev.target.closest('select.port-mode-sel');
            if (!sel) return;
            const portName = sel.dataset.port;
            const mode = sel.value;
            savePortMode(portName, mode);
            applyPortMode(portName, mode);
            refreshSideToggle(portName);
        });
        hudDiv.addEventListener('click', (ev) => {
            const btn = ev.target.closest('button.port-side-btn');
            if (!btn) return;
            const portName = btn.dataset.port;
            const mode = loadPortMode(portName);
            if (!SIDED_MODES[mode]) return;
            savePortSide(portName, mode, btn.dataset.side);
            refreshSideToggle(portName);
        });
    }

    // Attach one delegated click handler once the HUD is mounted. Cheaper
    // than one listener per section and it survives future reflows if we
    // ever re-render hudHtml() (e.g. locale-change refactor).
    function wireCollapsibles() {
        if (!hudDiv) return;
        hudDiv.addEventListener('click', (ev) => {
            const hdr = ev.target.closest('.ble-hud-section-header');
            if (!hdr) return;
            const id = hdr.dataset.sectionId;
            const section = hudDiv.querySelector(
                '.ble-hud-section[data-section-id="' + id + '"]');
            if (!section) return;
            const body = section.querySelector('.ble-hud-section-body');
            const chev = hdr.querySelector('.ble-hud-chevron');
            const map = loadCollapsed();
            const isColl = body.style.display === 'none';
            if (isColl) {
                body.style.display = 'block';
                chev.style.transform = 'rotate(0deg)';
                delete map[id];
            } else {
                body.style.display = 'none';
                chev.style.transform = 'rotate(-90deg)';
                map[id] = true;
            }
            saveCollapsed(map);
        });
    }

    function appendLogLine(entry) {
        if (!hudMounted || !logDiv) return;
        const empty = logDiv.querySelector('#bleLogEmpty');
        if (empty) empty.style.display = 'none';
        const list = logDiv.querySelector('#bleLogList');
        if (!list) return;
        const line = document.createElement('div');
        line.textContent = entry.msg;
        line.style.cssText = 'padding:1px 0;white-space:pre-wrap;word-break:break-word;' +
            (entry.kind === 'error' ? 'color:#c62828;'
             : entry.kind === 'ok' ? 'color:' + BRAND_TEAL + ';'
             : 'color:#4a4a4a;');
        list.appendChild(line);
        // Cap DOM to LOG_MAX lines (older ones drop as the ring buffer wraps).
        while (list.childElementCount > LOG_MAX) list.removeChild(list.firstChild);
        if (activePane === 'log') logDiv.scrollTop = logDiv.scrollHeight;
    }

    // Format a duration in whole seconds as "1h 23m 45s" (drops leading
    // zero units so short runs stay compact: "42s", "3m 12s").
    function fmtUptime(s) {
        s = Math.max(0, s | 0);
        const h = Math.floor(s / 3600); s -= h * 3600;
        const m = Math.floor(s / 60);   s -= m * 60;
        if (h > 0) return h + 'h ' + m + 'm ' + s + 's';
        if (m > 0) return m + 'm ' + s + 's';
        return s + 's';
    }

    function updateHud(t) {
        if (!hudMounted || !hudDiv) return;
        const $ = id => hudDiv.querySelector('#' + id);

        // --- Connection ---
        const volts = (t.battMv / 100).toFixed(2);
        const battEl = $('sbBatt');
        battEl.textContent = volts + ' V';
        const battColor = (t.battMv < 1100) ? '#c62828'
                        : (t.battMv < 1150) ? '#ef6c00' : BRAND_TEAL;
        battEl.style.color = battColor;
        // Battery bar: map 10.0V..13.0V (typical Li-ion 3S span) to 0..100%.
        // Clamp for edge cases so the bar never overflows the track.
        const pct = Math.max(0, Math.min(100,
            ((t.battMv - 1000) / (1300 - 1000)) * 100));
        const bar = $('sbBattBar');
        if (bar) {
            bar.style.width = pct.toFixed(1) + '%';
            bar.style.background = battColor;
        }
        const upEl = $('sbUptime');
        if (upEl) upEl.textContent = (t.upSecs != null) ? fmtUptime(t.upSecs) : '--';

        // --- Program (VM) ---
        const stateEl = $('sbVmState');
        if (t.err) {
            stateEl.textContent = tr('sbVmError').replace('%d', t.err);
            stateEl.style.color = '#c62828';
        } else if (t.running) {
            stateEl.textContent = tr('sbVmRunning');
            stateEl.style.color = BRAND_TEAL;
        } else {
            stateEl.textContent = tr('sbVmIdle');
            stateEl.style.color = '#4a4a4a';
        }
        const detail = [];
        if (t.size) detail.push(tr('sbVmSize').replace('%d', t.size));
        if (t.running) detail.push(tr('sbVmPc').replace('%d', t.pc));
        $('sbVmDetail').textContent = detail.join(' - ');

        // --- IMU (Euler) ---
        $('sbImuRollVal').textContent  = t.roll.toFixed(1);
        $('sbImuPitchVal').textContent = t.pitch.toFixed(1);
        $('sbImuYawVal').textContent   = t.yaw.toFixed(1);

        // --- Buttons ---
        const dEl = $('sbBtnDown'), uEl = $('sbBtnUp');
        const on  = 'background:' + BRAND_AMBER + ';color:#333;';
        const off = 'background:#f1f1f1;color:#9b9b9b;';
        dEl.style.cssText = 'display:inline-block;padding:3px 10px;margin-right:6px;' +
            'border-radius:4px;font-size:11px;font-weight:600;letter-spacing:.05em;' +
            ((t.btns & 1) ? on : off);
        uEl.style.cssText = 'display:inline-block;padding:3px 10px;' +
            'border-radius:4px;font-size:11px;font-weight:600;letter-spacing:.05em;' +
            ((t.btns & 2) ? on : off);

        // --- Ports sub-pane (motors + analog + digital) ---
        if (t.motorDeg) {
            const now = performance.now();
            const dt  = (lastMotorTs > 0) ? (now - lastMotorTs) / 1000 : 0;
            for (let i = 0; i < 4; i++) {
                $('sbM' + (i + 1) + 'Deg').textContent = t.motorDeg[i] + '°';
                if (dt > 0 && lastMotorDeg[i] != null) {
                    const spd = (t.motorDeg[i] - lastMotorDeg[i]) / dt;
                    $('sbM' + (i + 1) + 'Spd').textContent =
                        spd.toFixed(0) + ' ' + tr('sbSpeed');
                } else {
                    $('sbM' + (i + 1) + 'Spd').textContent = '';
                }
                lastMotorDeg[i] = t.motorDeg[i];
            }
            lastMotorTs = now;
        }
        if (t.analog) {
            for (let i = 0; i < 6; i++) {
                $('sbA' + i + 'Raw').textContent  = t.analog[i];
                // Arduino ADC ref is 5V (default) -> raw/1023 * 5.0.
                const v = (t.analog[i] / 1023 * 5.0).toFixed(2);
                $('sbA' + i + 'Volt').textContent = v + ' ' + tr('sbAnalogUnit');
            }
        }
        if (t.digitalBits != null) {
            const highStyle = 'text-align:center;padding:4px 0;border-radius:4px;' +
                'background:' + BRAND_AMBER + ';color:#333;' +
                'font-size:10px;font-weight:700;letter-spacing:.04em;';
            const lowStyle  = 'text-align:center;padding:4px 0;border-radius:4px;' +
                'background:#f1f1f1;color:#9b9b9b;' +
                'font-size:10px;font-weight:700;letter-spacing:.04em;';
            const pins = [2, 3, 4, 5, 10, 11, 12, 13];
            for (let i = 0; i < pins.length; i++) {
                const p = pins[i];
                const el = $('sbD' + p);
                if (el) el.style.cssText = ((t.digitalBits >> p) & 1) ? highStyle : lowStyle;
            }
        }

        // --- Phase 3b: derived sensor readouts per port picker ---------------
        // For each port whose mode is switch/pir/pot, fill the sensor body
        // with a friendlier readout. Auto-detect which physical pin (L or R)
        // is the "active" one so the user does not need to know the pinout.
        // Digital: for switch/PIR we look at both pins and pick whichever is
        // driven away from the pull-up idle. Analog: for pot we pick whichever
        // side is not clamped at 0 or 1023.
        const dports = ['D1','D2','D3','D4'];
        if (t.digitalBits != null) {
            for (let i = 0; i < dports.length; i++) {
                const name = dports[i];
                const mode = loadPortMode(name);
                if (mode !== 'switch' && mode !== 'pir') continue;
                const [lPin, rPin] = PORT_PINS[name];
                const lHigh = ((t.digitalBits >> lPin) & 1) === 1;
                const rHigh = ((t.digitalBits >> rPin) & 1) === 1;
                fillDigitalSensor(name, mode, lPin, rPin, lHigh, rHigh);
            }
        }
        const aports = ['A1','A2','A3'];
        if (t.analog) {
            for (let i = 0; i < aports.length; i++) {
                const name = aports[i];
                const mode = loadPortMode(name);
                if (mode !== 'pot') continue;
                const [lPin, rPin] = PORT_PINS[name];
                fillPot(name, lPin, rPin, t.analog[lPin], t.analog[rPin]);
            }
        }

    }

    // Render a digital sensor readout (switch or PIR) into the port's sensor
    // body. For switch: LOW pin (grounded through the closed contact) = CLOSED;
    // for PIR: HIGH pin (sensor active-high output) = MOTION. If both pins
    // agree with the "idle" default, we still show idle instead of assuming a
    // side. Hint line names the physical pin so students can debug wiring.
    function fillDigitalSensor(portName, mode, lPin, rPin, lHigh, rHigh) {
        const $ = id => hudDiv.querySelector('#' + id);
        const valEl  = $('sbSensor-' + portName + '-' + mode);
        const hintEl = $('sbSensorHint-' + portName + '-' + mode);
        if (!valEl) return;
        // MATRIX modules split which physical pin carries the signal (switch
        // uses R, pot uses L, PIR varies). We honour the per-port L/R toggle
        // instead of auto-detecting -- our INPUT_PULLUP forces the unused pin
        // HIGH, so any live-value heuristic misidentifies the sensor pin
        // (early version: PIR always showed MOTION via the L pull-up).
        // Switch: active-LOW (contact grounds the pin).
        // PIR:    active-HIGH (comparator drives HIGH on motion).
        const side = loadPortSide(portName, mode);
        const pin      = (side === 'L') ? lPin  : rPin;
        const pinHigh  = (side === 'L') ? lHigh : rHigh;
        const active = (mode === 'switch') ? !pinHigh : pinHigh;
        const onColor  = (mode === 'switch') ? BRAND_AMBER : BRAND_TEAL;
        valEl.style.background = active ? onColor : '#f1f1f1';
        valEl.style.color      = active ? '#333'   : '#9b9b9b';
        valEl.textContent = active
            ? tr(mode === 'switch' ? 'sbSwClosed' : 'sbPirMotion')
            : tr(mode === 'switch' ? 'sbSwOpen'   : 'sbPirIdle');
        hintEl.textContent = 'pino ' + side + ' (p' + pin + ')';
    }

    // Render a potentiometer readout. Uses the user-picked side (default L
    // per hardware testing on MATRIX pot module -- the R pin picks up
    // EMI-coupled noise that masks the real swing and caps 100% at ~78%).
    function fillPot(portName, lPin, rPin, lRaw, rRaw) {
        const $ = id => hudDiv.querySelector('#' + id);
        const pctEl = $('sbPotPct-' + portName);
        const detEl = $('sbPotDet-' + portName);
        const barEl = $('sbPotBar-' + portName);
        if (!pctEl) return;
        const side  = loadPortSide(portName, 'pot');
        const pin   = (side === 'L') ? lPin : rPin;
        const raw   = (side === 'L') ? lRaw : rRaw;
        const pct   = Math.max(0, Math.min(100, (raw / 1023) * 100));
        const volts = (raw / 1023 * 5.0).toFixed(2);
        pctEl.textContent = pct.toFixed(0) + '%';
        detEl.textContent = raw + ' / ' + volts + ' V @ pino ' + side + ' (A' + pin + ')';
        if (barEl) barEl.style.width = pct.toFixed(1) + '%';
    }

    // Motor speed derivation state (client-side; server ships absolute deg).
    let lastMotorDeg = [null, null, null, null];
    let lastMotorTs  = 0;
    function setHudHub(hubName) {
        if (!hudMounted) return;
        const el = hudDiv.querySelector('#sbHub');
        if (el) el.textContent = hubName || '--';
    }
    function setHudAwaiting(waiting) {
        if (!hudMounted) return;
        const el = hudDiv.querySelector('#bleHudAwaiting');
        if (el) el.style.display = waiting ? 'block' : 'none';
    }
    async function telemetryTick() {
        if (telemetryInFlight) return;
        if (!state.session) { stopTelemetryPoll(); return; }
        if (state.uploading || state.connecting) return;
        // Bandwidth optimization: if the user isn't looking at the HUD, don't
        // even ask the R4 for telemetry. Zero radio traffic + zero I2C reads
        // on the hub side. Poll resumes on the next 200 ms tick when the
        // user flips back to the HUD tab.
        if (activePane !== 'hud') return;
        telemetryInFlight = true;
        try {
            await state.session.send(CMD_TELEMETRY);
        } catch (e) {
            // Silent: the 3 s watchdog is the source of truth for link health.
        } finally {
            telemetryInFlight = false;
        }
    }
    function startTelemetryPoll(hubName) {
        stopTelemetryPoll();
        if (!mountHud()) return;
        bleConnected = true;
        setHudHub(hubName);
        setHudAwaiting(false);
        setPane('hud');
        if (state.session) {
            state.session._onTelemetry = updateHud;
        }
        telemetryInterval = setInterval(telemetryTick, TELEMETRY_INTERVAL_MS);
    }
    function stopTelemetryPoll() {
        if (telemetryInterval) {
            clearInterval(telemetryInterval);
            telemetryInterval = null;
        }
        telemetryInFlight = false;
        bleConnected = false;
        if (hudMounted) {
            setHudAwaiting(true);
            // Only auto-flip back to Code if the user is currently on the
            // HUD (which has no fresh data). If they explicitly opened the
            // Log tab, leave them there.
            if (activePane === 'hud') setPane('code');
        }
    }

    // --- Locale watcher -----------------------------------------------------
    // Blockly.ScratchMsgs.currentLocale_ changes when the user flips language
    // in the IDE header. We can't hook that event directly (obfuscated), so
    // just poll -- one string read every 500 ms is free.
    let lastLocale = null;
    function refreshAllLabels() {
        // HUD tabs
        if (codeTab) codeTab.textContent = tr(codeTab.dataset.labelKey);
        if (hudTab)  hudTab.textContent  = tr(hudTab.dataset.labelKey);
        if (logTab)  logTab.textContent  = tr(logTab.dataset.labelKey);
        // HUD section + row + awaiting labels (all tagged data-label-key)
        if (hudDiv) {
            hudDiv.querySelectorAll('[data-label-key]').forEach(el => {
                el.textContent = tr(el.dataset.labelKey);
            });
        }
        // Log pane empty-state string
        if (logDiv) {
            const empty = logDiv.querySelector('#bleLogEmpty');
            if (empty) empty.textContent = tr('sbLogEmpty');
        }
        // Nav buttons (Connect / Send via BLE)
        try { updateConnectButton(); } catch (_) {}
        const sbtn = document.getElementById('bleUploadButton');
        if (sbtn) sbtn.innerHTML = '&nbsp;' + tr('btnLabel');
        // Modal labels + status line (safe to call even when modal is closed)
        try { applyModalLabels(); } catch (_) {}
        try { updateModal(); } catch (_) {}
    }
    function startLocaleWatcher() {
        lastLocale = locale();
        setInterval(() => {
            const cur = locale();
            if (cur !== lastLocale) {
                lastLocale = cur;
                refreshAllLabels();
            }
        }, 500);
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
            this._onTelemetry = null;
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
            } else if (tag === RSP_TELEMETRY && dv.byteLength >= 16) {
                // Layout mirrors MiniR4BLERuntimeClass::_sendTelemetry.
                // Bytes 0..15 = phase 1 prefix. Byte 16..19 = uptime (uint32
                // little-endian). Older 16-byte firmwares just skip uptime.
                const t = {
                    battMv:  dv.getUint16(1, true),
                    running: dv.getUint8(3),
                    err:     dv.getUint8(4),
                    pc:      dv.getUint16(5, true),
                    size:    dv.getUint16(7, true),
                    roll:    dv.getInt16(9,  true) / 100,
                    pitch:   dv.getInt16(11, true) / 100,
                    yaw:     dv.getInt16(13, true) / 100,
                    btns:    dv.getUint8(15),
                };
                if (dv.byteLength >= 20) {
                    t.upSecs = dv.getUint32(16, true);
                }
                if (dv.byteLength >= 50) {
                    t.motorDeg = [
                        dv.getInt32(20, true),
                        dv.getInt32(24, true),
                        dv.getInt32(28, true),
                        dv.getInt32(32, true),
                    ];
                    t.analog = [
                        dv.getUint16(36, true), dv.getUint16(38, true),
                        dv.getUint16(40, true), dv.getUint16(42, true),
                        dv.getUint16(44, true), dv.getUint16(46, true),
                    ];
                    t.digitalBits = dv.getUint16(48, true);
                }
                if (this._onTelemetry) this._onTelemetry(t);
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
            startTelemetryPoll(state.device && state.device.name);
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
        stopTelemetryPoll();
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
                '<button id="bleModalSearch" type="button" style="padding:6px 14px;border:0;background:#008184;color:#fff;border-radius:4px;cursor:pointer;">Search</button>' +
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

    // Rewrite modal labels from the current locale. Factored out so both
    // openModal() and the locale watcher can call it -- the watcher was the
    // missing piece; before that a language flip after modal open left the
    // modal in the boot-time language.
    function applyModalLabels() {
        if (!modalEl) return;
        const set = (id, key) => {
            const el = document.getElementById(id);
            if (el) el.textContent = tr(key);
        };
        set('bleModalTitle',        'modalTitle');
        set('bleModalNameLabel',    'modalHubName');
        set('bleModalNameHint',     'modalHubHint');
        set('bleModalSearch',       'modalSearch');
        set('bleModalCancel',       'modalCancel');
        set('bleModalDisconnect',   'disconnect');
        set('bleModalRenameLabel',  'modalRename');
        set('bleModalRenameHint',   'modalRenameHint');
        set('bleModalRenameSave',   'modalRenameSave');
        const close = document.getElementById('bleModalClose');
        if (close) close.title = tr('modalClose');
    }

    function openModal() {
        const m = ensureModal();
        applyModalLabels();
        document.getElementById('bleModalName').value = getDeviceName();
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

        // Mount the tab-based HUD sidebar so Code/HUD/Log tabs exist even
        // before the first BLE connect. HUD starts in "awaiting connection"
        // mode; Log is empty until BLE activity accumulates.
        if (mountHud()) setHudAwaiting(true);

        // Start the locale watcher exactly once so language flips propagate
        // through every label (nav buttons, tabs, HUD, modal).
        if (!window.__bleLocaleWatcherStarted) {
            window.__bleLocaleWatcherStarted = true;
            startLocaleWatcher();
        }

        // Refresh labels a few times so late locale switches take effect
        // during the IDE's slow-boot phase.
        let tries = 0;
        const iv = setInterval(() => {
            refreshAllLabels();
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
