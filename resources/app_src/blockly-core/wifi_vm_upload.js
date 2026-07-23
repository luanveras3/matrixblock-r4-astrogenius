'use strict';
/*
 * MATRIXblock WiFi VM uploader (feature/wifi-tcp-ota, R2).
 *
 * Third upload path alongside "Enviar via WiFi" (OTA) and USB:
 *   Blockly workspace → Blockly.BytecodeVM.compile → ~1-4 KB bytecode →
 *   chunked NDJSON send over TCP → robot's ephemeral VM runs it in < 1 s.
 *
 * Why this exists: OTA is the correct path for the final program (100%
 * block coverage, no size limit, but ~20 s per iteration because it
 * recompiles firmware). The VM path takes seconds per iteration —
 * perfect for the classroom "try a small change" workflow. Bytecode
 * lives entirely in RAM; a reboot or OTA wipes it. Users pick VM for
 * iteration, OTA to commit.
 *
 * Protocol (documented in MiniR4WiFiRuntime.cpp _handleVm*):
 *   {"t":"vm_start","size":N}          → server: reset, prepare to receive
 *   {"t":"vm_chunk","d":"<base64>"}    → append (many)
 *   {"t":"vm_end","run":true}          → validate & optionally auto-run
 *   {"t":"vm_stop"}                    → halt VM (userLoop takes back over)
 *
 * Coordination: same pause/resume dance as OTA — window.MBR4Hud.pause()
 * releases the runtime's single TCP slot, we upload, resume() re-attaches
 * the HUD to see the VM's live state.
 */
(function () {
    if (!window.MBR4WiFi) {
        console.warn('[VM] MBR4WiFi API not present — wifi_upload.js must load first.');
        return;
    }
    const { RobotClient, discover } = window.MBR4WiFi;

    // Firmware ceiling: MiniR4WiFiRuntime.cpp VM_MAX_PROGRAM (4096). Keep
    // both in sync when changing either — the size check here is the
    // student-facing error, the runtime's is the truth.
    const VM_MAX_BYTES = 4096;
    const CHUNK_BYTES  = 96;   // encoded ~128 chars ≪ 192 B _lineBuf cap
    const TCP_PORT     = 47802;

    // --- i18n (self-contained; matches wifi_upload.js pattern) --------------
    const STRINGS = {
        en: {
            btnLabel:        'Send VM (fast)',
            btnTitle:        'Compile blocks to bytecode and run instantly on the robot',
            modalTitle:      'Send VM (fast)',
            searching:       'Searching for robots...',
            noneFound:       'No robot found. Check that the hub is on the same network. Windows Firewall may need to be allowed on first search.',
            close:           'Close',
            send:            'Send',
            stop:            'Stop VM',
            phase_compile:   'Compiling blocks to bytecode...',
            phase_send:      'Uploading %d bytes to %s...',
            phase_chunk:     'Uploading %d%% (%d/%d)',
            phase_run:       'Starting VM...',
            done:            'Done! VM running (%d bytes in %d ms, %d B/s).',
            stopped:         'VM stopped.',
            stopFail:        'Could not stop the VM (%s).',
            emptyWorkspace:  'The workspace is empty.',
            compiledOK:      'Compiled: %d bytes (%d variable(s)).',
            trivial:         'Compiled payload is tiny (%d bytes) — most blocks are unsupported by the VM. USB or Send-via-WiFi still work fully.',
            overCap:         'Program too large: %d bytes (max %d). Use Send-via-WiFi (OTA) for the full program instead.',
            unsupported:     '%d unsupported block(s) skipped; check the browser console for details.',
            compileFail:     'Compile failed: %s',
            connectFail:     'Could not reach %s: %s',
            noAck:           'The robot did not ack in time (%s).',
            uploadFail:      'Upload failed at chunk %d: %s',
        },
        'pt-BR': {
            btnLabel:        'Enviar VM (rápido)',
            btnTitle:        'Compilar blocos para bytecode e rodar no robô na hora',
            modalTitle:      'Enviar VM (rápido)',
            searching:       'Procurando robôs...',
            noneFound:       'Nenhum robô encontrado. Confira se o robô está na mesma rede. Pode ser preciso liberar o Firewall do Windows na primeira busca.',
            close:           'Fechar',
            send:            'Enviar',
            stop:            'Parar VM',
            phase_compile:   'Compilando blocos para bytecode...',
            phase_send:      'Enviando %d bytes para %s...',
            phase_chunk:     'Enviando %d%% (%d/%d)',
            phase_run:       'Iniciando VM...',
            done:            'Pronto! VM rodando (%d bytes em %d ms, %d B/s).',
            stopped:         'VM parada.',
            stopFail:        'Não consegui parar a VM (%s).',
            emptyWorkspace:  'A área de blocos está vazia.',
            compiledOK:      'Compilado: %d bytes (%d variável/is).',
            trivial:         'Bytecode gerado é minúsculo (%d bytes) — a maioria dos blocos não é suportada pela VM. USB ou Enviar via WiFi seguem funcionando.',
            overCap:         'Programa grande demais: %d bytes (máx %d). Use Enviar via WiFi (OTA) para o programa completo.',
            unsupported:     '%d bloco(s) não suportado(s) foram pulados; veja detalhes no console.',
            compileFail:     'Falha ao compilar: %s',
            connectFail:     'Não consegui falar com %s: %s',
            noAck:           'O robô não respondeu no tempo esperado (%s).',
            uploadFail:      'Envio falhou no chunk %d: %s',
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

    // --- Base64 (no deps; browser has atob/btoa but we need Uint8Array) ------
    function bytesToB64(bytes) {
        // btoa wants a binary string; chunk to avoid apply-arg limit on large
        // programs (4 KB fits easily but keep safe).
        let s = '';
        const CHUNK = 0x8000;
        for (let i = 0; i < bytes.length; i += CHUNK) {
            s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
        }
        return btoa(s);
    }

    // --- Compile helpers ----------------------------------------------------
    function workspace() {
        return Blockly.getMainWorkspace ? Blockly.getMainWorkspace()
                                        : Blockly.mainWorkspace;
    }
    function compileWorkspace() {
        const ws = workspace();
        if (!ws) throw new Error('no workspace');
        if (ws.getAllBlocks && ws.getAllBlocks(false).length === 0) {
            const e = new Error(tr('emptyWorkspace'));
            e.empty = true;
            throw e;
        }
        if (!Blockly.BytecodeVM || typeof Blockly.BytecodeVM.compile !== 'function') {
            throw new Error('Blockly.BytecodeVM.compile unavailable');
        }
        return Blockly.BytecodeVM.compile(ws);
    }

    // --- Upload orchestration ------------------------------------------------
    let busy = false;

    async function sendVmTo(robot, ui) {
        const t0 = Date.now();
        ui.phase(tr('phase_compile'));
        let compiled;
        try {
            compiled = compileWorkspace();
        } catch (e) {
            if (e.empty)   { ui.log(e.message, 'error'); return; }
            if (e.overCap) { ui.log(fmt(tr('overCap'), e.byteSize || 0, VM_MAX_BYTES), 'error'); return; }
            ui.log(fmt(tr('compileFail'), e.message), 'error');
            return;
        }
        const bytes    = compiled.bytes;
        const varCount = Object.keys(compiled.variables || {}).length;
        ui.log(fmt(tr('compiledOK'), bytes.length, varCount), 'ok');
        if (compiled.warnings && compiled.warnings.length) {
            ui.log(fmt(tr('unsupported'), compiled.warnings.length), 'error');
            compiled.warnings.forEach((w) => console.warn('[VM] skipped:', w));
        }
        if (bytes.length <= 1) { ui.log(fmt(tr('trivial'), bytes.length), 'error'); return; }
        if (bytes.length > VM_MAX_BYTES) {
            ui.log(fmt(tr('overCap'), bytes.length, VM_MAX_BYTES), 'error');
            return;
        }

        ui.phase(fmt(tr('phase_send'), bytes.length, robot.name || robot.ip));
        const client = new RobotClient(robot.ip);
        try {
            await client.connect(4000);
        } catch (e) {
            ui.log(fmt(tr('connectFail'), robot.ip, e.message), 'error');
            return;
        }

        try {
            // vm_start
            const startAck = await client.request(
                { t: 'vm_start', size: bytes.length },
                (o) => o.t === 'ack' && o.cmd === 'vm_start', 4000);
            if (!startAck.ok) throw new Error('vm_start rejected: ' + (startAck.err || ''));

            // chunks
            for (let off = 0, i = 0; off < bytes.length; off += CHUNK_BYTES, i++) {
                const slice = bytes.subarray(off, Math.min(off + CHUNK_BYTES, bytes.length));
                const b64   = bytesToB64(slice);
                let ack;
                try {
                    ack = await client.request(
                        { t: 'vm_chunk', d: b64 },
                        (o) => o.t === 'ack' && o.cmd === 'vm_chunk', 3000);
                } catch (e) {
                    ui.log(fmt(tr('uploadFail'), i, e.message), 'error');
                    return;
                }
                if (!ack.ok) throw new Error(fmt(tr('uploadFail'), i, ack.err || 'reject'));
                const done = Math.min(off + slice.length, bytes.length);
                const pct  = Math.round((done / bytes.length) * 100);
                ui.phase(fmt(tr('phase_chunk'), pct, done, bytes.length), pct);
            }

            // vm_end with run:true — one round-trip instead of two
            ui.phase(tr('phase_run'), 100);
            const endAck = await client.request(
                { t: 'vm_end', run: true },
                (o) => o.t === 'ack' && (o.cmd === 'vm_end' || o.cmd === 'vm_run'), 4000);
            if (!endAck.ok) throw new Error('vm_end rejected: ' + (endAck.err || ''));

            const dtMs  = Date.now() - t0;
            const bps   = Math.round(bytes.length / (dtMs / 1000));
            ui.log(fmt(tr('done'), bytes.length, dtMs, bps), 'ok');
        } catch (e) {
            ui.log(e.message || String(e), 'error');
        } finally {
            client.close();
        }
    }

    async function stopVmOn(robot, ui) {
        const client = new RobotClient(robot.ip);
        try {
            await client.connect(4000);
            const ack = await client.request({ t: 'vm_stop' },
                (o) => o.t === 'ack' && o.cmd === 'vm_stop', 3000);
            ui.log(ack.ok ? tr('stopped') : fmt(tr('stopFail'), ack.err || ''),
                   ack.ok ? 'ok' : 'error');
        } catch (e) {
            ui.log(fmt(tr('stopFail'), e.message), 'error');
        } finally {
            client.close();
        }
    }

    // --- Modal UI ------------------------------------------------------------
    let modalEl = null;
    function ensureModal() {
        if (modalEl && document.body.contains(modalEl)) return modalEl;
        modalEl = document.createElement('div');
        modalEl.id = 'vmControlModal';
        modalEl.style.cssText =
            'position:fixed;inset:0;display:none;align-items:center;' +
            'justify-content:center;background:rgba(0,0,0,.45);' +
            'z-index:100000;font:14px/1.4 -apple-system,Segoe UI,sans-serif;';
        modalEl.innerHTML =
            '<div style="background:#fff;color:#111;border-radius:8px;' +
            'width:520px;max-width:94vw;max-height:88vh;overflow:auto;' +
            'padding:18px 20px;box-shadow:0 8px 32px rgba(0,0,0,.35);">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
                '<h5 id="vmModalTitle" style="margin:0;font:600 16px/1.2 inherit;"></h5>' +
                '<button id="vmModalClose" type="button" style="background:none;border:0;font-size:20px;cursor:pointer;color:#555;">&times;</button>' +
              '</div>' +
              '<div id="vmRobotList"></div>' +
              '<div id="vmProgressWrap" style="display:none;margin:12px 0;">' +
                '<div id="vmPhaseText" style="font-weight:600;margin-bottom:6px;"></div>' +
                '<div style="background:#e5e7eb;border-radius:6px;height:10px;overflow:hidden;">' +
                  '<div id="vmProgressBar" style="background:#f59e0b;height:100%;width:0%;transition:width .12s;"></div>' +
                '</div>' +
              '</div>' +
              '<div id="vmModalLog" style="margin:12px 0;padding:8px 10px;background:#f4f4f5;' +
                'border-radius:4px;font-family:monospace;font-size:12px;color:#333;' +
                'max-height:180px;overflow:auto;white-space:pre-wrap;"></div>' +
              '<div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">' +
                '<button id="vmModalCancel" type="button" style="padding:6px 14px;border:1px solid #64748b;background:#fff;color:#64748b;border-radius:4px;cursor:pointer;"></button>' +
              '</div>' +
            '</div>';
        document.body.appendChild(modalEl);
        modalEl.addEventListener('click', (ev) => { if (ev.target === modalEl && !busy) closeModal(); });
        document.getElementById('vmModalClose').addEventListener('click', () => { if (!busy) closeModal(); });
        document.getElementById('vmModalCancel').addEventListener('click', () => { if (!busy) closeModal(); });
        return modalEl;
    }
    function closeModal() { if (modalEl) modalEl.style.display = 'none'; }
    function modalUi() {
        const logEl  = document.getElementById('vmModalLog');
        const wrap   = document.getElementById('vmProgressWrap');
        const phase  = document.getElementById('vmPhaseText');
        const bar    = document.getElementById('vmProgressBar');
        return {
            log: (msg, cls) => {
                const line = document.createElement('div');
                if (cls === 'error') line.style.color = '#dc2626';
                if (cls === 'ok')    line.style.color = '#059669';
                line.textContent = msg;
                logEl.appendChild(line);
                logEl.scrollTop = logEl.scrollHeight;
                console.log('[VM] ' + msg);
            },
            phase: (msg, pct) => {
                wrap.style.display = 'block';
                phase.textContent = msg;
                if (typeof pct === 'number') bar.style.width = pct + '%';
            },
        };
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[c]));
    }
    function robotRow(robot) {
        const row = document.createElement('div');
        row.style.cssText =
            'display:flex;align-items:center;gap:10px;padding:10px 12px;' +
            'border:1px solid #e5e7eb;border-radius:6px;margin-bottom:8px;';
        const info = document.createElement('div');
        info.style.cssText = 'flex:1;min-width:0;';
        info.innerHTML =
            '<div style="font-weight:600;">' + escapeHtml(robot.name || robot.ip) + '</div>' +
            '<div style="font-size:12px;color:#666;">' + escapeHtml(robot.ip) + ' · fw ' +
                escapeHtml(robot.fw || '?') + '</div>';
        const stop = document.createElement('button');
        stop.type = 'button';
        stop.textContent = tr('stop');
        stop.style.cssText =
            'padding:6px 10px;border:1px solid #dc2626;background:#fff;color:#dc2626;' +
            'border-radius:4px;cursor:pointer;';
        stop.addEventListener('click', () => driveAction(robot, stopVmOn));
        const send = document.createElement('button');
        send.type = 'button';
        send.textContent = tr('send');
        send.style.cssText =
            'padding:6px 14px;border:0;background:#f59e0b;color:#fff;' +
            'border-radius:4px;cursor:pointer;font-weight:600;';
        send.addEventListener('click', () => driveAction(robot, sendVmTo));
        row.appendChild(info);
        row.appendChild(stop);
        row.appendChild(send);
        return row;
    }

    // Shared wrapper for both Send and Stop: pause HUD, run action, resume.
    async function driveAction(robot, action) {
        if (busy) return;
        busy = true;
        const ui = modalUi();
        document.getElementById('vmRobotList').style.display = 'none';
        document.getElementById('vmProgressWrap').style.display = 'none';
        if (window.MBR4Hud) await window.MBR4Hud.pause();
        try {
            await action(robot, ui);
        } catch (e) {
            ui.log((e && e.message) || String(e), 'error');
        } finally {
            busy = false;
            if (window.MBR4Hud) window.MBR4Hud.resume();
            const list = document.getElementById('vmRobotList');
            if (list) list.style.display = 'block';
        }
    }

    async function refreshList() {
        ensureModal();
        const list = document.getElementById('vmRobotList');
        const ui   = modalUi();
        list.innerHTML = '';
        list.style.display = 'block';
        ui.log(tr('searching'));
        // Same coordination: pause HUD during discovery to keep the modem's
        // UDP responses uncluttered by our own telemetry stream noise. Not
        // strictly required (UDP != TCP slot) but keeps things predictable.
        const robots = await discover(1800);
        list.innerHTML = '';
        if (!robots.length) { ui.log(tr('noneFound'), 'error'); return; }
        robots.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        for (const r of robots) list.appendChild(robotRow(r));
    }

    function openModal() {
        ensureModal();
        refreshAllLabels();
        document.getElementById('vmModalLog').textContent = '';
        document.getElementById('vmProgressWrap').style.display = 'none';
        modalEl.style.display = 'flex';
        refreshList();
    }

    function refreshAllLabels() {
        const set = (id, key) => {
            const el = document.getElementById(id);
            if (el) el.textContent = tr(key);
        };
        set('vmModalTitle',  'modalTitle');
        set('vmModalCancel', 'close');
        const span = document.getElementById('vmUploadButton');
        if (span) span.innerHTML = '&nbsp;' + tr('btnLabel');
        const link = document.getElementById('vmUploadNavLink');
        if (link) link.title = tr('btnTitle');
    }

    // --- Nav button ----------------------------------------------------------
    function installButton() {
        const anchor = document.getElementById('wifiUploadNavLink')
                    || document.getElementById('uploadNavLink');
        if (!anchor) return;
        if (document.getElementById('vmUploadNavLink')) return;
        const parent = anchor.parentNode;
        const b = document.createElement('a');
        b.className = 'nav-link d-flex align-items-center active';
        b.id = 'vmUploadNavLink';
        b.title = tr('btnTitle');
        b.style.cursor = 'pointer';
        // Icon: lightning for "fast". Amber ties visually to the VM (vs teal
        // for the always-on WiFi/OTA family).
        b.innerHTML =
            '<i class="bi bi-lightning-charge" style="color:#f59e0b"></i>' +
            '<span id="vmUploadButton">&nbsp;' + tr('btnLabel') + '</span>';
        b.addEventListener('click', (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            openModal();
        });
        // Insert right after the WiFi upload button, before the connect/hud
        // affordances that other modules might add.
        parent.insertBefore(b, anchor.nextSibling);

        if (!window.__vmLocaleWatcherStarted) {
            window.__vmLocaleWatcherStarted = true;
            let last = locale();
            setInterval(() => {
                if (locale() !== last) { last = locale(); refreshAllLabels(); }
            }, 1000);
        }
    }

    window.MBR4VM = { openModal, _sendVmTo: sendVmTo, _stopVmOn: stopVmOn };

    console.log('[VM] wifi_vm_upload.js module loaded');
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', installButton);
    } else {
        installButton();
    }
    setTimeout(installButton, 1500);
    setTimeout(installButton, 3000);
    setTimeout(installButton, 5000);
})();
