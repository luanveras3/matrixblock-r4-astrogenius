'use strict';
/*
 * MATRIXblock live block debugger (feature/wifi-tcp-ota, R2).
 *
 * Shows which block the robot is executing, right now, in the workspace the
 * student is looking at — plus pause / step / breakpoints and a live view of
 * the VM's variables.
 *
 * How the pieces fit:
 *   bytecode.js       compiles the workspace and hands back a `blockMap`
 *                     ([{pc, blockId}], ascending) — the map stays here, in
 *                     the IDE; the robot never sees it.
 *   MiniR4WiFiRuntime streams {"t":"pc","addr":N,"run":0|1} while debugging
 *                     is on, and answers vm_pause / vm_resume / vm_step /
 *                     vm_break / vm_vars.
 *   this module       resolves addr -> blockId (binary search) and glows
 *                     that block; breakpoints are stored per block id and
 *                     translated to pcs through the same map.
 *
 * Transport: the runtime accepts ONE TCP client, so everything rides the
 * HUD's connection through MBR4Hud.send/onFrame/onConnect. That also means
 * robot-side debug state must be re-armed on every reconnect — the hub
 * forgets it when the socket drops — which is what the onConnect hook is for.
 *
 * Breakpoints are keyed by block id rather than pc so they survive a
 * recompile: the student marks "stop at THIS block", and the pc that block
 * compiles to changes the moment anything above it is edited.
 */
(function () {
    // Highlight cadence is bounded by the robot: pc frames arrive at ~10 Hz
    // because every outgoing frame costs a synchronous ~100 ms modem write
    // (the same ceiling that caps telemetry at ~9.4 Hz). Asking for more
    // would starve telemetry without moving the highlight.
    const PC_HZ = 10;

    // --- i18n (same self-contained pattern as the sibling modules) ----------
    const STRINGS = {
        en: {
            btnTitle:     'Live block debug: follow the running block, pause, step',
            panelTitle:   'Live debug',
            debugOn:      'Debug on',
            debugOff:     'Debug off',
            pause:        'Pause',
            resume:       'Resume',
            step:         'Step',
            clearBreaks:  'Clear breakpoints',
            varsTitle:    'Variables',
            noVars:       'This program uses no variables.',
            statusIdle:   'Waiting for a VM program. Send one with "Send VM (fast)".',
            statusRun:    'Running',
            statusPaused: 'Paused',
            statusOffline:'Not connected to a robot.',
            noMap:        'Send the program from this window first — the debugger needs the map that upload produces.',
            bpAdd:        'Add breakpoint',
            bpRemove:     'Remove breakpoint',
            bpFull:       'The robot holds at most %d breakpoints; remove one first.',
            bpUnmapped:   'This block emitted no code, so it cannot hold a breakpoint.',
            atBlock:      'at pc %d',
        },
        'pt-BR': {
            btnTitle:     'Depuração ao vivo: acompanhe o bloco em execução, pause, avance',
            panelTitle:   'Depuração ao vivo',
            debugOn:      'Depuração ligada',
            debugOff:     'Depuração desligada',
            pause:        'Pausar',
            resume:       'Continuar',
            step:         'Avançar 1',
            clearBreaks:  'Limpar pontos de parada',
            varsTitle:    'Variáveis',
            noVars:       'Este programa não usa variáveis.',
            statusIdle:   'Esperando um programa da VM. Envie um com "Enviar VM (rápido)".',
            statusRun:    'Rodando',
            statusPaused: 'Pausado',
            statusOffline:'Sem conexão com um robô.',
            noMap:        'Envie o programa por esta janela primeiro — a depuração precisa do mapa que o envio gera.',
            bpAdd:        'Colocar ponto de parada',
            bpRemove:     'Tirar ponto de parada',
            bpFull:       'O robô guarda no máximo %d pontos de parada; tire um antes.',
            bpUnmapped:   'Este bloco não gerou código, então não pode receber ponto de parada.',
            atBlock:      'no pc %d',
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

    // Mirrors VM_MAX_BREAKPOINTS in MiniR4WiFiRuntime.h. The firmware is the
    // authority (it nacks past the limit); this only produces a better error.
    const MAX_BREAKPOINTS = 8;

    // --- State ---------------------------------------------------------------
    let enabled     = false;   // debug stream requested
    let paused      = false;
    let blockMap    = [];      // [{pc, blockId}] from the last upload
    let varNames    = {};      // name -> slot
    let currentId   = null;    // block currently glowing
    let breakIds    = [];      // block ids, in user order
    let varsTimer   = null;
    let panelEl     = null;

    function workspace() {
        try {
            return Blockly.getMainWorkspace ? Blockly.getMainWorkspace()
                                            : Blockly.mainWorkspace;
        } catch (e) { return null; }
    }

    // --- pc -> block ---------------------------------------------------------
    function blockAtPc(pc) {
        if (Blockly.BytecodeVM && Blockly.BytecodeVM.blockAtPc) {
            return Blockly.BytecodeVM.blockAtPc(blockMap, pc);
        }
        return null;
    }

    // Lowest pc a block owns — what a breakpoint on that block means. Several
    // entries can share a block id only if the compiler emitted it twice,
    // which it does not; taking the first is still the safe reading.
    function pcOfBlock(blockId) {
        for (let i = 0; i < blockMap.length; i++) {
            if (blockMap[i].blockId === blockId) return blockMap[i].pc;
        }
        return null;
    }

    // --- Highlighting --------------------------------------------------------
    // Blockly's own glow is the right affordance here: it is the same visual
    // language the editor already uses for "this stack is running", so
    // students do not have to learn a second convention.
    function setGlow(blockId, on) {
        const ws = workspace();
        if (!ws || !blockId) return;
        try {
            const b = ws.getBlockById(blockId);
            if (b) ws.glowBlock(blockId, on);
        } catch (e) { /* block may have been deleted mid-run */ }
    }

    function highlight(blockId) {
        if (blockId === currentId) return;
        if (currentId) setGlow(currentId, false);
        currentId = blockId;
        if (currentId) setGlow(currentId, true);
    }

    function clearHighlight() { highlight(null); }

    // --- Breakpoint marks ----------------------------------------------------
    // Blockly has no breakpoint concept, so the mark is a CSS class we add to
    // the block's SVG group; the stylesheet below draws the red gutter dot.
    function paintBreak(blockId, on) {
        const ws = workspace();
        if (!ws) return;
        try {
            const b = ws.getBlockById(blockId);
            const g = b && b.getSvgRoot && b.getSvgRoot();
            if (!g) return;
            if (on) g.classList.add('mbr4-breakpoint');
            else    g.classList.remove('mbr4-breakpoint');
        } catch (e) {}
    }

    function repaintBreaks() {
        for (const id of breakIds) paintBreak(id, true);
    }

    function injectStyle() {
        if (document.getElementById('mbr4DebugStyle')) return;
        const s = document.createElement('style');
        s.id = 'mbr4DebugStyle';
        s.textContent =
            '.mbr4-breakpoint > .blocklyPath {' +
              'stroke:#dc2626 !important;stroke-width:3px !important;' +
              'stroke-dasharray:6 3 !important;}';
        document.head.appendChild(s);
    }

    // --- Robot commands (all through the HUD's single socket) ---------------
    function send(obj) {
        return window.MBR4Hud ? window.MBR4Hud.send(obj) : false;
    }

    function pushBreakpoints() {
        // Full resync rather than incremental adds: the robot's list is small
        // and a reconnect leaves us with no idea what it still holds.
        send({ t: 'vm_break', clear: true });
        for (const id of breakIds) {
            const pc = pcOfBlock(id);
            if (pc !== null) send({ t: 'vm_break', add: pc });
        }
    }

    function armRobot() {
        if (!enabled) return;
        send({ t: 'vm_debug', on: true, hz: PC_HZ });
        pushBreakpoints();
    }

    function setEnabled(on) {
        enabled = on;
        if (on) {
            armRobot();
            startVarsPolling();
        } else {
            send({ t: 'vm_debug', on: false });
            stopVarsPolling();
            clearHighlight();
        }
        renderPanel();
    }

    function toggleBreakpoint(blockId) {
        const i = breakIds.indexOf(blockId);
        if (i >= 0) {
            breakIds.splice(i, 1);
            paintBreak(blockId, false);
        } else {
            if (breakIds.length >= MAX_BREAKPOINTS) {
                status(fmt(tr('bpFull'), MAX_BREAKPOINTS), true);
                return;
            }
            if (blockMap.length && pcOfBlock(blockId) === null) {
                status(tr('bpUnmapped'), true);
                return;
            }
            breakIds.push(blockId);
            paintBreak(blockId, true);
        }
        pushBreakpoints();
        renderPanel();
    }

    function clearBreakpoints() {
        for (const id of breakIds) paintBreak(id, false);
        breakIds = [];
        send({ t: 'vm_break', clear: true });
        renderPanel();
    }

    // --- Variables -----------------------------------------------------------
    // Polled, not streamed: variables only matter when someone is looking, and
    // every frame the robot sends costs it a ~100 ms modem write.
    function startVarsPolling() {
        stopVarsPolling();
        varsTimer = setInterval(() => {
            if (enabled && panelVisible()) send({ t: 'vm_vars' });
        }, 1000);
    }
    function stopVarsPolling() {
        if (varsTimer) { clearInterval(varsTimer); varsTimer = null; }
    }

    function renderVars(values) {
        const box = document.getElementById('vmDbgVars');
        if (!box) return;
        const names = Object.keys(varNames);
        if (!names.length) {
            box.innerHTML = '<div style="color:#888;font-style:italic;">' +
                escapeHtml(tr('noVars')) + '</div>';
            return;
        }
        names.sort((a, b) => varNames[a] - varNames[b]);
        box.innerHTML = names.map((n) => {
            const slot = varNames[n];
            const v = values && values[slot] !== undefined ? values[slot] : '—';
            return '<div style="display:flex;justify-content:space-between;gap:12px;">' +
                     '<span>' + escapeHtml(n) + '</span>' +
                     '<b style="font-family:monospace;">' + escapeHtml(String(v)) + '</b>' +
                   '</div>';
        }).join('');
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[c]));
    }

    // --- Panel ---------------------------------------------------------------
    function panelVisible() {
        return !!(panelEl && panelEl.style.display !== 'none');
    }

    function status(msg, isError) {
        const el = document.getElementById('vmDbgStatus');
        if (!el) return;
        el.textContent = msg;
        el.style.color = isError ? '#dc2626' : '#475569';
    }

    function ensurePanel() {
        if (panelEl && document.body.contains(panelEl)) return panelEl;
        injectStyle();
        panelEl = document.createElement('div');
        panelEl.id = 'vmDebugPanel';
        panelEl.style.cssText =
            'position:fixed;right:16px;bottom:16px;width:260px;display:none;' +
            'background:#fff;color:#111;border:1px solid #e5e7eb;border-radius:8px;' +
            'box-shadow:0 8px 24px rgba(0,0,0,.18);z-index:99998;' +
            'font:13px/1.4 -apple-system,Segoe UI,sans-serif;padding:12px 14px;';
        panelEl.innerHTML =
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
              '<b id="vmDbgTitle"></b>' +
              '<button id="vmDbgClose" type="button" style="background:none;border:0;' +
                'font-size:18px;line-height:1;cursor:pointer;color:#555;">&times;</button>' +
            '</div>' +
            '<div id="vmDbgStatus" style="font-size:12px;color:#475569;margin-bottom:8px;min-height:2.6em;"></div>' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">' +
              '<button id="vmDbgToggle" type="button"></button>' +
              '<button id="vmDbgPause"  type="button"></button>' +
              '<button id="vmDbgStep"   type="button"></button>' +
            '</div>' +
            '<div style="font-weight:600;margin-bottom:4px;" id="vmDbgVarsTitle"></div>' +
            '<div id="vmDbgVars" style="max-height:150px;overflow:auto;font-size:12px;"></div>' +
            '<button id="vmDbgClearBp" type="button" style="margin-top:10px;width:100%;"></button>';
        document.body.appendChild(panelEl);

        const btnCss =
            'padding:5px 10px;border:1px solid #cbd5e1;background:#f8fafc;' +
            'color:#0f172a;border-radius:4px;cursor:pointer;font:inherit;';
        ['vmDbgToggle', 'vmDbgPause', 'vmDbgStep', 'vmDbgClearBp'].forEach((id) => {
            document.getElementById(id).style.cssText = btnCss;
        });

        document.getElementById('vmDbgClose').addEventListener('click', hidePanel);
        document.getElementById('vmDbgToggle').addEventListener('click', () => setEnabled(!enabled));
        document.getElementById('vmDbgPause').addEventListener('click', () => {
            if (paused) { send({ t: 'vm_resume' }); paused = false; }
            else        { send({ t: 'vm_pause'  }); paused = true;  }
            renderPanel();
        });
        document.getElementById('vmDbgStep').addEventListener('click', () => {
            send({ t: 'vm_step' });
        });
        document.getElementById('vmDbgClearBp').addEventListener('click', clearBreakpoints);
        return panelEl;
    }

    function renderPanel() {
        if (!panelEl) return;
        const set = (id, text) => {
            const el = document.getElementById(id);
            if (el) el.textContent = text;
        };
        set('vmDbgTitle',     tr('panelTitle'));
        set('vmDbgVarsTitle', tr('varsTitle'));
        set('vmDbgToggle',    enabled ? tr('debugOn') : tr('debugOff'));
        set('vmDbgPause',     paused ? tr('resume') : tr('pause'));
        set('vmDbgStep',      tr('step'));
        set('vmDbgClearBp',   tr('clearBreaks') +
                              (breakIds.length ? ' (' + breakIds.length + ')' : ''));

        const toggle = document.getElementById('vmDbgToggle');
        if (toggle) {
            toggle.style.background = enabled ? '#f59e0b' : '#f8fafc';
            toggle.style.color      = enabled ? '#fff'    : '#0f172a';
        }
        // Pause/step only make sense while the stream is on and we know where
        // the program is; disabling them beats letting them silently no-op.
        const live = enabled && window.MBR4Hud && window.MBR4Hud.isConnected();
        ['vmDbgPause', 'vmDbgStep'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) {
                el.disabled = !live;
                el.style.opacity = live ? '1' : '.5';
                el.style.cursor  = live ? 'pointer' : 'not-allowed';
            }
        });

        if (!window.MBR4Hud || !window.MBR4Hud.isConnected()) status(tr('statusOffline'));
        else if (!blockMap.length) status(tr('noMap'));
        else if (paused)           status(tr('statusPaused'));
        else if (enabled)          status(tr('statusRun'));
        else                       status(tr('statusIdle'));

        renderVars(null);
    }

    function showPanel() {
        ensurePanel();
        panelEl.style.display = 'block';
        renderPanel();
        repaintBreaks();
    }
    function hidePanel() {
        if (panelEl) panelEl.style.display = 'none';
        setEnabled(false);
    }
    function togglePanel() {
        if (panelVisible()) hidePanel(); else showPanel();
    }

    // --- Frame handling ------------------------------------------------------
    function onFrame(o) {
        if (!o) return;
        if (o.t === 'pc') {
            paused = (o.run === 0);
            const id = blockAtPc(o.addr);
            highlight(id);
            if (enabled && panelVisible()) {
                status((paused ? tr('statusPaused') : tr('statusRun')) +
                       ' — ' + fmt(tr('atBlock'), o.addr));
                const p = document.getElementById('vmDbgPause');
                if (p) p.textContent = paused ? tr('resume') : tr('pause');
            }
        } else if (o.t === 'vars' && Array.isArray(o.v)) {
            if (panelVisible()) renderVars(o.v);
        } else if (o.t === 'ack' && o.cmd === 'vm_run') {
            // A fresh run restarts from the top and un-pauses the robot.
            paused = false;
            renderPanel();
        }
    }

    // --- Workspace integration ----------------------------------------------
    // Breakpoints are set from the block's own context menu — the place a
    // student already right-clicks to duplicate or delete a block.
    function addBreakpointItem(block, options) {
        // Value blocks produce no marker, so they can never be a breakpoint
        // target; offering the option would be a dead end.
        if (block.outputConnection || !block.id) return;
        const id = block.id;
        const has = breakIds.indexOf(id) >= 0;
        options.push({
            enabled: true,
            text: has ? tr('bpRemove') : tr('bpAdd'),
            callback: () => toggleBreakpoint(id),
        });
    }

    /*
     * Add our menu item WITHOUT defining `customContextMenu` on
     * Blockly.BlockSvg.prototype.
     *
     * That obvious-looking approach is a trap and it shipped as a bug: block
     * definitions such as data_variable and data_listcontents get their own
     * customContextMenu through a Blockly *extension mixin*, and
     * Blockly.Block.mixin refuses to overwrite a member that already exists —
     * it walks the prototype chain, so a prototype-level customContextMenu
     * makes it throw
     *     Mixin will overwrite block members: ["customContextMenu"]
     * from inside jsonInit. The block is then never constructed: creating a
     * variable kills the Variables flyout and the toolbox renders on top of
     * itself.
     *
     * So instead we wrap showContextMenu_ and install the hook as a temporary
     * OWN property for exactly the duration of that call, chaining to whatever
     * the block already had. Nothing is left on the prototype, mixins never
     * see us, and blocks that define their own menu keep every one of their
     * items.
     */
    function installContextMenu() {
        if (!window.Blockly || !Blockly.BlockSvg || !Blockly.BlockSvg.prototype) return;
        if (Blockly.BlockSvg.prototype.__mbr4DebugMenu) return;
        if (typeof Blockly.BlockSvg.prototype.showContextMenu_ !== 'function') return;
        Blockly.BlockSvg.prototype.__mbr4DebugMenu = true;

        const origShow = Blockly.BlockSvg.prototype.showContextMenu_;
        Blockly.BlockSvg.prototype.showContextMenu_ = function (e) {
            const hadOwn  = Object.prototype.hasOwnProperty.call(this, 'customContextMenu');
            const prevOwn = hadOwn ? this.customContextMenu : undefined;
            const inherited = this.customContextMenu;   // mixin or undefined
            const self = this;
            this.customContextMenu = function (options) {
                if (inherited) { try { inherited.call(self, options); } catch (err) {} }
                addBreakpointItem(self, options);
            };
            try {
                origShow.call(this, e);
            } finally {
                // The option callbacks are closures already captured in the
                // array by now, so removing the hook here is safe.
                if (hadOwn) this.customContextMenu = prevOwn;
                else delete this.customContextMenu;
            }
        };
    }

    // --- Nav button ----------------------------------------------------------
    /*
     * WITHDRAWN 2026-07-26. The live block debugger is not reliable enough to
     * put in front of a classroom, so its entry points — this button and the
     * right-click "toggle breakpoint" item — are not installed.
     *
     * The machinery below is deliberately left intact and reachable from the
     * console via window.MBR4VMDebug, because the problem is in the experience,
     * not in the protocol: the pc stream, the block map and the breakpoint
     * round-trip all work. Removing the code would mean rebuilding it from
     * nothing when we come back to this.
     *
     * To try it in a session: window.MBR4VMDebug._install()
     */
    const UI_ENABLED = false;

    function installButton() {
        const anchor = document.getElementById('vmUploadNavLink');
        if (!anchor) return;
        if (document.getElementById('vmDebugNavLink')) return;
        const b = document.createElement('a');
        b.className = 'nav-link d-flex align-items-center active';
        b.id = 'vmDebugNavLink';
        b.title = tr('btnTitle');
        b.style.cursor = 'pointer';
        b.innerHTML = '<i class="bi bi-bug" style="color:#f59e0b"></i>';
        b.addEventListener('click', (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            togglePanel();
        });
        anchor.parentNode.insertBefore(b, anchor.nextSibling);
    }

    // --- Public hooks --------------------------------------------------------
    window.MBR4VMDebug = {
        /** Called by wifi_vm_upload.js right after a successful compile. */
        onProgramUploaded: (state) => {
            blockMap = (state && state.blockMap) || [];
            varNames = (state && state.variables) || {};
            paused   = false;
            clearHighlight();
            // Breakpoints are kept across uploads on purpose (they are block
            // ids, and the blocks are still there) but their pcs just moved,
            // so the robot's list has to be rebuilt from the new map.
            if (enabled) pushBreakpoints();
            renderPanel();
        },
        /** Bring the withdrawn UI up by hand, for a debugging session. */
        _install: () => { installContextMenu(); installButton(); },
        _toggle: togglePanel,
        _show:   showPanel,
        _setEnabled: setEnabled,
        _state:  () => ({ enabled, paused, currentId, breakIds: breakIds.slice(),
                          mapSize: blockMap.length }),
    };

    function boot() {
        if (window.__mbr4DebugBooted) return;
        if (!window.MBR4Hud || !window.MBR4Hud.onFrame) return;   // HUD not up yet
        window.__mbr4DebugBooted = true;
        window.MBR4Hud.onFrame(onFrame);
        // The hub forgets debug state when the socket drops, so re-arm on
        // every reconnect rather than assuming it stuck.
        window.MBR4Hud.onConnect(() => { armRobot(); renderPanel(); });
        if (UI_ENABLED) {
            installContextMenu();
            installButton();
        }
        console.log('[VMDbg] wifi_vm_debug.js module loaded' +
                    (UI_ENABLED ? '' : ' (UI withdrawn — see the note above)'));
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
    setTimeout(boot, 1500);
    setTimeout(boot, 3000);
    setTimeout(boot, 5000);
    if (UI_ENABLED) setTimeout(installButton, 6000);
})();
