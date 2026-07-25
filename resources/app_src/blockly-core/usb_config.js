'use strict';
/*
 * MATRIXblock hub configuration over the USB cable (feature/wifi-tcp-ota).
 *
 * Why this exists: every other way of configuring the hub goes through the
 * radio, which makes the network a prerequisite for fixing the network. A hub
 * with the wrong credentials stored, a forgotten AP password, a renamed SSID
 * nobody can guess, or a modem that has stopped answering was recoverable only
 * by reflashing it from a terminal. With the cable plugged in, none of that
 * matters: this panel speaks the SAME NDJSON command set over Serial that
 * wifi_upload.js speaks over TCP, so the hub is always manageable.
 *
 * Firmware side: MiniR4WiFiRuntime::_pollSerial() feeds the very same
 * _handleLine() dispatcher, and it is started before anything that can fail —
 * a hub with no WiFi module at all still answers here.
 *
 * Baud: the runtime opens the channel at 115200, but a user sketch may call
 * Serial.begin() with its own baud afterwards (the wrapper runs userSetup()
 * last) and wins. So we probe 115200 then 9600 rather than assuming.
 */
(function () {
    let SerialPort = null;
    try {
        SerialPort = require('serialport').SerialPort;
    } catch (e) {
        console.warn('[USB] serialport unavailable:', e && e.message);
    }

    const BAUDS = [115200, 9600];
    const PROBE_TIMEOUT_MS = 1200;

    // Battery thresholds for the warning strip. The hub runs 2x18650 (7.4 V
    // nominal, 8.4 V full), so these are heuristics, not a measured cliff:
    // WiFi transmit bursts sag the rail, and a pack that reads fine at idle
    // can still brown the modem out under load. The failure mode that makes
    // this worth surfacing is nasty — the robot stays perfectly usable over
    // USB while becoming unfindable over WiFi, which reads as a broken app.
    // Warning early costs a user nothing; warning late costs an afternoon.
    const BATT_LOW  = 7.6;
    const BATT_CRIT = 7.1;

    // --- i18n -------------------------------------------------------------
    const STRINGS = {
        en: {
            btnTitle:     'Configure the hub over the USB cable (works with no WiFi)',
            btnLabel:     'USB Setup',
            title:        'Hub setup over USB',
            intro:        'Plug the hub in with the USB cable. This panel works even when the robot cannot be found on WiFi.',
            noSerial:     'Serial support is unavailable in this build.',
            scanning:     'Looking for the hub on the serial ports...',
            noPorts:      'No serial port found. Plug the hub in with a USB data cable (some cables only carry power) and press Search again.',
            noHub:        'A serial port was found, but the hub did not answer. Make sure it is powered on and running a MATRIXblock program, then try again.',
            found:        'Connected on %s at %d baud.',
            search:       'Search',
            close:        'Close',
            secName:      'Robot name',
            secWifi:      'Classroom WiFi',
            secAp:        'Robot\'s own WiFi (AP)',
            secDanger:    'Reset',
            fName:        'Name',
            fSsid:        'Network name (2.4 GHz)',
            fPass:        'Password',
            fApPass:      'AP password',
            save:         'Save',
            clearWifi:    'Forget stored network',
            apHint:       'Between 8 and 63 characters. Leave empty to go back to matrix2026. Applies on the next restart.',
            wifiHint:     'The network the robot should join. Leave empty and press Forget to make it use its own AP instead.',
            nameHint:     'Also becomes the robot\'s WiFi name, as <name>-%s, from the next restart.',
            forgetVm:     'Forget saved program',
            factory:      'Factory reset',
            reboot:       'Restart hub',
            factoryWarn:  'Factory reset clears the name, the stored WiFi, the AP password and any saved program. The robot\'s WiFi goes back to MBR4-%s / matrix2026. Continue?',
            statusName:   'Name saved.',
            statusWifi:   'Network saved. It takes effect on the next restart.',
            statusWifiClr:'Stored network cleared.',
            statusAp:     'AP password saved. It takes effect on the next restart.',
            statusVm:     'Saved program cleared.',
            statusFactory:'Factory reset done. The hub is restarting.',
            statusReboot: 'Restarting...',
            failed:       'Failed: %s',
            battLow:      'Battery is low (%s V). Charge the hub — on a low pack the WiFi can become unreliable while USB keeps working, which looks like a broken robot.',
            battCrit:     'Battery is very low (%s V). Charge the hub before using WiFi at all.',
            fwLabel:      'firmware',
            modeAp:       'own AP',
            modeSta:      'joined to a network',
            storedNet:    'stored network',
            none:         'none',
            confirmYes:   'Yes, reset',
            cancel:       'Cancel',
            apNow:        'To reach this robot over WiFi, join the network',
            apChange:     'After the next restart this network becomes <b>%s</b> — the name only changes when the robot is powered off and on again.',
        },
        'pt-BR': {
            btnTitle:     'Configurar o hub pelo cabo USB (funciona sem WiFi)',
            btnLabel:     'Config USB',
            title:        'Configuração do hub por USB',
            intro:        'Conecte o hub pelo cabo USB. Este painel funciona mesmo quando o robô não é encontrado no WiFi.',
            noSerial:     'Suporte a porta serial indisponível nesta versão.',
            scanning:     'Procurando o hub nas portas seriais...',
            noPorts:      'Nenhuma porta serial encontrada. Conecte o hub com um cabo USB de dados (alguns cabos só levam energia) e clique em Procurar de novo.',
            noHub:        'Achei uma porta serial, mas o hub não respondeu. Confira se ele está ligado e com um programa MATRIXblock gravado, e tente de novo.',
            found:        'Conectado em %s a %d baud.',
            search:       'Procurar',
            close:        'Fechar',
            secName:      'Nome do robô',
            secWifi:      'WiFi da escola',
            secAp:        'WiFi do próprio robô (AP)',
            secDanger:    'Reset',
            fName:        'Nome',
            fSsid:        'Nome da rede (2.4 GHz)',
            fPass:        'Senha',
            fApPass:      'Senha do AP',
            save:         'Salvar',
            clearWifi:    'Esquecer rede guardada',
            apHint:       'Entre 8 e 63 caracteres. Deixe vazio para voltar a matrix2026. Vale a partir do próximo reinício.',
            wifiHint:     'A rede em que o robô deve entrar. Deixe vazio e clique em Esquecer para ele usar o próprio AP.',
            nameHint:     'Também vira o nome do WiFi do robô, como <nome>-%s, a partir do próximo reinício.',
            forgetVm:     'Esquecer programa guardado',
            factory:      'Reset de fábrica',
            reboot:       'Reiniciar hub',
            factoryWarn:  'O reset de fábrica apaga o nome, a rede guardada, a senha do AP e qualquer programa guardado. O WiFi do robô volta a ser MBR4-%s / matrix2026. Continuar?',
            statusName:   'Nome salvo.',
            statusWifi:   'Rede salva. Vale a partir do próximo reinício.',
            statusWifiClr:'Rede guardada apagada.',
            statusAp:     'Senha do AP salva. Vale a partir do próximo reinício.',
            statusVm:     'Programa guardado apagado.',
            statusFactory:'Reset de fábrica feito. O hub está reiniciando.',
            statusReboot: 'Reiniciando...',
            failed:       'Falhou: %s',
            battLow:      'Bateria baixa (%s V). Carregue o hub — com a bateria fraca o WiFi fica instável enquanto o USB continua funcionando, o que parece robô quebrado.',
            battCrit:     'Bateria muito baixa (%s V). Carregue o hub antes de usar WiFi.',
            fwLabel:      'firmware',
            modeAp:       'AP próprio',
            modeSta:      'conectado a uma rede',
            storedNet:    'rede guardada',
            none:         'nenhuma',
            confirmYes:   'Sim, resetar',
            cancel:       'Cancelar',
            apNow:        'Para achar este robô no WiFi, entre na rede',
            apChange:     'Depois do próximo reinício esta rede passa a ser <b>%s</b> — o nome só muda quando o robô é desligado e ligado de novo.',
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
        return String(t).replace(/%[ds]/g, () => (args[i++] !== undefined ? args[i - 1] : ''));
    }
    function esc(s) {
        return String(s).replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[c]));
    }

    // --- Serial link ------------------------------------------------------
    // One line-delimited JSON conversation. The cable is shared with whatever
    // the student's sketch prints, so replies are matched by content rather
    // than by position: we take the first line that parses and satisfies the
    // caller's predicate and ignore everything else.
    class HubSerial {
        constructor(path, baud) {
            this.path = path;
            this.baud = baud;
            this.buf = '';
            this.handlers = [];
        }
        open() {
            return new Promise((resolve, reject) => {
                this.port = new SerialPort({ path: this.path, baudRate: this.baud },
                    (err) => (err ? reject(err) : resolve()));
                this.port.on('data', (d) => {
                    this.buf += d.toString('utf8');
                    let i;
                    while ((i = this.buf.indexOf('\n')) >= 0) {
                        const line = this.buf.slice(0, i).trim();
                        this.buf = this.buf.slice(i + 1);
                        if (!line || line.charAt(0) !== '{') continue;
                        let o = null;
                        try { o = JSON.parse(line); } catch (e) { continue; }
                        this.handlers.slice().forEach((h) => h(o));
                    }
                });
                this.port.on('error', () => {});
            });
        }
        send(obj) {
            return new Promise((resolve, reject) => {
                this.port.write(JSON.stringify(obj) + '\n', (e) => (e ? reject(e) : resolve()));
            });
        }
        request(obj, match, timeoutMs = 4000) {
            return new Promise((resolve, reject) => {
                const to = setTimeout(() => { off(); reject(new Error('timeout')); }, timeoutMs);
                const h = (o) => { if (match(o)) { clearTimeout(to); off(); resolve(o); } };
                const off = () => {
                    const i = this.handlers.indexOf(h);
                    if (i >= 0) this.handlers.splice(i, 1);
                };
                this.handlers.push(h);
                this.send(obj).catch((e) => { clearTimeout(to); off(); reject(e); });
            });
        }
        close() {
            return new Promise((resolve) => {
                if (!this.port || !this.port.isOpen) return resolve();
                this.port.close(() => resolve());
            });
        }
    }

    let link = null;      // active HubSerial
    let info = null;      // last {"t":"info"} payload
    let busy = false;

    async function probePort(path, baud) {
        const s = new HubSerial(path, baud);
        try {
            await s.open();
            // The R4 does not reset when the port opens, so there is no
            // bootloader pause to wait out; a short settle is still kinder to
            // the driver than writing immediately.
            await new Promise((r) => setTimeout(r, 250));
            const o = await s.request({ t: 'info' }, (x) => x.t === 'info', PROBE_TIMEOUT_MS);
            return { link: s, info: o };
        } catch (e) {
            await s.close();
            return null;
        }
    }

    async function findHub(log) {
        if (!SerialPort) { log(tr('noSerial'), 'error'); return null; }
        log(tr('scanning'));
        let ports = [];
        try { ports = await SerialPort.list(); } catch (e) { ports = []; }
        if (!ports.length) { log(tr('noPorts'), 'error'); return null; }

        // Arduino-ish ports first so the common case costs one probe.
        ports.sort((a, b) => {
            const score = (p) => (/arduino|renesas|wch|silicon|ftdi/i.test(
                (p.manufacturer || '') + ' ' + (p.friendlyName || '')) ? 0 : 1);
            return score(a) - score(b);
        });

        for (const p of ports) {
            for (const baud of BAUDS) {
                const hit = await probePort(p.path, baud);
                if (hit) {
                    log(fmt(tr('found'), p.path, baud), 'ok');
                    return hit;
                }
            }
        }
        log(tr('noHub'), 'error');
        return null;
    }

    // --- UI ---------------------------------------------------------------
    let modalEl = null;

    function ensureModal() {
        if (modalEl && document.body.contains(modalEl)) return modalEl;
        modalEl = document.createElement('div');
        modalEl.id = 'usbConfigModal';
        modalEl.style.cssText =
            'position:fixed;inset:0;display:none;align-items:center;justify-content:center;' +
            'background:rgba(0,0,0,.45);z-index:100001;' +
            'font:14px/1.45 -apple-system,Segoe UI,sans-serif;';
        modalEl.innerHTML =
            '<div style="background:#fff;color:#111;border-radius:8px;width:560px;' +
            'max-width:94vw;max-height:90vh;overflow:auto;padding:18px 20px;' +
            'box-shadow:0 8px 32px rgba(0,0,0,.35);">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
                '<h5 id="usbTitle" style="margin:0;font:600 17px/1.2 inherit;"></h5>' +
                '<button id="usbClose" type="button" style="background:none;border:0;' +
                  'font-size:20px;cursor:pointer;color:#555;">&times;</button>' +
              '</div>' +
              '<div id="usbIntro" style="font-size:13px;color:#555;margin-bottom:10px;"></div>' +
              '<div id="usbBatt" style="display:none;margin-bottom:10px;padding:8px 10px;' +
                'border-radius:4px;font-size:13px;"></div>' +
              '<div id="usbStatus" style="margin-bottom:10px;padding:8px 10px;background:#f4f4f5;' +
                'border-radius:4px;font-size:13px;min-height:1.4em;"></div>' +
              '<div id="usbIdentity" style="display:none;margin-bottom:12px;font-size:13px;' +
                'color:#334155;"></div>' +
              '<div id="usbForms" style="display:none;"></div>' +
              '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">' +
                '<button id="usbSearch" type="button"></button>' +
                '<button id="usbCancel" type="button"></button>' +
              '</div>' +
            '</div>';
        document.body.appendChild(modalEl);

        const btn = 'padding:6px 14px;border:1px solid #cbd5e1;background:#f8fafc;' +
                    'color:#0f172a;border-radius:4px;cursor:pointer;font:inherit;';
        document.getElementById('usbSearch').style.cssText = btn;
        document.getElementById('usbCancel').style.cssText = btn;
        document.getElementById('usbClose').addEventListener('click', close);
        document.getElementById('usbCancel').addEventListener('click', close);
        document.getElementById('usbSearch').addEventListener('click', connect);
        modalEl.addEventListener('click', (ev) => { if (ev.target === modalEl && !busy) close(); });
        return modalEl;
    }

    function status(msg, cls) {
        const el = document.getElementById('usbStatus');
        if (!el) return;
        el.textContent = msg;
        el.style.color = cls === 'error' ? '#dc2626' : (cls === 'ok' ? '#059669' : '#334155');
    }

    function renderBattery() {
        const el = document.getElementById('usbBatt');
        if (!el || !info || typeof info.batt !== 'number') { if (el) el.style.display = 'none'; return; }
        const v = info.batt;
        if (v >= BATT_LOW) { el.style.display = 'none'; return; }
        const crit = v < BATT_CRIT;
        el.style.display = 'block';
        el.style.background = crit ? '#fee2e2' : '#fef3c7';
        el.style.color      = crit ? '#991b1b' : '#92400e';
        el.textContent = fmt(tr(crit ? 'battCrit' : 'battLow'), v.toFixed(2));
    }

    // The SSID the hub will broadcast after its next restart. The firmware
    // builds it as "<name>-<mac>" for a named hub and "MBR4-<mac>" otherwise,
    // and an unnamed hub's name IS "MBR4-<mac>" — so appending the suffix
    // unless it is already there reproduces it exactly, without spending
    // frame bytes the runtime does not have to spare.
    function apAfterRestart() {
        if (!info || !info.name || !info.mac) return null;
        const suffix = '-' + info.mac;
        return info.name.endsWith(suffix) ? info.name : info.name + suffix;
    }

    function renderIdentity() {
        const el = document.getElementById('usbIdentity');
        if (!el || !info) return;
        el.style.display = 'block';
        const mode = info.mode === 'ap' ? tr('modeAp') : tr('modeSta');
        let html =
            '<b>' + esc(info.name || '?') + '</b> · ' + esc(info.mac || '') +
            ' · ' + tr('fwLabel') + ' ' + esc(info.fw || '?') +
            '<br>' + esc(mode) + ' · ' + tr('storedNet') + ': ' +
            (info.ssid ? esc(info.ssid) : tr('none')) +
            (typeof info.batt === 'number' ? ' · ' + info.batt.toFixed(2) + ' V' : '');

        // Which WiFi to actually join — the question the user is really
        // asking when the robot "cannot be found".
        if (info.mode === 'ap' && info.ap) {
            html += '<div style="margin-top:8px;padding:8px 10px;background:#eff6ff;' +
                    'border-radius:4px;color:#1e40af;">' +
                    tr('apNow') + ' <b>' + esc(info.ap) + '</b>';
            const next = apAfterRestart();
            if (next && next !== info.ap) {
                html += '<br><span style="color:#92400e;">' +
                        fmt(tr('apChange'), esc(next)) + '</span>';
            }
            html += '</div>';
        }
        el.innerHTML = html;
    }

    function field(id, label, value, hint, type) {
        return '<label style="display:block;margin-bottom:8px;">' +
                 '<span style="display:block;font-weight:600;margin-bottom:2px;">' + esc(label) + '</span>' +
                 '<input id="' + id + '" type="' + (type || 'text') + '" value="' + esc(value || '') + '" ' +
                   'style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:4px;font:inherit;">' +
                 (hint ? '<span style="display:block;font-size:12px;color:#64748b;margin-top:2px;">' +
                          esc(hint) + '</span>' : '') +
               '</label>';
    }

    function renderForms() {
        const box = document.getElementById('usbForms');
        if (!box || !info) return;
        box.style.display = 'block';
        const mac = info.mac || 'xxxx';
        const section = (title, body) =>
            '<fieldset style="border:1px solid #e5e7eb;border-radius:6px;padding:10px 12px;margin-bottom:12px;">' +
              '<legend style="font-size:13px;font-weight:600;padding:0 6px;">' + esc(title) + '</legend>' +
              body + '</fieldset>';

        box.innerHTML =
            section(tr('secName'),
                field('usbName', tr('fName'), info.name, fmt(tr('nameHint'), mac)) +
                '<button id="usbSaveName" type="button"></button>') +
            section(tr('secWifi'),
                field('usbSsid', tr('fSsid'), info.ssid, tr('wifiHint')) +
                field('usbPass', tr('fPass'), '', '', 'password') +
                '<button id="usbSaveWifi" type="button"></button> ' +
                '<button id="usbClearWifi" type="button"></button>') +
            section(tr('secAp'),
                field('usbApPass', tr('fApPass'), '', tr('apHint'), 'text') +
                '<button id="usbSaveAp" type="button"></button>') +
            section(tr('secDanger'),
                '<button id="usbForgetVm" type="button"></button> ' +
                '<button id="usbReboot" type="button"></button> ' +
                '<button id="usbFactory" type="button"></button>');

        const primary = 'padding:6px 14px;border:0;background:#0ea5e9;color:#fff;' +
                        'border-radius:4px;cursor:pointer;font:inherit;font-weight:600;';
        const plain   = 'padding:6px 14px;border:1px solid #cbd5e1;background:#f8fafc;' +
                        'color:#0f172a;border-radius:4px;cursor:pointer;font:inherit;';
        const danger  = 'padding:6px 14px;border:1px solid #dc2626;background:#fff;' +
                        'color:#dc2626;border-radius:4px;cursor:pointer;font:inherit;';
        const set = (id, text, css, fn) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.textContent = text;
            el.style.cssText = css;
            el.addEventListener('click', () => guard(fn));
        };
        set('usbSaveName',  tr('save'),      primary, saveName);
        set('usbSaveWifi',  tr('save'),      primary, saveWifi);
        set('usbClearWifi', tr('clearWifi'), plain,   clearWifi);
        set('usbSaveAp',    tr('save'),      primary, saveAp);
        set('usbForgetVm',  tr('forgetVm'),  plain,   forgetVm);
        set('usbReboot',    tr('reboot'),    plain,   reboot);
        set('usbFactory',   tr('factory'),   danger,  factory);
    }

    async function guard(fn) {
        if (busy || !link) return;
        busy = true;
        try { await fn(); }
        catch (e) { status(fmt(tr('failed'), (e && e.message) || String(e)), 'error'); }
        finally { busy = false; }
    }

    function val(id) {
        const el = document.getElementById(id);
        return el ? el.value.trim() : '';
    }

    async function refreshInfo() {
        info = await link.request({ t: 'info' }, (o) => o.t === 'info');
        renderIdentity();
        renderBattery();
    }

    async function ackOr(cmd, obj, okMsg) {
        const a = await link.request(obj, (o) => o.t === 'ack' && o.cmd === cmd, 6000);
        if (!a.ok) throw new Error(a.err || cmd);
        status(okMsg, 'ok');
        await refreshInfo();
    }

    const saveName  = () => ackOr('setname', { t: 'setname', name: val('usbName') }, tr('statusName'));
    const saveWifi  = () => ackOr('setwifi',
        { t: 'setwifi', ssid: val('usbSsid'), pass: val('usbPass') }, tr('statusWifi'));
    const clearWifi = () => ackOr('setwifi', { t: 'setwifi', ssid: '', pass: '' }, tr('statusWifiClr'));
    const saveAp    = () => ackOr('setappass', { t: 'setappass', pass: val('usbApPass') }, tr('statusAp'));
    const forgetVm  = () => ackOr('vm_forget', { t: 'vm_forget' }, tr('statusVm'));

    async function reboot() {
        await link.request({ t: 'reboot' }, (o) => o.t === 'ack' && o.cmd === 'reboot', 4000);
        status(tr('statusReboot'), 'ok');
        // The board resets: the port drops. Reconnect once it is back rather
        // than leaving a dead handle behind.
        await link.close();
        link = null;
        setTimeout(connect, 6000);
    }

    async function factory() {
        if (!window.confirm(fmt(tr('factoryWarn'), (info && info.mac) || 'xxxx'))) return;
        await link.request({ t: 'factory' }, (o) => o.t === 'ack' && o.cmd === 'factory', 6000);
        status(tr('statusFactory'), 'ok');
        // The runtime reboots itself once after a factory reset to come back
        // with a clean AP bring-up, so give it longer than a plain restart.
        await link.request({ t: 'reboot' }, (o) => o.t === 'ack' && o.cmd === 'reboot', 3000)
            .catch(() => {});
        await link.close();
        link = null;
        setTimeout(connect, 9000);
    }

    async function connect() {
        if (busy) return;
        busy = true;
        document.getElementById('usbIdentity').style.display = 'none';
        document.getElementById('usbForms').style.display = 'none';
        try {
            if (link) { await link.close(); link = null; }
            const hit = await findHub(status);
            if (!hit) return;
            link = hit.link;
            info = hit.info;
            renderIdentity();
            renderBattery();
            renderForms();
        } catch (e) {
            status(fmt(tr('failed'), (e && e.message) || String(e)), 'error');
        } finally {
            busy = false;
        }
    }

    async function close() {
        if (busy) return;
        if (link) { await link.close(); link = null; }
        if (modalEl) modalEl.style.display = 'none';
    }

    function open() {
        ensureModal();
        document.getElementById('usbTitle').textContent  = tr('title');
        document.getElementById('usbIntro').textContent  = tr('intro');
        document.getElementById('usbSearch').textContent = tr('search');
        document.getElementById('usbCancel').textContent = tr('close');
        status('');
        modalEl.style.display = 'flex';
        connect();
    }

    // --- Nav button --------------------------------------------------------
    function installButton() {
        const anchor = document.getElementById('vmDebugNavLink')
                    || document.getElementById('vmUploadNavLink')
                    || document.getElementById('wifiUploadNavLink');
        if (!anchor || document.getElementById('usbConfigNavLink')) return;
        const b = document.createElement('a');
        b.className = 'nav-link d-flex align-items-center active';
        b.id = 'usbConfigNavLink';
        b.title = tr('btnTitle');
        b.style.cursor = 'pointer';
        b.innerHTML = '<i class="bi bi-usb-symbol" style="color:#0ea5e9"></i>' +
                      '<span id="usbConfigLabel">&nbsp;' + tr('btnLabel') + '</span>';
        b.addEventListener('click', (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            open();
        });
        anchor.parentNode.insertBefore(b, anchor.nextSibling);
    }

    window.MBR4UsbConfig = {
        open,
        _findHub: findHub,
        _state: () => ({ connected: !!link, info }),
    };

    console.log('[USB] usb_config.js module loaded');
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', installButton);
    } else {
        installButton();
    }
    setTimeout(installButton, 1500);
    setTimeout(installButton, 3000);
    setTimeout(installButton, 6000);
})();
