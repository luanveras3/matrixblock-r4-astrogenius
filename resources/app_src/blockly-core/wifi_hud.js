'use strict';
/*
 * MATRIXblock WiFi HUD — live robot telemetry sidebar (feature/wifi-tcp-ota).
 *
 * Ports the Code/HUD/Log tab bar and per-port sensor picker from the BLE
 * branch (ide_patch/blockly-core/ble_upload.js, ~1500 lines of transport-
 * agnostic UI) onto the WiFi runtime's TCP telemetry stream.
 *
 * Key differences from the BLE reference:
 *  - Transport: TCP NDJSON (window.MBR4WiFi.RobotClient) with autonomous
 *    push telemetry — the firmware streams {"t":"tm","d":"<base64 82B>"}
 *    frames after we send {"t":"telemetry","on":true,"hz":10}. The BLE
 *    version polled every 200 ms; here we just enable once and consume.
 *  - No VM: the "Program" section is removed (there is no bytecode on this
 *    branch). Bytes 3..8 of the frame are always zero.
 *  - Discovery: UDP broadcast auto-picks the robot on the network. If more
 *    than one hub answers, an in-HUD picker asks which one to attach to;
 *    the choice is remembered by MAC suffix in localStorage.
 *  - Connection lifecycle: HUD holds its own RobotClient. The upload flow
 *    in wifi_upload.js opens its own connection; when it grabs the socket
 *    the HUD reconnects with backoff. Occasional ~30 s HUD blackout during
 *    an OTA is by design (single-client runtime; simpler than IPC).
 *
 * DOM ids are prefixed 'wifiHud' (was 'bleHud') to avoid collision when
 * both branches happen to be installed side by side during testing.
 *
 * All strings EN + pt-BR; drop-in bilingual behavior identical to
 * wifi_upload.js's STRINGS + locale() + tr()/fmt() pattern.
 */
(function () {
    if (!window.MBR4WiFi) {
        console.warn('[HUD] window.MBR4WiFi not available — wifi_upload.js must load first.');
        return;
    }

    const { RobotClient, discover } = window.MBR4WiFi;

    // --- i18n (self-contained; reads locale from Blockly.ScratchMsgs) --------
    const STRINGS = {
        en: {
            // Top tab bar
            hudTabCode:      'Code',
            hudTabHud:       'HUD',
            hudTabLog:       'Log',
            // Sub-tabs
            sbSubTabState:   'State',
            sbSubTabPorts:   'Ports',
            // State sub-pane sections
            sbSectionConn:   'Connection',
            sbSectionImu:    'Orientation',
            sbHub:           'Hub',
            sbBattery:       'Battery',
            sbUptime:        'Uptime',
            sbImuRoll:       'Roll',
            sbImuPitch:      'Pitch',
            sbImuYaw:        'Yaw',
            sbButtons:       'Buttons',
            // Ports sub-pane sections
            sbSectionMotors: 'Motors',
            sbSectionAnalog: 'Analog (A1/A2/A3)',
            sbSectionDigital:'Digital (D1..D4)',
            sbSectionI2C:    'I2C (I2C1..I2C4)',
            sbPortsHint:     'Pick a sensor per port; readouts refresh live from the robot.',
            // Per-port picker
            sbModeRaw:       'Raw',
            sbModeSwitch:    'Switch',
            sbModePir:       'PIR',
            sbModePot:       'Pot',
            sbModeDht:       'DHT',
            sbModeLaser:     'Laser',
            sbModeColor:     'Color',
            sbModeNone:      '--',
            // Values
            sbSwOpen:        'OPEN',
            sbSwClosed:      'CLOSED',
            sbPirIdle:       'IDLE',
            sbPirMotion:     'MOTION',
            sbLaserMm:       'mm',
            sbLaserNa:       'no sensor',
            sbColorNa:       'no sensor',
            sbAnalogUnit:    'V',
            sbSpeed:         '°/s',
            // Status
            sbAwaitingConn:  'Waiting for a robot on the network...',
            sbLogEmpty:      'No activity yet. Frames and connection events show up here.',
            sbChangeRobot:   'Change robot',
            sbPickerTitle:   'Pick a robot for the HUD',
            sbPickerCancel:  'Cancel',
            sbConnecting:    'Connecting to %s...',
            sbConnected:     'Connected to %s.',
            sbDisconnected:  'Disconnected. Retrying...',
        },
        'pt-BR': {
            hudTabCode:      'Código',
            hudTabHud:       'HUD',
            hudTabLog:       'Log',
            sbSubTabState:   'Estado',
            sbSubTabPorts:   'Portas',
            sbSectionConn:   'Conexão',
            sbSectionImu:    'Orientação',
            sbHub:           'Robô',
            sbBattery:       'Bateria',
            sbUptime:        'Ligado há',
            sbImuRoll:       'Roll',
            sbImuPitch:      'Pitch',
            sbImuYaw:        'Yaw',
            sbButtons:       'Botões',
            sbSectionMotors: 'Motores',
            sbSectionAnalog: 'Analógicas (A1/A2/A3)',
            sbSectionDigital:'Digitais (D1..D4)',
            sbSectionI2C:    'I2C (I2C1..I2C4)',
            sbPortsHint:     'Escolha um sensor por porta; os valores atualizam em tempo real.',
            sbModeRaw:       'Bruto',
            sbModeSwitch:    'Chave',
            sbModePir:       'PIR',
            sbModePot:       'Pot',
            sbModeDht:       'DHT',
            sbModeLaser:     'Laser',
            sbModeColor:     'Cor',
            sbModeNone:      '--',
            sbSwOpen:        'ABERTA',
            sbSwClosed:      'FECHADA',
            sbPirIdle:       'PARADO',
            sbPirMotion:     'MOVIMENTO',
            sbLaserMm:       'mm',
            sbLaserNa:       'sem sensor',
            sbColorNa:       'sem sensor',
            sbAnalogUnit:    'V',
            sbSpeed:         '°/s',
            sbAwaitingConn:  'Aguardando robô na rede...',
            sbLogEmpty:      'Sem atividade ainda. Frames e eventos de conexão aparecem aqui.',
            sbChangeRobot:   'Trocar robô',
            sbPickerTitle:   'Escolha um robô para o HUD',
            sbPickerCancel:  'Cancelar',
            sbConnecting:    'Conectando em %s...',
            sbConnected:     'Conectado em %s.',
            sbDisconnected:  'Desconectado. Tentando de novo...',
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

    // --- Brand colors --------------------------------------------------------
    const BRAND_TEAL      = '#008184';
    const BRAND_TEAL_DARK = '#006466';
    const BRAND_AMBER     = '#ffd166';

    // --- Log ring buffer (surfaces in the Log tab) --------------------------
    const LOG_MAX = 500;
    const logBuffer = [];
    function log(msg, kind) {
        const entry = { msg: '[HUD] ' + msg, kind: kind, ts: Date.now() };
        logBuffer.push(entry);
        if (logBuffer.length > LOG_MAX) logBuffer.shift();
        appendLogLine(entry);
        console.log(entry.msg);
    }

    // --- Collapsible section state persistence ------------------------------
    const HUD_COLLAPSED_KEY = 'matrix-hud-collapsed';
    function loadCollapsed() {
        try {
            const raw = window.localStorage.getItem(HUD_COLLAPSED_KEY);
            return raw ? (JSON.parse(raw) || {}) : {};
        } catch (_) { return {}; }
    }
    function saveCollapsed(map) {
        try { window.localStorage.setItem(HUD_COLLAPSED_KEY, JSON.stringify(map)); }
        catch (_) {}
    }

    // --- Sub-tab (Estado / Portas) persistence ------------------------------
    const HUD_SUBTAB_KEY = 'matrix-hud-subtab';
    function loadSubTab() {
        try { return window.localStorage.getItem(HUD_SUBTAB_KEY) || 'state'; }
        catch (_) { return 'state'; }
    }
    function saveSubTab(name) {
        try { window.localStorage.setItem(HUD_SUBTAB_KEY, name); } catch (_) {}
    }

    // --- Per-port sensor picker persistence (identical to BLE branch) -------
    // Ports D1..D4 and A1..A3 (I2C1..I2C4 have no L/R). Mapping is the
    // MATRIX hardware pinout — reused verbatim because the hardware is the
    // same on both branches.
    const PORT_KEY_PREFIX      = 'matrix-hud-port-';
    const PORT_SIDE_KEY_PREFIX = 'matrix-hud-port-side-';
    const PORT_PINS = {
        'D1': [3, 2],   'D2': [5, 4],   'D3': [12, 11], 'D4': [13, 10],
        'A1': [1, 0],   'A2': [3, 2],   'A3': [4, 5],
    };
    const DEFAULT_SIDE_BY_MODE = {
        raw: 'R', switch: 'R', pir: 'L', pot: 'L', dht: 'R', laser: 'R',
    };
    const SIDED_MODES = { switch: 1, pir: 1, pot: 1 };
    function loadPortMode(portName) {
        try { return window.localStorage.getItem(PORT_KEY_PREFIX + portName) || 'raw'; }
        catch (_) { return 'raw'; }
    }
    function savePortMode(portName, mode) {
        try { window.localStorage.setItem(PORT_KEY_PREFIX + portName, mode); } catch (_) {}
    }
    function loadPortSide(portName, mode) {
        try {
            const v = window.localStorage.getItem(PORT_SIDE_KEY_PREFIX + portName + '-' + mode);
            if (v === 'L' || v === 'R') return v;
        } catch (_) {}
        return DEFAULT_SIDE_BY_MODE[mode] || 'R';
    }
    function savePortSide(portName, mode, side) {
        try { window.localStorage.setItem(PORT_SIDE_KEY_PREFIX + portName + '-' + mode, side); }
        catch (_) {}
    }

    // --- HUD DOM state -------------------------------------------------------
    let hudMounted = false;
    let codeTab = null, hudTab = null, logTab = null;
    let codeDiv = null, hudDiv = null, logDiv = null;
    let activePane = 'code';
    let hudConnected = false;

    // --- fmtUptime -----------------------------------------------------------
    function fmtUptime(s) {
        s = Math.max(0, s | 0);
        const h = Math.floor(s / 3600); s -= h * 3600;
        const m = Math.floor(s / 60);   s -= m * 60;
        if (h > 0) return h + 'h ' + m + 'm ' + s + 's';
        if (m > 0) return m + 'm ' + s + 's';
        return s + 's';
    }

    // --- HUD template --------------------------------------------------------
    // Copied near-verbatim from ble_upload.js hudHtml() — the DOM shape drives
    // every fill*() function below; keeping ids stable means those functions
    // are reused as-is. Only changes vs BLE: drop the "Program (VM)" section,
    // rename outer ids from bleHud* to wifiHud*, add a "Change robot" button.
    function hudHtml() {
        const collapsed = loadCollapsed();
        const section = (id, labelKey, bodyHtml) => {
            const isColl = !!collapsed[id];
            return (
              '<div class="hud-section" data-section-id="' + id + '" ' +
                'style="margin-bottom:10px;border-bottom:1px solid #eee;padding-bottom:8px;">' +
                '<button type="button" class="hud-section-header" ' +
                  'data-section-id="' + id + '" ' +
                  'style="width:100%;background:transparent;border:0;padding:4px 0;' +
                    'cursor:pointer;display:flex;align-items:center;gap:8px;' +
                    'color:' + BRAND_TEAL + ';font-size:11px;font-weight:700;' +
                    'text-transform:uppercase;letter-spacing:.06em;' +
                    'text-align:left;font-family:inherit;">' +
                  '<span class="hud-chevron" style="display:inline-block;width:10px;' +
                    'transition:transform .15s ease;transform:rotate(' +
                    (isColl ? '-90' : '0') + 'deg);">&#9662;</span>' +
                  '<span data-label-key="' + labelKey + '">' + tr(labelKey) + '</span>' +
                '</button>' +
                '<div class="hud-section-body" ' +
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
        const subTab = (id, key) =>
            '<button id="' + id + '" type="button" data-label-key="' + key + '" ' +
              'class="hud-subtab" style="flex:1;background:transparent;border:0;' +
              'border-bottom:2px solid transparent;padding:6px 8px;' +
              'font:600 12px/1.2 -apple-system,Segoe UI,sans-serif;' +
              'color:#666;cursor:pointer;letter-spacing:.03em;">' + tr(key) + '</button>';

        const motorCell = (n) =>
            '<div style="text-align:center;">' +
              '<div style="color:#9b9b9b;font-size:10px;text-transform:uppercase;' +
                'letter-spacing:.05em;">M' + n + '</div>' +
              '<div id="sbM' + n + 'Deg" style="font-weight:700;font-size:15px;' +
                'color:#222;font-variant-numeric:tabular-nums;">--</div>' +
              '<div id="sbM' + n + 'Spd" style="color:#9b9b9b;font-size:10px;' +
                'font-variant-numeric:tabular-nums;">--</div>' +
            '</div>';
        const analogCell = (arduinoPin, sideLabel) =>
            '<div style="text-align:center;">' +
              '<div style="color:#9b9b9b;font-size:9px;text-transform:uppercase;' +
                'letter-spacing:.05em;">' + sideLabel + ' <span style="opacity:.6;">A' + arduinoPin + '</span></div>' +
              '<div id="sbA' + arduinoPin + 'Raw" style="font-weight:700;font-size:14px;' +
                'color:#222;font-variant-numeric:tabular-nums;">--</div>' +
              '<div id="sbA' + arduinoPin + 'Volt" style="color:#9b9b9b;font-size:10px;' +
                'font-variant-numeric:tabular-nums;">--</div>' +
            '</div>';
        const digitalChip = (arduinoPin, sideLabel) =>
            '<div style="text-align:center;">' +
              '<div style="color:#9b9b9b;font-size:9px;text-transform:uppercase;' +
                'letter-spacing:.05em;margin-bottom:2px;">' + sideLabel + ' <span style="opacity:.6;">p' + arduinoPin + '</span></div>' +
              '<div id="sbD' + arduinoPin + '" style="text-align:center;padding:4px 0;' +
                'border-radius:4px;background:#f1f1f1;color:#9b9b9b;' +
                'font-size:10px;font-weight:700;letter-spacing:.04em;">--</div>' +
            '</div>';

        const modeOpt = (mode) =>
            '<option value="' + mode + '" data-label-key="sbMode' +
              mode.charAt(0).toUpperCase() + mode.slice(1) + '">' +
              tr('sbMode' + mode.charAt(0).toUpperCase() + mode.slice(1)) +
            '</option>';
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
        const dhtBody = (portName) =>
            '<div id="sbBody-' + portName + '-dht" class="port-body" style="display:none;">' +
              '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">' +
                '<div style="text-align:center;">' +
                  '<div style="color:#9b9b9b;font-size:9px;text-transform:uppercase;' +
                    'letter-spacing:.05em;">temp</div>' +
                  '<div id="sbDhtTemp-' + portName + '" style="font-weight:800;' +
                    'font-size:16px;color:#222;font-variant-numeric:tabular-nums;">--</div>' +
                '</div>' +
                '<div style="text-align:center;">' +
                  '<div style="color:#9b9b9b;font-size:9px;text-transform:uppercase;' +
                    'letter-spacing:.05em;">hum</div>' +
                  '<div id="sbDhtHum-' + portName + '" style="font-weight:800;' +
                    'font-size:16px;color:#222;font-variant-numeric:tabular-nums;">--</div>' +
                '</div>' +
              '</div>' +
              '<div id="sbDhtHint-' + portName + '" style="text-align:center;' +
                'color:#9b9b9b;font-size:9px;margin-top:3px;">pino L</div>' +
            '</div>';
        const digitalPortCard = (portName, leftPin, rightPin) =>
            '<div style="border:1px solid #eee;border-radius:6px;padding:6px;background:#fafafa;">' +
              portHeader(portName, ['raw', 'switch', 'pir', 'dht']) +
              rawDigitalBody(portName, leftPin, rightPin) +
              sensorBody(portName, 'switch') +
              sensorBody(portName, 'pir') +
              dhtBody(portName) +
            '</div>';
        const rawAnalogBody = (portName, leftPin, rightPin) =>
            '<div id="sbBody-' + portName + '-raw" class="port-body">' +
              '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">' +
                analogCell(leftPin, 'L') + analogCell(rightPin, 'R') +
              '</div>' +
            '</div>';
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
        const laserBody = (portName) =>
            '<div id="sbBody-' + portName + '-laser" class="port-body" style="display:none;">' +
              '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:6px;">' +
                '<span id="sbLaserMm-' + portName + '" style="font-weight:800;' +
                  'font-size:18px;color:#222;font-variant-numeric:tabular-nums;">--</span>' +
                '<span id="sbLaserDet-' + portName + '" style="color:#9b9b9b;font-size:10px;' +
                  'font-variant-numeric:tabular-nums;">' + tr('sbLaserMm') + '</span>' +
              '</div>' +
              '<div style="height:6px;background:#f1f1f1;border-radius:3px;margin-top:4px;overflow:hidden;">' +
                '<div id="sbLaserBar-' + portName + '" style="height:100%;width:0%;' +
                  'background:' + BRAND_TEAL + ';transition:width .15s;"></div>' +
              '</div>' +
            '</div>';
        const noneBody = (portName) =>
            '<div id="sbBody-' + portName + '-none" class="port-body">' +
              '<div style="color:#9b9b9b;font-size:10px;font-style:italic;' +
                'text-align:center;padding:6px 0;">--</div>' +
            '</div>';
        const colorBody = (portName) =>
            '<div id="sbBody-' + portName + '-color" class="port-body" style="display:none;">' +
              '<div style="display:flex;align-items:center;gap:8px;">' +
                '<div id="sbColorSwatch-' + portName + '" style="width:38px;height:38px;' +
                  'border-radius:6px;border:1px solid #ddd;background:#f1f1f1;flex:0 0 auto;"></div>' +
                '<div style="flex:1;">' +
                  '<div id="sbColorName-' + portName + '" style="font-weight:800;' +
                    'font-size:13px;color:#222;">--</div>' +
                  '<div id="sbColorRgb-' + portName + '" style="color:#9b9b9b;font-size:10px;' +
                    'font-variant-numeric:tabular-nums;">--</div>' +
                '</div>' +
              '</div>' +
            '</div>';
        const i2cPortCard = (portName) =>
            '<div style="border:1px solid #eee;border-radius:6px;padding:6px;background:#fafafa;">' +
              portHeader(portName, ['none', 'laser', 'color']) +
              noneBody(portName) +
              laserBody(portName) +
              colorBody(portName) +
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
                '</div>') +
            section('sbSecI2C', 'sbSectionI2C',
                '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px;">' +
                  i2cPortCard('I2C1') + i2cPortCard('I2C2') +
                  i2cPortCard('I2C3') + i2cPortCard('I2C4') +
                '</div>' +
                '<div data-label-key="sbPortsHint" style="color:#9b9b9b;' +
                  'font-size:10px;font-style:italic;margin-top:8px;">' +
                  tr('sbPortsHint') + '</div>');

        // "Estado" sub-pane. NOTE: no VM/Program section (this branch has no
        // bytecode VM — the corresponding telemetry bytes are always zero).
        const statePane =
            section('sbSecConn', 'sbSectionConn',
                '<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0;">' +
                  '<span data-label-key="sbHub" style="color:#4a4a4a;">' + tr('sbHub') + '</span>' +
                  '<span style="display:flex;align-items:center;gap:6px;">' +
                    '<span id="sbHub" style="color:#222;font-weight:600;">--</span>' +
                    '<button id="wifiHudChange" type="button" style="border:0;background:transparent;' +
                      'color:' + BRAND_TEAL + ';font-size:10px;cursor:pointer;text-decoration:underline;" ' +
                      'data-label-key="sbChangeRobot">' + tr('sbChangeRobot') + '</button>' +
                  '</span>' +
                '</div>' +
                row('sbBattery', 'sbBatt') +
                '<div style="height:6px;background:#f1f1f1;border-radius:3px;' +
                  'margin:4px 0 4px 0;overflow:hidden;">' +
                  '<div id="sbBattBar" style="height:100%;width:0%;background:' +
                    BRAND_TEAL + ';transition:width .3s,background .3s;"></div>' +
                '</div>' +
                row('sbUptime',  'sbUptime')) +
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
            '<div id="wifiHudAwaiting" style="display:none;color:#9b9b9b;' +
              'font-style:italic;padding:6px 0 10px 0;" data-label-key="sbAwaitingConn">' +
              tr('sbAwaitingConn') + '</div>' +
            '<div id="wifiHudSubTabs" style="display:flex;gap:0;margin-bottom:10px;' +
              'border-bottom:1px solid #eee;">' +
              subTab('wifiHudSubTabState', 'sbSubTabState') +
              subTab('wifiHudSubTabPorts', 'sbSubTabPorts') +
            '</div>' +
            '<div id="wifiHudSubPaneState">' + statePane + '</div>' +
            '<div id="wifiHudSubPanePorts" style="display:none;">' + portsPane + '</div>'
        );
    }

    // --- Mount tabs into the IDE layout -------------------------------------
    function mountHud() {
        if (hudMounted) return true;
        // If ble_upload.js already mounted its own Code/HUD/Log tabs (the
        // BLE branch's UI, when both are installed), don't add a second set.
        if (document.getElementById('bleHudTabs')) return false;
        const controlDiv = document.querySelector('.control-Div');
        codeDiv = document.querySelector('.code-Div');
        if (!controlDiv || !codeDiv) return false;   // IDE not ready yet

        const tabBar = document.createElement('div');
        tabBar.id = 'wifiHudTabs';
        tabBar.style.cssText =
            'display:flex;align-items:stretch;background:' + BRAND_TEAL + ';' +
            'border-bottom:2px solid ' + BRAND_TEAL_DARK + ';min-height:28px;' +
            'border-top-left-radius:.5em;border-top-right-radius:.5em;' +
            'overflow:hidden;margin-bottom:0;flex-shrink:0;';

        codeTab = mkTab('wifiHudTabCode', 'hudTabCode', () => setPane('code'));
        hudTab  = mkTab('wifiHudTabHud',  'hudTabHud',  () => setPane('hud'));
        logTab  = mkTab('wifiHudTabLog',  'hudTabLog',  () => setPane('log'));
        tabBar.appendChild(codeTab);
        tabBar.appendChild(hudTab);
        tabBar.appendChild(logTab);

        hudDiv = document.createElement('div');
        hudDiv.id = 'wifiHudPane';
        hudDiv.style.cssText = paneBaseStyle() + 'display:none;';
        hudDiv.innerHTML = hudHtml();

        logDiv = document.createElement('div');
        logDiv.id = 'wifiLogPane';
        logDiv.style.cssText = paneBaseStyle() +
            'font:11px/1.45 Menlo,Consolas,monospace;padding:8px 10px;display:none;';
        logDiv.innerHTML =
            '<div id="wifiLogEmpty" style="color:#9b9b9b;font-style:italic;' +
              'font-family:-apple-system,Segoe UI,sans-serif;">' +
              tr('sbLogEmpty') + '</div>' +
            '<div id="wifiLogList"></div>';

        codeDiv.style.borderTopLeftRadius  = '0';
        codeDiv.style.borderTopRightRadius = '0';
        controlDiv.insertBefore(tabBar, codeDiv);
        codeDiv.parentNode.insertBefore(hudDiv, codeDiv.nextSibling);
        codeDiv.parentNode.insertBefore(logDiv, hudDiv.nextSibling);

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
        wirePortModes();
        setSubTab(loadSubTab());
        for (let i = 0; i < logBuffer.length; i++) appendLogLine(logBuffer[i]);

        // "Change robot" button — inline picker over the HUD.
        const changeBtn = document.getElementById('wifiHudChange');
        if (changeBtn) changeBtn.addEventListener('click', openHudPicker);

        setPane('code');
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
            const h = codeDiv.getBoundingClientRect().height;
            if (h > 0) {
                hudDiv.style.height = h + 'px';
                logDiv.style.height = h + 'px';
            }
        }
        if (name === 'log') logDiv.scrollTop = logDiv.scrollHeight;
    }

    // --- Sub-tab wiring ------------------------------------------------------
    function setSubTab(name) {
        if (!hudDiv) return;
        const stateBtn = hudDiv.querySelector('#wifiHudSubTabState');
        const portsBtn = hudDiv.querySelector('#wifiHudSubTabPorts');
        const statePane = hudDiv.querySelector('#wifiHudSubPaneState');
        const portsPane = hudDiv.querySelector('#wifiHudSubPanePorts');
        if (!stateBtn || !portsBtn) return;
        const isState = name !== 'ports';
        statePane.style.display = isState ? 'block' : 'none';
        portsPane.style.display = isState ? 'none'  : 'block';
        [stateBtn, portsBtn].forEach((b, i) => {
            const active = (i === 0) === isState;
            b.style.color = active ? BRAND_TEAL : '#666';
            b.style.borderBottomColor = active ? BRAND_TEAL : 'transparent';
        });
        saveSubTab(isState ? 'state' : 'ports');
    }
    function wireSubTabs() {
        if (!hudDiv) return;
        hudDiv.querySelector('#wifiHudSubTabState').addEventListener('click', () => setSubTab('state'));
        hudDiv.querySelector('#wifiHudSubTabPorts').addEventListener('click', () => setSubTab('ports'));
    }

    // --- Collapsibles + port-mode wiring (identical rendering to BLE) -------
    function wireCollapsibles() {
        if (!hudDiv) return;
        hudDiv.addEventListener('click', (ev) => {
            const hdr = ev.target.closest('.hud-section-header');
            if (!hdr) return;
            const id = hdr.dataset.sectionId;
            const section = hudDiv.querySelector('.hud-section[data-section-id="' + id + '"]');
            if (!section) return;
            const body = section.querySelector('.hud-section-body');
            const chev = hdr.querySelector('.hud-chevron');
            const map = loadCollapsed();
            const isColl = body.style.display === 'none';
            body.style.display = isColl ? 'block' : 'none';
            chev.style.transform = isColl ? 'rotate(0deg)' : 'rotate(-90deg)';
            if (isColl) delete map[id]; else map[id] = true;
            saveCollapsed(map);
        });
    }
    function refreshSideToggle(portName) {
        if (!hudDiv) return;
        const container = hudDiv.querySelector('.port-side-toggle[data-port="' + portName + '"]');
        if (!container) return;
        const mode = loadPortMode(portName);
        if (!SIDED_MODES[mode]) { container.style.display = 'none'; return; }
        container.style.display = '';
        const side = loadPortSide(portName, mode);
        const btns = container.querySelectorAll('button.port-side-btn');
        for (let i = 0; i < btns.length; i++) {
            const isActive = btns[i].dataset.side === side;
            btns[i].style.background = isActive ? BRAND_TEAL : '#fff';
            btns[i].style.color      = isActive ? '#fff'     : '#555';
        }
    }
    function applyPortMode(portName, mode) {
        if (!hudDiv) return;
        const bodies = hudDiv.querySelectorAll('[id^="sbBody-' + portName + '-"]');
        for (let i = 0; i < bodies.length; i++) {
            const b = bodies[i];
            const bMode = b.id.substring(('sbBody-' + portName + '-').length);
            b.style.display = (bMode === mode) ? '' : 'none';
        }
    }
    function wirePortModes() {
        if (!hudDiv) return;
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
            if (portName.charAt(0) === 'D') sendDhtEnableMask();
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

    // --- Log tab -------------------------------------------------------------
    function appendLogLine(entry) {
        if (!hudMounted || !logDiv) return;
        const empty = logDiv.querySelector('#wifiLogEmpty');
        if (empty) empty.style.display = 'none';
        const list = logDiv.querySelector('#wifiLogList');
        if (!list) return;
        const line = document.createElement('div');
        line.textContent = entry.msg;
        line.style.cssText = 'padding:1px 0;white-space:pre-wrap;word-break:break-word;' +
            (entry.kind === 'error' ? 'color:#c62828;'
             : entry.kind === 'ok' ? 'color:' + BRAND_TEAL + ';'
             : 'color:#4a4a4a;');
        list.appendChild(line);
        while (list.childElementCount > LOG_MAX) list.removeChild(list.firstChild);
        if (activePane === 'log') logDiv.scrollTop = logDiv.scrollHeight;
    }

    // --- Sensor renderers (verbatim from BLE — same DOM ids, same policy) ---
    function fillDigitalSensor(portName, mode, lPin, rPin, lHigh, rHigh) {
        const $ = id => hudDiv.querySelector('#' + id);
        const valEl  = $('sbSensor-' + portName + '-' + mode);
        const hintEl = $('sbSensorHint-' + portName + '-' + mode);
        if (!valEl) return;
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
        hintEl.textContent = 'pin ' + side + ' (p' + pin + ')';
    }
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
        detEl.textContent = raw + ' / ' + volts + ' V @ pin ' + side + ' (A' + pin + ')';
        if (barEl) barEl.style.width = pct.toFixed(1) + '%';
    }
    function fillDht(portName, dht) {
        const $ = id => hudDiv.querySelector('#' + id);
        const tEl = $('sbDhtTemp-' + portName);
        const hEl = $('sbDhtHum-'  + portName);
        const nEl = $('sbDhtHint-' + portName);
        if (!tEl) return;
        const na = (dht.temp === 127 && dht.hum === 255);
        if (na) {
            tEl.textContent = '--';
            hEl.textContent = '--';
            nEl.textContent = tr('sbLaserNa');
            return;
        }
        tEl.textContent = dht.temp + '°C';
        hEl.textContent = dht.hum  + '%';
        nEl.textContent = 'pin L';
    }
    function fillColor(portName, c) {
        const $ = id => hudDiv.querySelector('#' + id);
        const swEl   = $('sbColorSwatch-' + portName);
        const nameEl = $('sbColorName-'   + portName);
        const rgbEl  = $('sbColorRgb-'    + portName);
        if (!swEl) return;
        const na = (c.r === 0 && c.g === 0 && c.b === 0 && c.id === -1);
        if (na) {
            swEl.style.background = '#f1f1f1';
            nameEl.textContent = '--';
            rgbEl.textContent  = tr('sbColorNa');
            return;
        }
        const NAMES = ['Black', 'Violet', '', 'Blue', 'Cyan', '', 'Green',
                       'Yellow', '', 'Red', 'White'];
        const label = (c.id >= 0 && c.id < NAMES.length && NAMES[c.id])
                      ? NAMES[c.id] : ('id=' + c.id);
        swEl.style.background = 'rgb(' + c.r + ',' + c.g + ',' + c.b + ')';
        nameEl.textContent = label;
        rgbEl.textContent  = 'R:' + c.r + ' G:' + c.g + ' B:' + c.b;
    }
    function fillLaser(portName, mm) {
        const $ = id => hudDiv.querySelector('#' + id);
        const mmEl  = $('sbLaserMm-' + portName);
        const detEl = $('sbLaserDet-' + portName);
        const barEl = $('sbLaserBar-' + portName);
        if (!mmEl) return;
        if (mm === 0xFFFF) {
            mmEl.textContent = '--';
            detEl.textContent = tr('sbLaserNa');
            if (barEl) barEl.style.width = '0%';
            return;
        }
        mmEl.textContent = mm;
        detEl.textContent = tr('sbLaserMm');
        const pct = Math.max(0, Math.min(100, (mm / 2000) * 100));
        if (barEl) barEl.style.width = pct.toFixed(1) + '%';
    }

    // --- Frame parser (82-byte blob — layout matches BLE branch) ------------
    // The runtime pushes {"t":"tm","d":"<base64 82B>"} — decode once here so
    // the rest of updateHud() is transport-agnostic.
    function b64ToBytes(b64) {
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }
    function parseTelemetryFrame(base64) {
        const bytes = b64ToBytes(base64);
        const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        if (dv.getUint8(0) !== 0xA2) return null;   // wrong tag
        const t = {
            battMv:  dv.getUint16(1, true),
            // Bytes 3..8 are VM fields — always zero on this branch; drop.
            roll:    dv.getInt16(9,  true) / 100,
            pitch:   dv.getInt16(11, true) / 100,
            yaw:     dv.getInt16(13, true) / 100,
            btns:    dv.getUint8(15),
        };
        if (dv.byteLength >= 20) t.upSecs = dv.getUint32(16, true);
        if (dv.byteLength >= 50) {
            t.motorDeg = [
                dv.getInt32(20, true), dv.getInt32(24, true),
                dv.getInt32(28, true), dv.getInt32(32, true),
            ];
            t.analog = [
                dv.getUint16(36, true), dv.getUint16(38, true),
                dv.getUint16(40, true), dv.getUint16(42, true),
                dv.getUint16(44, true), dv.getUint16(46, true),
            ];
            t.digitalBits = dv.getUint16(48, true);
        }
        if (dv.byteLength >= 54) {
            t.laser = [dv.getUint16(50, true), dv.getUint16(52, true)];
        }
        if (dv.byteLength >= 62) {
            t.dht = [
                { temp: dv.getInt8(54), hum: dv.getUint8(55) },
                { temp: dv.getInt8(56), hum: dv.getUint8(57) },
                { temp: dv.getInt8(58), hum: dv.getUint8(59) },
                { temp: dv.getInt8(60), hum: dv.getUint8(61) },
            ];
        }
        if (dv.byteLength >= 70) {
            t.color = [
                { r: dv.getUint8(62), g: dv.getUint8(63), b: dv.getUint8(64), id: dv.getInt8(65) },
                { r: dv.getUint8(66), g: dv.getUint8(67), b: dv.getUint8(68), id: dv.getInt8(69) },
            ];
        }
        if (dv.byteLength >= 82) {
            t.laser.push(dv.getUint16(70, true), dv.getUint16(72, true));
            t.color.push(
                { r: dv.getUint8(74), g: dv.getUint8(75), b: dv.getUint8(76), id: dv.getInt8(77) },
                { r: dv.getUint8(78), g: dv.getUint8(79), b: dv.getUint8(80), id: dv.getInt8(81) });
        }
        return t;
    }

    // --- HUD update ---------------------------------------------------------
    let lastMotorDeg = [null, null, null, null];
    let lastMotorTs  = 0;
    function updateHud(t) {
        if (!hudMounted || !hudDiv) return;
        const $ = id => hudDiv.querySelector('#' + id);

        const volts = (t.battMv / 100).toFixed(2);
        const battEl = $('sbBatt');
        // "0.4 V" on USB is misleading (no battery); flag it explicitly.
        if (t.battMv < 100) {
            battEl.textContent = 'USB';
            battEl.style.color = '#4a4a4a';
        } else {
            battEl.textContent = volts + ' V';
            const battColor = (t.battMv < 1100) ? '#c62828'
                            : (t.battMv < 1150) ? '#ef6c00' : BRAND_TEAL;
            battEl.style.color = battColor;
        }
        const pct = Math.max(0, Math.min(100,
            ((t.battMv - 1000) / (1300 - 1000)) * 100));
        const bar = $('sbBattBar');
        if (bar) {
            bar.style.width = pct.toFixed(1) + '%';
            bar.style.background = battEl.style.color;
        }
        const upEl = $('sbUptime');
        if (upEl) upEl.textContent = (t.upSecs != null) ? fmtUptime(t.upSecs) : '--';

        $('sbImuRollVal').textContent  = t.roll.toFixed(1);
        $('sbImuPitchVal').textContent = t.pitch.toFixed(1);
        $('sbImuYawVal').textContent   = t.yaw.toFixed(1);

        const dEl = $('sbBtnDown'), uEl = $('sbBtnUp');
        const on  = 'background:' + BRAND_AMBER + ';color:#333;';
        const off = 'background:#f1f1f1;color:#9b9b9b;';
        dEl.style.cssText = 'display:inline-block;padding:3px 10px;margin-right:6px;' +
            'border-radius:4px;font-size:11px;font-weight:600;letter-spacing:.05em;' +
            ((t.btns & 1) ? on : off);
        uEl.style.cssText = 'display:inline-block;padding:3px 10px;' +
            'border-radius:4px;font-size:11px;font-weight:600;letter-spacing:.05em;' +
            ((t.btns & 2) ? on : off);

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
        const iports = ['I2C1', 'I2C2', 'I2C3', 'I2C4'];
        for (let i = 0; i < iports.length; i++) {
            const name = iports[i];
            const mode = loadPortMode(name);
            if (mode === 'laser' && t.laser && i < t.laser.length) {
                fillLaser(name, t.laser[i]);
            } else if (mode === 'color' && t.color && i < t.color.length) {
                fillColor(name, t.color[i]);
            }
        }
        if (t.dht) {
            for (let i = 0; i < 4; i++) {
                const name = 'D' + (i + 1);
                if (loadPortMode(name) !== 'dht') continue;
                fillDht(name, t.dht[i]);
            }
        }
    }

    function setHudHub(hubName) {
        if (!hudMounted) return;
        const el = hudDiv.querySelector('#sbHub');
        if (el) el.textContent = hubName || '--';
    }
    function setHudAwaiting(waiting) {
        if (!hudMounted) return;
        const el = hudDiv.querySelector('#wifiHudAwaiting');
        if (el) el.style.display = waiting ? 'block' : 'none';
    }

    // --- Session (RobotClient) with auto-reconnect ---------------------------
    // The upload flow (wifi_upload.js) opens its own RobotClient during OTA;
    // the runtime accepts one client at a time, so our socket may drop when
    // the user starts an upload. Simple recovery: back off and retry every
    // 5 s. The uploader's own progress UI stays informative during the gap.
    const REMEMBER_KEY = 'matrix-hud-robot-mac';
    let hudClient = null;
    let hudSelectedMac = null;     // preferred robot; overrides discovery
    let reconnectTimer = 0;
    let reconnectDelayMs = 5000;

    function rememberedMac() {
        try { return window.localStorage.getItem(REMEMBER_KEY) || null; } catch (_) { return null; }
    }
    function rememberMac(mac) {
        try {
            if (mac) window.localStorage.setItem(REMEMBER_KEY, mac);
            else window.localStorage.removeItem(REMEMBER_KEY);
        } catch (_) {}
    }

    async function pickRobot() {
        const robots = await discover(2000);
        if (!robots.length) return null;
        const prefer = hudSelectedMac || rememberedMac();
        if (prefer) {
            const hit = robots.find((r) => r.mac === prefer);
            if (hit) return hit;
        }
        // Multiple robots without a saved choice: prompt with the picker.
        if (robots.length > 1 && !hudSelectedMac) {
            openHudPicker(robots);
            return null;
        }
        return robots[0];
    }

    async function connectLoop() {
        clearTimeout(reconnectTimer);
        if (hudClient) { try { hudClient.close(); } catch (_) {} hudClient = null; }
        setHudAwaiting(true);
        setHudHub(null);

        const robot = await pickRobot();
        if (!robot) {
            reconnectTimer = setTimeout(connectLoop, reconnectDelayMs);
            return;
        }
        const client = new RobotClient(robot.ip);
        log(fmt(tr('sbConnecting'), robot.name || robot.ip));
        try {
            await client.connect(4000);
        } catch (e) {
            log(`connect failed: ${e.message}`, 'error');
            reconnectTimer = setTimeout(connectLoop, reconnectDelayMs);
            return;
        }

        hudClient = client;
        hudConnected = true;
        setHudAwaiting(false);
        setHudHub(robot.name || robot.ip);
        log(fmt(tr('sbConnected'), robot.name || robot.ip), 'ok');
        reconnectDelayMs = 5000;   // reset backoff on success

        // Frame counter and last-seen timestamps help diagnose why a session
        // dies (peer close vs. socket error vs. no frames arriving).
        let frameCount = 0;
        let lastFrameAt = Date.now();
        const connectAt = Date.now();

        // Wrap the RobotClient's own onFrame so we can count frames.
        const origFrame = client.onFrame;
        client.onFrame = (o) => {
            if (o.t === 'tm') { frameCount++; lastFrameAt = Date.now(); }
            if (origFrame) { try { origFrame(o); } catch (e) {} }
        };

        // Hook the raw socket for error visibility (RobotClient swallows errors).
        if (client.sock) {
            client.sock.on('error', (e) => {
                log('socket error: ' + e.code + ' ' + e.message, 'error');
            });
            client.sock.on('end', () => {
                log('peer sent FIN after ' + ((Date.now() - connectAt) / 1000).toFixed(1) +
                    's, ' + frameCount + ' frames, last frame ' +
                    ((Date.now() - lastFrameAt) / 1000).toFixed(1) + 's ago');
            });
        }

        client.onClose = () => {
            hudConnected = false;
            hudClient = null;
            setHudAwaiting(true);
            log(tr('sbDisconnected') + ' (uptime ' +
                ((Date.now() - connectAt) / 1000).toFixed(1) + 's, ' +
                frameCount + ' frames)');
            reconnectTimer = setTimeout(connectLoop, reconnectDelayMs);
        };
        client.onFrame = (o) => {
            if (o.t === 'tm' && o.d) {
                const t = parseTelemetryFrame(o.d);
                if (t) updateHud(t);
            }
        };
        // Ask for the stream + push initial DHT mask (opt-in ports only).
        try { client.send({ t: 'telemetry', on: true, hz: 10 }); } catch (_) {}
        sendDhtEnableMask();
    }

    function sendDhtEnableMask() {
        if (!hudClient || !hudConnected) return;
        let mask = 0;
        for (let i = 0; i < 4; i++) {
            if (loadPortMode('D' + (i + 1)) === 'dht') mask |= (1 << i);
        }
        try { hudClient.send({ t: 'dht', mask }); } catch (_) {}
    }

    // --- In-HUD picker (used when discovery finds multiple robots) ----------
    function openHudPicker(preloaded) {
        const back = document.createElement('div');
        back.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);' +
            'display:flex;align-items:center;justify-content:center;z-index:100000;' +
            'font:14px/1.4 -apple-system,Segoe UI,sans-serif;';
        const box = document.createElement('div');
        box.style.cssText = 'background:#fff;border-radius:8px;width:420px;max-width:92vw;' +
            'padding:16px 18px;box-shadow:0 8px 32px rgba(0,0,0,.35);';
        box.innerHTML =
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">' +
              '<h5 style="margin:0;font:600 16px/1.2 inherit;">' + tr('sbPickerTitle') + '</h5>' +
              '<button id="wifiHudPickerX" type="button" style="background:none;border:0;font-size:20px;cursor:pointer;color:#555;">&times;</button>' +
            '</div>' +
            '<div id="wifiHudPickerList"></div>' +
            '<div style="text-align:right;margin-top:10px;">' +
              '<button id="wifiHudPickerCancel" type="button" style="padding:6px 14px;border:1px solid #64748b;background:#fff;color:#64748b;border-radius:4px;cursor:pointer;">' + tr('sbPickerCancel') + '</button>' +
            '</div>';
        back.appendChild(box);
        document.body.appendChild(back);
        const close = () => { try { document.body.removeChild(back); } catch (_) {} };
        back.addEventListener('click', (ev) => { if (ev.target === back) close(); });
        document.getElementById('wifiHudPickerX').addEventListener('click', close);
        document.getElementById('wifiHudPickerCancel').addEventListener('click', close);

        const render = (robots) => {
            const list = document.getElementById('wifiHudPickerList');
            list.innerHTML = '';
            if (!robots.length) {
                list.innerHTML = '<div style="color:#666;font-style:italic;">--</div>';
                return;
            }
            robots.forEach((r) => {
                const row = document.createElement('div');
                row.style.cssText = 'display:flex;justify-content:space-between;' +
                    'align-items:center;padding:8px 10px;border:1px solid #e5e7eb;' +
                    'border-radius:6px;margin-bottom:6px;cursor:pointer;';
                row.innerHTML =
                    '<div>' +
                      '<div style="font-weight:600;">' + (r.name || r.ip) + '</div>' +
                      '<div style="font-size:12px;color:#666;">' + r.ip + ' - fw ' + (r.fw || '?') + '</div>' +
                    '</div>' +
                    '<button type="button" style="padding:4px 10px;border:0;background:' + BRAND_TEAL + ';color:#fff;border-radius:4px;cursor:pointer;">→</button>';
                row.addEventListener('click', () => {
                    hudSelectedMac = r.mac || null;
                    rememberMac(r.mac);
                    close();
                    connectLoop();
                });
                list.appendChild(row);
            });
        };

        if (preloaded && preloaded.length) render(preloaded);
        else discover(2000).then(render);
    }

    // --- Locale watcher ------------------------------------------------------
    function refreshAllLabels() {
        if (!hudDiv) return;
        const els = hudDiv.querySelectorAll('[data-label-key]');
        for (let i = 0; i < els.length; i++) {
            els[i].textContent = tr(els[i].dataset.labelKey);
        }
        [codeTab, hudTab, logTab].forEach((el) => {
            if (el && el.dataset.labelKey) el.textContent = tr(el.dataset.labelKey);
        });
        const empty = document.getElementById('wifiLogEmpty');
        if (empty) empty.textContent = tr('sbLogEmpty');
    }
    function startLocaleWatcher() {
        let last = locale();
        setInterval(() => {
            const cur = locale();
            if (cur !== last) { last = cur; refreshAllLabels(); }
        }, 500);
    }

    // --- Boot ----------------------------------------------------------------
    // Idempotence guard: we schedule boot() 4x (DOMContentLoaded + three
    // setTimeouts) so it fires even when the IDE loads slowly, but only
    // the FIRST successful boot must start the connect loop — otherwise
    // we spawn concurrent RobotClients that all fight over the runtime's
    // single-client TCP slot, each dying within ~3 s and the HUD looking
    // permanently unstable. Cost me a full debug session; do not remove.
    let bootDone = false;
    function boot() {
        if (bootDone) return;
        if (!mountHud()) return;   // IDE DOM not ready yet — retry later
        bootDone = true;
        startLocaleWatcher();
        connectLoop();
    }
    console.log('[HUD] wifi_hud.js module loaded');
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
    setTimeout(boot, 1500);
    setTimeout(boot, 3000);
    setTimeout(boot, 5000);

    // Exposed for e2e tests.
    window.MBR4Hud = {
        _parseTelemetryFrame: parseTelemetryFrame,
        _mounted: () => hudMounted,
        _connected: () => hudConnected,
        _openPicker: openHudPicker,
    };
})();
