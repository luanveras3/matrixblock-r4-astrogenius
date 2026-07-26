'use strict';
/*
 * MATRIXblock unified connection manager.
 *
 * One place that answers "am I talking to a robot, and how?" — for the cable
 * and the radio at once — and one place to act on the answer.
 *
 * Why this exists: connection state used to live in five places, each with
 * its own picker and its own notion of connected (the navbar port selector,
 * the OTA picker, the Send-VM picker, the HUD's connect loop, the USB setup
 * panel). Nothing ever said "you are not on the robot's WiFi", which is
 * exactly the state a user can spend an afternoon failing to diagnose. Worse,
 * the runtime accepts ONE TCP client, so those pickers competed for it —
 * that competition is why MBR4Hud.pause()/resume() exists at all.
 *
 * Ownership, deliberately split:
 *  - WiFi: this module does NOT open a socket. The HUD owns the single TCP
 *    slot and its reconnect logic; we drive it through MBR4Hud
 *    (send/onFrame/onConnect/isConnected/selectRobot/currentRobot). Adding a
 *    second client here would recreate the exact problem the panel exists to
 *    remove.
 *  - USB: this module owns the serial link outright, because nothing else
 *    wants it and configuration must work when the radio does not.
 *
 * Commands are identical on both transports (the firmware feeds serial and
 * TCP into the same NDJSON dispatcher), so `send()` can route by whatever is
 * up and the config form does not care which.
 */
(function () {
    let SerialPort = null;
    try { SerialPort = require('serialport').SerialPort; }
    catch (e) { console.warn('[Conn] serialport unavailable:', e && e.message); }

    const BAUDS = [115200, 9600];   // runtime opens 115200; a user sketch may win
    const PROBE_TIMEOUT_MS = 1200;
    const BATT_LOW  = 7.6;
    const BATT_CRIT = 7.1;

    // --- i18n --------------------------------------------------------------
    const S = {
        en: {
            navTitle:    'Connection — USB and WiFi',
            title:       'Robot connection',
            usb:         'USB cable',
            wifi:        'WiFi',
            noCable:     'no cable',
            usbHint:     'The cable link is held only while this window is open, so it never blocks a USB upload.',
            notConnected:'not connected',
            searching:   'Searching...',
            scanUsb:     'Search cable',
            scanWifi:    'Search WiFi',
            close:       'Close',
            connect:     'Connect',
            connected:   'Connected',
            pcOn:        'Your computer is on the network',
            pcOnNone:    'Your computer is not on any WiFi network.',
            robotOn:     'This robot broadcasts',
            mismatch:    'Your computer is on a different network than this robot. Join <b>%s</b> to reach it.',
            noRobots:    'No robot found on WiFi. Check that the hub is on and that your computer is on its network. The first search may trigger the Windows Firewall prompt.',
            noPorts:     'No serial port found. Use a USB data cable — some cables only carry power.',
            noHubUsb:    'A serial port was found but the hub did not answer. Make sure it is on and running a MATRIXblock program.',
            tabStatus:   'Status',
            tabSetup:    'Setup',
            secName:     'Robot name',
            secWifiCfg:  'Classroom WiFi',
            secAp:       'Robot\'s own WiFi (AP)',
            secActions:  'Actions',
            fName:       'Name',
            fSsid:       'Network name (2.4 GHz)',
            fPass:       'Password',
            fApPass:     'AP password',
            save:        'Save',
            clearWifi:   'Forget stored network',
            forgetVm:    'Forget saved program',
            factory:     'Factory reset',
            reboot:      'Restart hub',
            start:       'Start program',
            radioOff:    'Turn WiFi off',
            radioWarn:   'The robot stops using WiFi until you turn it off and on again. It saves battery and satisfies competition rules that forbid radios during a run.\n\nYou can still reach it with the USB cable. Continue?',
            radioOffOk:  'WiFi off. Reach the robot with the USB cable, or restart it to bring WiFi back.',
            radioIsOff:  'WiFi is off on this robot (until it restarts).',
            nameHint:    'Also becomes the robot\'s WiFi name, as <name>-%s, from the next restart.',
            wifiHint:    'The network the robot should join. Leave empty and press Forget for it to use its own AP.',
            apHint:      'Between 8 and 63 characters. Empty restores matrix2026. Applies on the next restart.',
            waiting:     'This robot is waiting to start.',
            noLink:      'Connect to a robot first — over the cable or over WiFi.',
            okName:      'Name saved.',
            okWifi:      'Network saved. It takes effect on the next restart.',
            okWifiClr:   'Stored network cleared.',
            okAp:        'AP password saved. It takes effect on the next restart.',
            okVm:        'Saved program cleared.',
            okFactory:   'Factory reset done. The hub is restarting.',
            okReboot:    'Restarting...',
            okStart:     'Start sent.',
            failed:      'Failed: %s',
            battLow:     'Battery is low (%s V). Charge the hub — on a low pack the WiFi becomes unreliable while USB keeps working, which looks like a broken robot.',
            battCrit:    'Battery is very low (%s V). Charge the hub before using WiFi.',
            factoryWarn: 'Factory reset clears the name, the stored WiFi, the AP password and any saved program. The robot\'s WiFi goes back to MBR4-%s / matrix2026. Continue?',
            via:         'via',
        },
        'pt-BR': {
            navTitle:    'Conexão — USB e WiFi',
            title:       'Conexão com o robô',
            usb:         'Cabo USB',
            wifi:        'WiFi',
            noCable:     'sem cabo',
            usbHint:     'A conexão pelo cabo fica ativa só enquanto esta janela está aberta, para nunca atrapalhar um envio por USB.',
            notConnected:'não conectado',
            searching:   'Procurando...',
            scanUsb:     'Procurar cabo',
            scanWifi:    'Procurar WiFi',
            close:       'Fechar',
            connect:     'Conectar',
            connected:   'Conectado',
            pcOn:        'Seu computador está na rede',
            pcOnNone:    'Seu computador não está em nenhuma rede WiFi.',
            robotOn:     'Este robô transmite',
            mismatch:    'Seu computador está em uma rede diferente da do robô. Entre em <b>%s</b> para alcançá-lo.',
            noRobots:    'Nenhum robô encontrado no WiFi. Confira se o hub está ligado e se o seu computador está na rede dele. A primeira busca pode disparar o aviso do Firewall do Windows.',
            noPorts:     'Nenhuma porta serial encontrada. Use um cabo USB de dados — alguns cabos só levam energia.',
            noHubUsb:    'Achei uma porta serial, mas o hub não respondeu. Confira se ele está ligado e com um programa MATRIXblock.',
            tabStatus:   'Situação',
            tabSetup:    'Configurar',
            secName:     'Nome do robô',
            secWifiCfg:  'WiFi da escola',
            secAp:       'WiFi do próprio robô (AP)',
            secActions:  'Ações',
            fName:       'Nome',
            fSsid:       'Nome da rede (2.4 GHz)',
            fPass:       'Senha',
            fApPass:     'Senha do AP',
            save:        'Salvar',
            clearWifi:   'Esquecer rede guardada',
            forgetVm:    'Esquecer programa guardado',
            factory:     'Reset de fábrica',
            reboot:      'Reiniciar hub',
            start:       'Iniciar programa',
            radioOff:    'Desligar o WiFi',
            radioWarn:   'O robô para de usar WiFi até você desligar e ligar ele de novo. Economiza bateria e atende às regras de competição que proíbem rádio durante a rodada.\n\nVocê ainda alcança ele pelo cabo USB. Continuar?',
            radioOffOk:  'WiFi desligado. Use o cabo USB para falar com o robô, ou reinicie para voltar o WiFi.',
            radioIsOff:  'O WiFi deste robô está desligado (até ele reiniciar).',
            nameHint:    'Também vira o nome do WiFi do robô, como <nome>-%s, a partir do próximo reinício.',
            wifiHint:    'A rede em que o robô deve entrar. Deixe vazio e clique em Esquecer para ele usar o próprio AP.',
            apHint:      'Entre 8 e 63 caracteres. Vazio volta para matrix2026. Vale no próximo reinício.',
            waiting:     'Este robô está esperando para iniciar.',
            noLink:      'Conecte-se a um robô primeiro — pelo cabo ou pelo WiFi.',
            okName:      'Nome salvo.',
            okWifi:      'Rede salva. Vale a partir do próximo reinício.',
            okWifiClr:   'Rede guardada apagada.',
            okAp:        'Senha do AP salva. Vale a partir do próximo reinício.',
            okVm:        'Programa guardado apagado.',
            okFactory:   'Reset de fábrica feito. O hub está reiniciando.',
            okReboot:    'Reiniciando...',
            okStart:     'Comando de início enviado.',
            failed:      'Falhou: %s',
            battLow:     'Bateria baixa (%s V). Carregue o hub — com a bateria fraca o WiFi fica instável enquanto o USB continua funcionando, o que parece robô quebrado.',
            battCrit:    'Bateria muito baixa (%s V). Carregue o hub antes de usar WiFi.',
            factoryWarn: 'O reset de fábrica apaga o nome, a rede guardada, a senha do AP e qualquer programa guardado. O WiFi do robô volta a ser MBR4-%s / matrix2026. Continuar?',
            via:         'por',
        },
    };
    function locale() {
        try {
            const l = Blockly && Blockly.ScratchMsgs && Blockly.ScratchMsgs.currentLocale_;
            if (l && S[l]) return l;
        } catch (e) {}
        return 'en';
    }
    function tr(k) { return S[locale()][k] || S.en[k]; }
    function fmt(t) {
        const a = Array.prototype.slice.call(arguments, 1);
        let i = 0;
        return String(t).replace(/%[ds]/g, () => (a[i++] !== undefined ? a[i - 1] : ''));
    }
    function esc(s) {
        return String(s).replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[c]));
    }

    // --- Serial link (owned here) -----------------------------------------
    class SerialLink {
        constructor(path, baud) { this.path = path; this.baud = baud; this.buf = ''; this.subs = []; }
        open() {
            return new Promise((res, rej) => {
                this.port = new SerialPort({ path: this.path, baudRate: this.baud },
                    (e) => (e ? rej(e) : res()));
                this.port.on('data', (d) => {
                    this.buf += d.toString('utf8');
                    let i;
                    while ((i = this.buf.indexOf('\n')) >= 0) {
                        const line = this.buf.slice(0, i).trim();
                        this.buf = this.buf.slice(i + 1);
                        if (!line || line.charAt(0) !== '{') continue;
                        let o = null;
                        try { o = JSON.parse(line); } catch (e) { continue; }
                        this.subs.slice().forEach((f) => { try { f(o); } catch (_) {} });
                    }
                });
                this.port.on('error', () => {});
                this.port.on('close', () => { state.usb = null; render(); });
            });
        }
        send(o) { try { this.port.write(JSON.stringify(o) + '\n'); return true; } catch (e) { return false; } }
        request(o, match, ms = 5000) {
            return new Promise((res, rej) => {
                const to = setTimeout(() => { off(); rej(new Error('timeout')); }, ms);
                const h = (x) => { if (match(x)) { clearTimeout(to); off(); res(x); } };
                const off = () => { const i = this.subs.indexOf(h); if (i >= 0) this.subs.splice(i, 1); };
                this.subs.push(h);
                this.send(o);
            });
        }
        close() { return new Promise((r) => { if (!this.port || !this.port.isOpen) return r(); this.port.close(() => r()); }); }
    }

    // --- State -------------------------------------------------------------
    const state = {
        usb:  null,   // { link, info, path, baud }
        wifi: null,   // { robot, info }  — the HUD owns the socket
        robots: [],   // last WiFi discovery
        pcSsid: null, // SSID the computer is joined to
        busy: false,
    };

    function wifiUp() {
        return !!(window.MBR4Hud && window.MBR4Hud.isConnected());
    }

    /** Send over whichever transport is up. USB wins for configuration: it
     *  cannot be knocked out by the very setting being changed. */
    function send(obj) {
        if (state.usb) return state.usb.link.send(obj);
        if (wifiUp())  return window.MBR4Hud.send(obj);
        return false;
    }

    function request(obj, match, ms) {
        if (state.usb) return state.usb.link.request(obj, match, ms);
        if (wifiUp()) {
            return new Promise((res, rej) => {
                const to = setTimeout(() => { off(); rej(new Error('timeout')); }, ms || 6000);
                const off = window.MBR4Hud.onFrame((o) => {
                    if (match(o)) { clearTimeout(to); off(); res(o); }
                });
                window.MBR4Hud.send(obj);
            });
        }
        return Promise.reject(new Error(tr('noLink')));
    }

    /** The identity we are showing — whichever link answered most recently. */
    function activeInfo() {
        if (state.usb && state.usb.info) return state.usb.info;
        if (state.wifi && state.wifi.info) return state.wifi.info;
        return null;
    }

    // --- Discovery ---------------------------------------------------------
    async function scanUsb(logFn) {
        if (!SerialPort) return;
        if (state.usb) { await state.usb.link.close(); state.usb = null; }
        let ports = [];
        try { ports = await SerialPort.list(); } catch (e) { ports = []; }
        if (!ports.length) { logFn(tr('noPorts'), 'error'); return; }
        ports.sort((a, b) => {
            const sc = (p) => (/arduino|renesas|wch|silicon|ftdi/i.test(
                (p.manufacturer || '') + ' ' + (p.friendlyName || '')) ? 0 : 1);
            return sc(a) - sc(b);
        });
        for (const p of ports) {
            for (const baud of BAUDS) {
                const link = new SerialLink(p.path, baud);
                try {
                    await link.open();
                    await new Promise((r) => setTimeout(r, 250));
                    const info = await link.request({ t: 'info' }, (x) => x.t === 'info', PROBE_TIMEOUT_MS);
                    state.usb = { link, info, path: p.path, baud };
                    render();
                    return;
                } catch (e) { await link.close(); }
            }
        }
        logFn(tr('noHubUsb'), 'error');
    }

    async function scanWifi(logFn) {
        if (!window.MBR4WiFi || !window.MBR4WiFi.discover) return;
        state.robots = await window.MBR4WiFi.discover(2000);
        if (!state.robots.length) logFn(tr('noRobots'), 'error');
        render();
    }

    // Which WiFi the computer itself is on. Without this the panel can say
    // "no robot found" while the real answer is "you are on the school
    // network and the robot is on its own" — the single most common cause of
    // a robot that "cannot be found anywhere".
    function readPcSsid() {
        try {
            const { execFile } = require('child_process');
            execFile('netsh', ['wlan', 'show', 'interfaces'], { timeout: 6000 },
                (err, stdout) => {
                    if (err || !stdout) return;
                    // Locale-independent: take the SSID line that is not BSSID.
                    const m = stdout.split(/\r?\n/)
                        .filter((l) => /\bSSID\b/.test(l) && !/BSSID/i.test(l))
                        .map((l) => l.split(':').slice(1).join(':').trim())
                        .filter((v) => v.length)[0];
                    if (m && m !== state.pcSsid) { state.pcSsid = m; render(); }
                });
        } catch (e) {}
    }

    // --- UI ----------------------------------------------------------------
    let modalEl = null, indicatorEl = null, activeTab = 'status';

    function lamp(on, label) {
        return '<span style="display:inline-flex;align-items:center;gap:4px;' +
               'margin-right:10px;white-space:nowrap;">' +
               '<span style="width:8px;height:8px;border-radius:50%;background:' +
               (on ? '#22c55e' : '#94a3b8') + ';"></span>' +
               '<span style="font-size:11px;">' + esc(label) + '</span></span>';
    }

    function renderIndicator() {
        if (!indicatorEl) return;
        const usbLabel  = state.usb ? state.usb.path : tr('noCable');
        const wifiLabel = wifiUp()
            ? ((window.MBR4Hud.currentRobot() || {}).name || tr('connected'))
            : tr('notConnected');
        indicatorEl.innerHTML =
            lamp(!!state.usb, usbLabel) + lamp(wifiUp(), wifiLabel);
        indicatorEl.title = tr('navTitle');
    }

    function statusHtml() {
        const info = activeInfo();
        let h = '';

        // Battery first: a weak pack explains symptoms people otherwise
        // blame on software.
        if (info && typeof info.batt === 'number' && info.batt < BATT_LOW) {
            const crit = info.batt < BATT_CRIT;
            h += '<div style="margin-bottom:10px;padding:8px 10px;border-radius:4px;' +
                 'background:' + (crit ? '#fee2e2' : '#fef3c7') + ';color:' +
                 (crit ? '#991b1b' : '#92400e') + ';font-size:13px;">' +
                 esc(fmt(tr(crit ? 'battCrit' : 'battLow'), info.batt.toFixed(2))) +
                 '</div>';
        }

        if (info && info.radio === false) {
            h += '<div style="margin-bottom:10px;padding:8px 10px;border-radius:4px;' +
                 'background:#e0e7ff;color:#3730a3;font-size:13px;">' +
                 esc(tr('radioIsOff')) + '</div>';
        }

        if (info && info.waiting === true) {
            h += '<div style="margin-bottom:10px;padding:8px 10px;border-radius:4px;' +
                 'background:#dcfce7;color:#166534;font-size:13px;display:flex;' +
                 'justify-content:space-between;align-items:center;gap:10px;">' +
                 '<span>' + esc(tr('waiting')) + '</span>' +
                 '<button id="connStart" type="button" style="padding:4px 12px;border:0;' +
                 'border-radius:4px;background:#22c55e;color:#fff;font:600 12px inherit;' +
                 'cursor:pointer;">' + esc(tr('start')) + '</button></div>';
        }

        // USB
        h += '<div style="border:1px solid #e5e7eb;border-radius:6px;padding:10px 12px;margin-bottom:10px;">' +
             '<div style="display:flex;justify-content:space-between;align-items:center;">' +
             '<b>' + esc(tr('usb')) + '</b>' +
             '<button id="connScanUsb" type="button" class="connBtn">' + esc(tr('scanUsb')) + '</button></div>';
        h += state.usb
            ? '<div style="font-size:13px;margin-top:4px;">' + lamp(true, state.usb.path) +
              esc((state.usb.info && state.usb.info.name) || '') + ' · ' +
              state.usb.baud + ' baud</div>'
            : '<div style="font-size:13px;color:#64748b;margin-top:4px;">' + esc(tr('noCable')) + '</div>';
        h += '<div style="font-size:11px;color:#94a3b8;margin-top:4px;">' + esc(tr('usbHint')) + '</div>';
        h += '</div>';

        // WiFi
        h += '<div style="border:1px solid #e5e7eb;border-radius:6px;padding:10px 12px;">' +
             '<div style="display:flex;justify-content:space-between;align-items:center;">' +
             '<b>' + esc(tr('wifi')) + '</b>' +
             '<button id="connScanWifi" type="button" class="connBtn">' + esc(tr('scanWifi')) + '</button></div>';
        h += '<div style="font-size:12px;color:#475569;margin-top:4px;">' +
             (state.pcSsid ? esc(tr('pcOn')) + ' <b>' + esc(state.pcSsid) + '</b>'
                           : esc(tr('pcOnNone'))) + '</div>';

        const cur = wifiUp() ? window.MBR4Hud.currentRobot() : null;
        if (cur) {
            h += '<div style="font-size:13px;margin-top:6px;">' +
                 lamp(true, cur.name || cur.ip) + esc(cur.ip) + '</div>';
        }
        // The SSID a robot broadcasts is the answer to "which network do I
        // join?", and it is not derivable — a rename only reaches the SSID on
        // the next power cycle.
        if (info && info.ap) {
            h += '<div style="font-size:12px;color:#475569;margin-top:4px;">' +
                 esc(tr('robotOn')) + ' <b>' + esc(info.ap) + '</b></div>';
            if (state.pcSsid && info.mode === 'ap' && state.pcSsid !== info.ap) {
                h += '<div style="font-size:12px;color:#92400e;margin-top:4px;">' +
                     fmt(tr('mismatch'), esc(info.ap)) + '</div>';
            }
        }
        if (state.robots.length) {
            h += '<div style="margin-top:8px;">' + state.robots.map((r) => {
                const active = cur && cur.mac === r.mac;
                return '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;' +
                       'border-top:1px solid #f1f5f9;">' +
                       '<span style="flex:1;font-size:13px;">' + esc(r.name || r.ip) +
                       ' <span style="color:#64748b;">' + esc(r.ip) + '</span></span>' +
                       (active ? '<span style="font-size:12px;color:#059669;">' + esc(tr('connected')) + '</span>'
                               : '<button type="button" class="connBtn connPick" data-mac="' +
                                 esc(r.mac || '') + '">' + esc(tr('connect')) + '</button>') +
                       '</div>';
            }).join('') + '</div>';
        }
        h += '</div>';
        return h;
    }

    function field(id, label, value, hint, type) {
        return '<label style="display:block;margin-bottom:8px;">' +
               '<span style="display:block;font-weight:600;margin-bottom:2px;">' + esc(label) + '</span>' +
               '<input id="' + id + '" type="' + (type || 'text') + '" value="' + esc(value || '') + '" ' +
               'style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:4px;font:inherit;">' +
               (hint ? '<span style="display:block;font-size:12px;color:#64748b;margin-top:2px;">' +
                       esc(hint) + '</span>' : '') + '</label>';
    }

    function setupHtml() {
        const info = activeInfo();
        if (!info) return '<div style="color:#64748b;">' + esc(tr('noLink')) + '</div>';
        const mac = info.mac || 'xxxx';
        const sec = (t, b) =>
            '<fieldset style="border:1px solid #e5e7eb;border-radius:6px;padding:10px 12px;margin-bottom:12px;">' +
            '<legend style="font-size:13px;font-weight:600;padding:0 6px;">' + esc(t) + '</legend>' + b + '</fieldset>';
        return sec(tr('secName'),
                   field('connName', tr('fName'), info.name, fmt(tr('nameHint'), mac)) +
                   '<button id="connSaveName" type="button" class="connBtnPrimary">' + esc(tr('save')) + '</button>') +
               sec(tr('secWifiCfg'),
                   field('connSsid', tr('fSsid'), info.ssid, tr('wifiHint')) +
                   field('connPass', tr('fPass'), '', '', 'password') +
                   '<button id="connSaveWifi" type="button" class="connBtnPrimary">' + esc(tr('save')) + '</button> ' +
                   '<button id="connClearWifi" type="button" class="connBtn">' + esc(tr('clearWifi')) + '</button>') +
               sec(tr('secAp'),
                   field('connApPass', tr('fApPass'), '', tr('apHint')) +
                   '<button id="connSaveAp" type="button" class="connBtnPrimary">' + esc(tr('save')) + '</button>') +
               sec(tr('secActions'),
                   '<button id="connRadioOff" type="button" class="connBtn">' + esc(tr('radioOff')) + '</button> ' +
                   '<button id="connForgetVm" type="button" class="connBtn">' + esc(tr('forgetVm')) + '</button> ' +
                   '<button id="connReboot" type="button" class="connBtn">' + esc(tr('reboot')) + '</button> ' +
                   '<button id="connFactory" type="button" class="connBtnDanger">' + esc(tr('factory')) + '</button>');
    }

    function status(msg, cls) {
        const el = document.getElementById('connStatus');
        if (!el) return;
        el.textContent = msg || '';
        el.style.color = cls === 'error' ? '#dc2626' : (cls === 'ok' ? '#059669' : '#334155');
    }

    function render() {
        renderIndicator();
        if (!modalEl || modalEl.style.display === 'none') return;
        const body = document.getElementById('connBody');
        if (!body) return;
        body.innerHTML = activeTab === 'status' ? statusHtml() : setupHtml();
        wireBody();
        const st = document.getElementById('connTabStatus');
        const su = document.getElementById('connTabSetup');
        [[st, 'status'], [su, 'setup']].forEach(([el, name]) => {
            if (!el) return;
            el.style.borderBottom = activeTab === name ? '2px solid #0ea5e9' : '2px solid transparent';
            el.style.fontWeight = activeTab === name ? '700' : '400';
        });
    }

    function val(id) { const e = document.getElementById(id); return e ? e.value.trim() : ''; }

    async function guard(fn) {
        if (state.busy) return;
        state.busy = true;
        try { await fn(); }
        catch (e) { status(fmt(tr('failed'), (e && e.message) || String(e)), 'error'); }
        finally { state.busy = false; }
    }

    async function refreshInfo() {
        const o = await request({ t: 'info' }, (x) => x.t === 'info');
        if (state.usb) state.usb.info = o;
        else state.wifi = { robot: window.MBR4Hud.currentRobot(), info: o };
        render();
    }

    async function ackOr(cmd, obj, okMsg) {
        const a = await request(obj, (o) => o.t === 'ack' && o.cmd === cmd, 6000);
        if (!a.ok) throw new Error(a.err || cmd);
        status(okMsg, 'ok');
        await refreshInfo();
    }

    function wireBody() {
        const on = (id, fn) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('click', fn);
        };
        document.querySelectorAll('.connBtn').forEach((b) => {
            b.style.cssText = 'padding:4px 10px;border:1px solid #cbd5e1;background:#f8fafc;' +
                              'color:#0f172a;border-radius:4px;cursor:pointer;font:inherit;font-size:12px;';
        });
        document.querySelectorAll('.connBtnPrimary').forEach((b) => {
            b.style.cssText = 'padding:6px 14px;border:0;background:#0ea5e9;color:#fff;' +
                              'border-radius:4px;cursor:pointer;font:inherit;font-weight:600;';
        });
        document.querySelectorAll('.connBtnDanger').forEach((b) => {
            b.style.cssText = 'padding:6px 14px;border:1px solid #dc2626;background:#fff;' +
                              'color:#dc2626;border-radius:4px;cursor:pointer;font:inherit;';
        });

        on('connScanUsb',  () => guard(async () => { status(tr('searching')); await scanUsb(status); }));
        on('connScanWifi', () => guard(async () => { status(tr('searching')); readPcSsid(); await scanWifi(status); }));
        on('connStart',    () => guard(async () => { send({ t: 'start' }); status(tr('okStart'), 'ok'); }));
        document.querySelectorAll('.connPick').forEach((b) => {
            b.addEventListener('click', () => guard(async () => {
                if (window.MBR4Hud && window.MBR4Hud.selectRobot) {
                    window.MBR4Hud.selectRobot(b.getAttribute('data-mac'));
                    status(tr('searching'));
                }
            }));
        });

        on('connSaveName',  () => guard(() => ackOr('setname', { t: 'setname', name: val('connName') }, tr('okName'))));
        on('connSaveWifi',  () => guard(() => ackOr('setwifi', { t: 'setwifi', ssid: val('connSsid'), pass: val('connPass') }, tr('okWifi'))));
        on('connClearWifi', () => guard(() => ackOr('setwifi', { t: 'setwifi', ssid: '', pass: '' }, tr('okWifiClr'))));
        on('connSaveAp',    () => guard(() => ackOr('setappass', { t: 'setappass', pass: val('connApPass') }, tr('okAp'))));
        on('connRadioOff', () => guard(async () => {
            if (!window.confirm(tr('radioWarn'))) return;
            // Over WiFi this is the last thing that link will ever carry, so
            // a dropped socket afterwards is success, not failure.
            await request({ t: 'radio', on: false },
                          (o) => o.t === 'ack' && o.cmd === 'radio', 5000).catch(() => {});
            status(tr('radioOffOk'), 'ok');
        }));
        on('connForgetVm',  () => guard(() => ackOr('vm_forget', { t: 'vm_forget' }, tr('okVm'))));
        on('connReboot',    () => guard(async () => {
            await request({ t: 'reboot' }, (o) => o.t === 'ack' && o.cmd === 'reboot', 4000).catch(() => {});
            status(tr('okReboot'), 'ok');
        }));
        on('connFactory',   () => guard(async () => {
            const info = activeInfo() || {};
            if (!window.confirm(fmt(tr('factoryWarn'), info.mac || 'xxxx'))) return;
            await request({ t: 'factory' }, (o) => o.t === 'ack' && o.cmd === 'factory', 6000);
            status(tr('okFactory'), 'ok');
        }));
    }

    function ensureModal() {
        if (modalEl && document.body.contains(modalEl)) return modalEl;
        modalEl = document.createElement('div');
        modalEl.id = 'connModal';
        modalEl.style.cssText =
            'position:fixed;inset:0;display:none;align-items:center;justify-content:center;' +
            'background:rgba(0,0,0,.45);z-index:100002;font:14px/1.45 -apple-system,Segoe UI,sans-serif;';
        modalEl.innerHTML =
            '<div style="background:#fff;color:#111;border-radius:8px;width:560px;max-width:94vw;' +
            'max-height:90vh;overflow:auto;padding:16px 18px;box-shadow:0 8px 32px rgba(0,0,0,.35);">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
                '<h5 id="connTitle" style="margin:0;font:600 17px/1.2 inherit;"></h5>' +
                '<button id="connClose" type="button" style="background:none;border:0;font-size:20px;' +
                  'cursor:pointer;color:#555;">&times;</button></div>' +
              '<div style="display:flex;gap:14px;border-bottom:1px solid #e5e7eb;margin-bottom:10px;">' +
                '<a id="connTabStatus" style="cursor:pointer;padding:6px 2px;"></a>' +
                '<a id="connTabSetup"  style="cursor:pointer;padding:6px 2px;"></a></div>' +
              '<div id="connStatus" style="min-height:1.3em;font-size:13px;margin-bottom:8px;"></div>' +
              '<div id="connBody"></div>' +
            '</div>';
        document.body.appendChild(modalEl);
        document.getElementById('connClose').addEventListener('click', close);
        modalEl.addEventListener('click', (e) => { if (e.target === modalEl && !state.busy) close(); });
        document.getElementById('connTabStatus').addEventListener('click', () => { activeTab = 'status'; render(); });
        document.getElementById('connTabSetup').addEventListener('click', () => { activeTab = 'setup'; render(); });
        return modalEl;
    }

    function open() {
        ensureModal();
        document.getElementById('connTitle').textContent = tr('title');
        document.getElementById('connTabStatus').textContent = tr('tabStatus');
        document.getElementById('connTabSetup').textContent = tr('tabSetup');
        status('');
        modalEl.style.display = 'flex';
        render();
        readPcSsid();
        guard(async () => { await scanUsb(status); await scanWifi(status); });
    }
    async function close() {
        if (state.busy) return;
        // Release the serial port. Holding it open would block the IDE's own
        // USB upload (arduino-cli needs the port exclusively) — a panel that
        // silently broke uploading would be a far worse bug than the one it
        // was built to fix. The USB link therefore lives exactly as long as
        // this panel is open.
        if (state.usb) {
            try { await state.usb.link.close(); } catch (_) {}
            state.usb = null;
        }
        if (modalEl) modalEl.style.display = 'none';
        render();
    }

    // --- Navbar indicator ---------------------------------------------------
    // Attached to the element that already means "which device am I talking
    // to", so there is one place to look rather than five.
    function installIndicator() {
        if (indicatorEl && document.body.contains(indicatorEl)) return;
        const host = document.getElementById('deviceStNavLink');
        if (!host) return;
        indicatorEl = document.createElement('span');
        indicatorEl.id = 'connIndicator';
        indicatorEl.style.cssText = 'display:inline-flex;align-items:center;cursor:pointer;margin-left:6px;';
        indicatorEl.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation(); open();
        });
        host.parentNode.insertBefore(indicatorEl, host.nextSibling);
        renderIndicator();
    }

    window.MBR4Connection = {
        open, send, request,
        isUsbConnected:  () => !!state.usb,
        isWifiConnected: wifiUp,
        info: activeInfo,
        _state: () => ({ usb: !!state.usb, wifi: wifiUp(), robots: state.robots.length,
                         pcSsid: state.pcSsid, info: activeInfo() }),
    };

    function boot() {
        installIndicator();
        if (window.MBR4Hud && window.MBR4Hud.onFrame && !window.__connHooked) {
            window.__connHooked = true;
            window.MBR4Hud.onFrame((o) => {
                if (o.t === 'info') {
                    state.wifi = { robot: window.MBR4Hud.currentRobot(), info: o };
                    render();
                }
            });
            window.MBR4Hud.onConnect(() => render());
        }
        renderIndicator();
    }

    console.log('[Conn] connection.js module loaded');
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
    setTimeout(boot, 1500);
    setTimeout(boot, 3000);
    setTimeout(boot, 6000);
    setInterval(renderIndicator, 2000);
    setInterval(readPcSsid, 15000);
})();
