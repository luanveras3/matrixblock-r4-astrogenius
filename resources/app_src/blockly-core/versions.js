/*
 * Versions — list the app builds installed side by side, and switch between
 * them with one click.
 *
 * Every build is just an .asar sitting in resources/. This module lists the
 * ones it can find, lets you pick one, and arranges for it to be in place the
 * next time the app starts.
 *
 * ADDING A VERSION (no code change needed)
 * ----------------------------------------
 * Drop a `versions.json` next to app.asar:
 *
 *   {
 *     "versions": [
 *       { "id": "official",
 *         "name": "MATRIXblock Mini R4",
 *         "vendor": "MATRIX Robotics",
 *         "channel": "stable",
 *         "file": "app.asar.original.bak" },
 *       { "id": "rc",
 *         "name": "MATRIXblock Mini R4",
 *         "vendor": "MATRIX Robotics",
 *         "channel": "release candidate",
 *         "file": "D:/builds/1.0.9-rc2.asar" }
 *     ]
 *   }
 *
 * `file` is the only required field — relative to resources/, or absolute.
 * The version number is read out of the archive, so it is never wrong; name,
 * vendor and channel are labels only, and are guessed sensibly when omitted.
 *
 * Without a manifest the menu still lists two entries — the build running now
 * and the official one — so nothing has to be configured for the common case.
 *
 * HOW THE SWITCH WORKS
 * --------------------
 * Windows locks app.asar while the app runs, so the copy cannot happen
 * in-process. A detached PowerShell helper waits for the process to exit, then
 * copies and relaunches.
 *
 * Quitting has one correct route and it is not the obvious one. main.js does
 *
 *     this.win.on('close', (e) => { webContents.send("close-app"); e.preventDefault(); })
 *
 * — the close is ALWAYS cancelled. `window.close()` therefore cannot ever
 * close this app; it only asks the renderer to show its confirm dialog. The
 * real exit is `ipcRenderer.send('close-app')`, which main answers with
 * App.exit(). An earlier version of this feature called window.close() and
 * silently did nothing at all, because the helper sat waiting for a process
 * that was never going to leave.
 *
 * Two safety properties, both deliberate:
 *   - nothing is ever deleted; the build being left is copied aside first, so
 *     every switch is reversible;
 *   - if the helper never sees the app exit, it changes nothing and gives up.
 */
(function () {
    'use strict';

    const OURS_KEPT    = 'app.asar.astrogenius';   // where the fork is parked
    const MANIFEST     = 'versions.json';
    const WAIT_SECONDS = 180;

    const I18N = {
        en: {
            menu:      'Versions…',
            title:     'App versions',
            intro:     'Each version is a separate build installed side by side. Switching closes the app and reopens it on the version you pick — your projects are unaffected, .mbr4 files open in every version.',
            current:   'running now',
            missing:   'file not found',
            use:       'Switch to this',
            close:     'Close',
            unsaved:   'Save your work first — the app will close without asking again.',
            confirm:   'Switch to %1?',
            confirmB:   'The app will close now and reopen on %1 v%2.',
            unsavedWarn:'Anything not saved will be lost.',
            powerTitle: 'Then power-cycle the robot',
            powerBody:  'Send a program from the new version, then switch the robot off and on at the power switch. Its WiFi module keeps the network up across a reflash — until a full power cycle the robot can still look online and answer a ping with nothing behind it, and the radio goes on draining the battery.',
            go:        'Close and switch',
            cancel:    'Cancel',
            failed:    'Could not switch: %1',
            helperDead: 'the background helper did not start, so the app was left running rather than closed for nothing',
            noOthers:  'No other version was found next to this install. To add one, drop its .asar in:\n\n%1\n\nand list it in versions.json.',
            unknown:   'unknown build',
            official:  'MATRIXblock Mini R4',
            fork:      'AstroGenius Edition',
            stable:    'stable',
            beta:      'beta',
            byMatrix:  'MATRIX Robotics',
            byUs:      'AstroGenius Team',
        },
        'pt-BR': {
            menu:      'Versões…',
            title:     'Versões do aplicativo',
            intro:     'Cada versão é um build separado instalado lado a lado. Trocar fecha o app e reabre na versão escolhida — seus projetos não são afetados, arquivos .mbr4 abrem em todas as versões.',
            current:   'em uso agora',
            missing:   'arquivo não encontrado',
            use:       'Usar esta',
            close:     'Fechar',
            unsaved:   'Salve seu trabalho antes — o app vai fechar sem perguntar de novo.',
            confirm:   'Trocar para %1?',
            confirmB:   'O app vai fechar agora e reabrir na %1 v%2.',
            unsavedWarn:'O que não estiver salvo será perdido.',
            powerTitle: 'Depois, desligue e ligue o robô',
            powerBody:  'Envie um programa pela nova versão e então desligue e ligue o robô na chave. O módulo WiFi dele mantém a rede no ar através da regravação — até um ciclo de energia completo o robô pode continuar parecendo online e respondendo ping sem nada por trás, e o rádio segue gastando bateria.',
            go:        'Fechar e trocar',
            cancel:    'Cancelar',
            failed:    'Não consegui trocar: %1',
            helperDead: 'o ajudante em segundo plano não iniciou, então o app continua aberto em vez de fechar à toa',
            noOthers:  'Nenhuma outra versão foi encontrada nesta instalação. Para adicionar uma, coloque o .asar dela em:\n\n%1\n\ne liste no versions.json.',
            unknown:   'build desconhecido',
            official:  'MATRIXblock Mini R4',
            fork:      'AstroGenius Edition',
            stable:    'estável',
            beta:      'beta',
            byMatrix:  'MATRIX Robotics',
            byUs:      'AstroGenius Team',
        },
    };

    function lang() {
        try {
            const l = (window.MBR4Lang && window.MBR4Lang()) ||
                      localStorage.getItem('astro_lang') ||
                      localStorage.getItem('language') || 'en';
            return String(l).toLowerCase().indexOf('pt') === 0 ? 'pt-BR' : 'en';
        } catch (e) { return 'en'; }
    }
    function tr(k) { const t = I18N[lang()] || I18N.en; return (t && t[k]) || I18N.en[k] || k; }
    function fmt(s) {
        const a = arguments;
        return String(s).replace(/%(\d)/g, (m, i) => (a[Number(i)] === undefined ? m : a[Number(i)]));
    }
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    const nodeOk = (() => { try { return typeof require === 'function' && !!require('fs'); } catch (e) { return false; } })();

    /*
     * Electron intercepts every fs call whose path contains ".asar" and serves
     * it as a directory, so plain fs cannot read or copy an archive as a file —
     * it reports ENOENT. `original-fs` is the unpatched module Electron ships
     * for exactly this case.
     */
    function ofs() { try { return require('original-fs'); } catch (e) { return require('fs'); } }

    function paths() {
        const path = require('path');
        const res = process.resourcesPath;
        return { res, exe: process.execPath,
                 active: path.join(res, 'app.asar'),
                 ours:   path.join(res, OURS_KEPT) };
    }

    /* ---------------------------------------------------------------- *
     * Reading an archive
     * ---------------------------------------------------------------- */

    /*
     * Identify a build from its contents, never from its filename. A `.bak`
     * name proves nothing: an install accumulates archives from the user's own
     * history, and on the bench machine four of six turned out to be old fork
     * builds. Labelling one of those "official" is the failure this avoids.
     */
    function inspect(file) {
        const fs = ofs();
        const fd = fs.openSync(file, 'r');
        try {
            const head = Buffer.alloc(16);
            fs.readSync(fd, head, 0, 16, 0);
            const len = head.readUInt32LE(12);
            if (!len || len > 64 * 1024 * 1024) throw new Error('not an asar archive');
            const buf = Buffer.alloc(len);
            fs.readSync(fd, buf, 0, len, 16);
            const s = buf.toString('utf8');
            const hdr = JSON.parse(s.slice(0, s.lastIndexOf('}') + 1));
            const base = 16 + len + ((4 - (len % 4)) % 4);
            const read = (e) => {
                const b = Buffer.alloc(e.size);
                fs.readSync(fd, b, 0, e.size, base + Number(e.offset));
                return b.toString('utf8');
            };

            // Fork-only modules. Catches current builds and the BLE-era ones,
            // whose module names were different.
            const core = hdr.files && hdr.files['blockly-core'] && hdr.files['blockly-core'].files;
            // NOTE: 'versions.js' is deliberately absent — this module gets
            // injected into other builds, so its presence says nothing about
            // who made them. 'version.js' (singular) is the fork's own and is
            // never injected.
            const forkFiles = ['version.js', 'channel.js', 'wifi_upload.js',
                               'wifi_hud.js', 'connection.js', 'navmenu.js', 'usb_config.js',
                               'bytecode.js', 'arduino_wifi_wrapper.js',
                               'arduino_ble_wrapper.js', 'ble_upload.js', 'generator_bytecode'];
            let fork = !!core && forkFiles.some((f) => !!core[f]);

            // The decisive test, because the earliest fork versions added no
            // file to blockly-core at all: every build this fork has produced
            // writes its brand into main.html.
            let forkVersion = null;
            if (!fork) {
                try {
                    const v = hdr.files['views'] && hdr.files['views'].files['main.html'];
                    if (v && /astrogenius/i.test(read(v))) fork = true;
                } catch (e) { /* fall back to the file-list test */ }
            }
            // A fork build carries its own version in version.js. Older ones do
            // not, and are reported by their base version alone.
            if (fork && core && core['version.js']) {
                try {
                    const m = read(core['version.js']).match(/const\s+FORK\s*=\s*'([^']+)'/);
                    if (m) forkVersion = m[1];
                } catch (e) { /* not fatal */ }
            }

            let version = null;
            try { version = JSON.parse(read(hdr.files['package.json'])).version; }
            catch (e) { /* nice to show, not required */ }

            return { fork, version, forkVersion };
        } finally { fs.closeSync(fd); }
    }

    /** Does this archive already carry the version menu? */
    function archiveHasSwitcher(file) {
        const fs = ofs();
        const fd = fs.openSync(file, 'r');
        try {
            const head = Buffer.alloc(16);
            fs.readSync(fd, head, 0, 16, 0);
            const len = head.readUInt32LE(12);
            const buf = Buffer.alloc(len);
            fs.readSync(fd, buf, 0, len, 16);
            const t = buf.toString('utf8');
            const hdr = JSON.parse(t.slice(0, t.lastIndexOf('}') + 1));
            const core = hdr.files && hdr.files['blockly-core'] && hdr.files['blockly-core'].files;
            return !!(core && core['versions.js']);
        } finally { fs.closeSync(fd); }
    }

    function describe(file, info) {
        if (info.fork) {
            return { name: tr('fork'), vendor: tr('byUs'), channel: tr('beta'),
                     version: info.forkVersion || info.version || '?',
                     base: info.version };
        }
        return { name: tr('official'), vendor: tr('byMatrix'), channel: tr('stable'),
                 version: info.version || '?', base: null };
    }

    /* ---------------------------------------------------------------- *
     * Building the list
     * ---------------------------------------------------------------- */

    function readManifest(res) {
        const fs = require('fs'), path = require('path');
        try {
            const f = path.join(res, MANIFEST);
            if (!fs.existsSync(f)) return [];
            const j = JSON.parse(fs.readFileSync(f, 'utf8'));
            return Array.isArray(j.versions) ? j.versions : [];
        } catch (e) {
            console.warn('[Versions] ' + MANIFEST + ' could not be read: ' + e.message);
            return [];   // a broken manifest must not take the menu down
        }
    }

    // Where the official build is normally left by an installer or by
    // patch_asar.js. Order matters: the first one that inspects as pristine
    // wins.
    const OFFICIAL_CANDIDATES = ['app.asar.original.bak', 'app.asar.bak'];

    /**
     * Every build that can be switched to.
     *
     * Deliberately NOT a scan of resources/. An install accumulates archives
     * from its own history — this bench has six — and listing them all produced
     * a menu of near-identical rows, four of them old fork builds labelled by
     * their base version, which is worse than useless: it invites someone to
     * switch to a build nobody can identify. The list is therefore exactly:
     *
     *   1. the build running right now;
     *   2. the official one, if a pristine archive is found next to it;
     *   3. whatever versions.json names, in its own order.
     *
     * Anything else on disk is history, and history is not a version.
     */
    function list() {
        const path = require('path'), afs = ofs(), p = paths();
        const out = [], seen = new Set();

        const add = (file, meta, isCurrent) => {
            const abs = path.isAbsolute(file) ? file : path.join(p.res, file);
            const key = path.resolve(abs).toLowerCase();
            if (seen.has(key)) return null;
            seen.add(key);

            const row = { file: abs, id: (meta && meta.id) || path.basename(abs),
                          current: !!isCurrent };
            let info = null;
            try { info = inspect(abs); } catch (e) { row.error = e.message; }

            if (info) {
                const d = describe(abs, info);
                row.name    = (meta && meta.name)    || d.name;
                row.vendor  = (meta && meta.vendor)  || d.vendor;
                row.channel = (meta && meta.channel) || d.channel;
                row.version = d.version;
                row.base    = d.base;
                row.fork    = info.fork;
            } else {
                row.name    = (meta && meta.name) || path.basename(abs);
                row.vendor  = (meta && meta.vendor) || '';
                row.channel = (meta && meta.channel) || '';
                row.version = '';
                row.missing = true;
            }
            out.push(row);
            return row;
        };

        // Same bytes as the running build? Then it is the running build under
        // another name, and a second row for it is noise. Comparing sizes tells
        // these archives apart and avoids hashing 108 MB on every menu open.
        let activeSize = -1;
        try { activeSize = afs.statSync(p.active).size; } catch (e) { /* ignore */ }
        const sameAsActive = (f) => {
            try { return afs.statSync(f).size === activeSize; } catch (e) { return false; }
        };

        const running = add(p.active, null, true);

        /*
         * The build we last switched away from. Without this row the official
         * app is a dead end from inside the menu — it would list only itself
         * and its own backup, with no way back to the fork, which is exactly
         * what happened the first time this shipped.
         *
         * Shown only when it is the *other kind* of build. Two AstroGenius rows
         * with the same version number, one of them a stale parked copy, tell
         * the reader nothing and invite a switch that changes nothing.
         */
        try {
            if (afs.existsSync(p.ours) && !sameAsActive(p.ours) &&
                running && inspect(p.ours).fork !== running.fork) {
                add(p.ours, null, false);
            }
        } catch (e) { /* nothing parked, or unreadable */ }

        // Only worth offering when we are not already on it. Running the
        // official build and being shown a second, identical official row —
        // its own backup — is a confusing way to say "you are here".
        if (!(running && running.fork === false)) {
            for (const c of OFFICIAL_CANDIDATES) {
                const abs = path.join(p.res, c);
                let ok = false;
                try { ok = afs.existsSync(abs) && !inspect(abs).fork && !sameAsActive(abs); }
                catch (e) { ok = false; }
                if (ok) { add(abs, null, false); break; }
            }
        }

        for (const m of readManifest(p.res)) if (m && m.file) add(m.file, m, false);

        return out;
    }

    /* ---------------------------------------------------------------- *
     * Switching
     * ---------------------------------------------------------------- */

    /*
     * The helper, with every value baked in.
     *
     * Nothing is passed on the command line, and that is the point. PowerShell
     * `-File` binds positional arguments badly when a value contains a space,
     * and the executable path here is "MATRIXblock Mini R4.exe". Passing it as
     * an argument made PowerShell fail during parameter binding — before the
     * first statement, so neither the log nor the ready-marker was ever
     * written, and the switch failed with nothing at all to show for it.
     * Baking the values into the script sidesteps the quoting rules entirely.
     */
    function helperScript(exe, src, dst, back) {
        const q = (v) => JSON.stringify(String(v));   // valid PowerShell too
        return [
            '$exe = ' + q(exe),
            '$src = ' + q(src),
            '$dst = ' + q(dst),
            '$timeout = ' + WAIT_SECONDS,
            '$log = Join-Path $PSScriptRoot "switch.log"',
            'function L($m) { Add-Content -LiteralPath $log -Value ((Get-Date -f HH:mm:ss) + " " + $m) }',
            '# First action: tell the app we are alive. It waits for this file',
            '# and only then quits — see launchHelper().',
            'Set-Content -LiteralPath (Join-Path $PSScriptRoot "ready") -Value "1"',
            'L "started"',
            '$name = [IO.Path]::GetFileNameWithoutExtension($exe)',
            '$deadline = (Get-Date).AddSeconds($timeout)',
            'while ((Get-Date) -lt $deadline) {',
            '  if (-not (Get-Process -Name $name -ErrorAction SilentlyContinue)) { break }',
            '  Start-Sleep -Milliseconds 400',
            '}',
            '# Still running: the exit never happened, so change nothing.',
            'if (Get-Process -Name $name -ErrorAction SilentlyContinue) { L "TIMEOUT"; exit 2 }',
            'L "process gone"',
            '# The file handle can outlive the process by a moment.',
            'Start-Sleep -Milliseconds 1000',
            '$done = $false',
            'for ($i = 0; $i -lt 12; $i++) {',
            '  try { Copy-Item -LiteralPath $src -Destination $dst -Force; $done = $true; break }',
            '  catch { Start-Sleep -Milliseconds 600 }',
            '}',
            'if (-not $done) { L "COPY FAILED"; exit 3 }',
            'L "copied"',
            // The way back. Once another build is running there is no
            // AstroGenius UI left to offer a return trip, so it has to live
            // outside the app. Placed only after the copy succeeded, so a
            // switch that did not happen leaves nothing behind — and placed by
            // PowerShell, because the Desktop is localised and usually
            // redirected into OneDrive: a guessed path put this file in a
            // legacy junction the user would never have opened.
            (back ? '$back = ' + q(back) : '$back = $null'),
            (back ? '$backName = ' + q(require('path').basename(back)) : '$backName = $null'),
            'if ($back) {',
            '  try {',
            '    $d = [Environment]::GetFolderPath("Desktop")',
            '    if ($d) { Copy-Item -LiteralPath $back -Destination (Join-Path $d $backName) -Force; L "shortcut placed" }',
            '  } catch { L "shortcut failed" }',
            '}',
            'Start-Process -FilePath $exe',
            'L "relaunched"',
            '',
        ].join('\r\n');
    }

    /**
     * The return shortcut: a .cmd that copies the parked fork back and starts
     * the app. It refuses while the app is running rather than racing the
     * lock, and tells the user why.
     */
    function returnScript(exe, ours, active) {
        const q = (v) => "'" + String(v).replace(/'/g, "''") + "'";
        const pt = lang() === 'pt-BR';
        return [
            '@echo off',
            'echo.',
            'echo   ' + (pt ? 'Voltando para o AstroGenius Edition...'
                            : 'Switching back to AstroGenius Edition...'),
            'echo.',
            'powershell -NoProfile -ExecutionPolicy Bypass -Command ^',
            '  "$e=' + q(exe) + '; $n=[IO.Path]::GetFileNameWithoutExtension($e);' +
            ' if (Get-Process -Name $n -ErrorAction SilentlyContinue) {' +
            " Write-Host '  " + (pt ? 'Feche o MATRIXblock primeiro e rode este atalho de novo.'
                                    : 'Close MATRIXblock first, then run this shortcut again.') +
            "'; Start-Sleep 5; exit 1 };" +
            ' Copy-Item -LiteralPath ' + q(ours) + ' -Destination ' + q(active) + ' -Force;' +
            ' Start-Process -FilePath $e"',
            '',
        ].join('\r\n');
    }

    /** Everything that can fail, done before the app is asked to quit. */
    function prepare(target, leavingFork) {
        const fs = require('fs'), path = require('path'), os = require('os');
        const afs = ofs(), p = paths();

        if (!afs.existsSync(target)) throw new Error(tr('missing'));

        /*
         * Park the build being left, so the switch is always reversible.
         * Reading a locked file is allowed on Windows; only writing over it is
         * not, which is why this works while the app is still running.
         *
         * Never park onto the target. Switching back to the parked build means
         * target === the parking slot, and copying the current build there
         * first overwrites the very archive about to be installed — the switch
         * then "succeeds" by reinstalling what was already running. Found by
         * testing the return leg: the app came back up on the official build
         * having just been asked for the fork, and the parked fork was gone.
         */
        const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
        if (!samePath(p.ours, target)) {
            try { afs.copyFileSync(p.active, p.ours); } catch (e) { /* best effort */ }
        }

        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astro-ver-'));
        const helper = path.join(dir, 'switch.ps1');

        /*
         * If the target has no version menu of its own, give it one.
         *
         * This is what makes the switch two-way from inside the app. The
         * alternative was a Desktop shortcut, which needs the app closed,
         * flashes a console window, and in practice left the user stranded on
         * the build they had switched to.
         *
         * The patched copy lives in the temp folder — the archive on disk is
         * never modified, so a pristine backup stays pristine.
         */
        let source = target;
        let hasMenu = false;
        try { hasMenu = archiveHasSwitcher(target); } catch (e) { hasMenu = false; }
        if (!hasMenu) {
            source = path.join(dir, 'patched.asar');
            injectSwitcher(target, source);
        }

        // Belt and braces: the Desktop shortcut is still written when leaving
        // the fork. The injected menu is the way back now, but a shortcut costs
        // nothing and covers the case where the injection is what went wrong.
        let back = null;
        if (leavingFork) {
            back = path.join(dir, (lang() === 'pt-BR' ? 'Voltar para AstroGenius' : 'Back to AstroGenius') + '.cmd');
            fs.writeFileSync(back, returnScript(p.exe, p.ours, p.active), 'utf8');
        }

        fs.writeFileSync(helper, helperScript(p.exe, source, p.active, back), 'utf8');
        return { helper, source, p, back };
    }

    /*
     * Start the helper and WAIT until it says it is running.
     *
     * This wait is not politeness. App.exit() tears the process down hard, and
     * a detached child that has been spawned but has not yet begun executing
     * dies with it — which is precisely what happened the first time: the temp
     * folder and the script were both created, the app quit on cue, and the
     * helper never ran a single line. Nothing was copied and nothing said why.
     *
     * So the helper's first act is to drop a `ready` file, and we do not quit
     * until we see it. If it never appears, the caller reports a failure
     * instead of closing the app for nothing.
     */
    function launchHelper(plan) {
        const fs = require('fs'), path = require('path');
        const ready = path.join(path.dirname(plan.helper), 'ready');
        // Launched through `cmd /c start`, not spawned directly.
        //
        // spawn('powershell.exe', ..., { detached: true }) from this renderer
        // creates the process and it never executes a line — measured, not
        // guessed: the same script runs when detached is false and runs again
        // through `start`, so detachment is what breaks it here. But detachment
        // is exactly what we need, since the app is about to exit. `start`
        // gives us an independent process that actually runs.
        const child = require('child_process').spawn('cmd.exe', [
            '/c', 'start', '', '/min', 'powershell.exe',
            '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
            '-File', plan.helper,
        ], { detached: true, stdio: 'ignore', windowsHide: true });
        child.unref();

        return new Promise((resolve) => {
            const t0 = Date.now();
            (function poll() {
                if (fs.existsSync(ready)) return resolve(true);
                if (Date.now() - t0 > 10000) return resolve(false);
                setTimeout(poll, 100);
            })();
        });
    }

    /*
     * The only reliable way out. See the header: main.js preventDefaults every
     * window close, so window.close() cannot quit this app — it just triggers
     * the renderer's confirm dialog. main answers 'close-app' with App.exit().
     */
    function quitApp() {
        require('electron').ipcRenderer.send('close-app');
    }

    async function switchTo(row) {
        const ok = await (window.Swal
            ? window.Swal.fire({
                title: fmt(tr('confirm'), row.name),
                // html, not text: SweetAlert renders with white-space:normal,
                // so newlines collapse and the power-cycle instruction ends up
                // buried mid-paragraph in a wall of prose. It is the one line
                // here that someone has to act on, so it gets its own block.
                html:
                    '<p style="margin:0 0 10px;">' +
                        esc(fmt(tr('confirmB'), row.name, row.version)) + '</p>' +
                    '<p style="margin:0 0 14px;color:#b45309;">' +
                        esc(tr('unsavedWarn')) + '</p>' +
                    '<div style="text-align:left;background:#f1f5f9;border-left:3px solid #0f766e;' +
                        'border-radius:4px;padding:10px 12px;font-size:13.5px;line-height:1.5;">' +
                        '<div style="font-weight:700;margin-bottom:4px;">' +
                            esc(tr('powerTitle')) + '</div>' +
                        '<div style="color:#475569;">' + esc(tr('powerBody')) + '</div>' +
                    '</div>',
                icon: 'warning', showCancelButton: true,
                confirmButtonText: tr('go'), cancelButtonText: tr('cancel'),
              }).then((r) => r && r.isConfirmed)
            : Promise.resolve(window.confirm(fmt(tr('confirm'), row.name))));
        if (!ok) return;

        let plan;
        // The build being left is this one, and this one is the fork.
        try { plan = prepare(row.file, !row.fork); }
        catch (e) {
            if (window.Swal) window.Swal.fire({ title: tr('title'), text: fmt(tr('failed'), e.message), icon: 'error' });
            else alert(fmt(tr('failed'), e.message));
            return;
        }
        const up = await launchHelper(plan);
        if (!up) {
            const msg = fmt(tr('failed'), tr('helperDead'));
            if (window.Swal) window.Swal.fire({ title: tr('title'), text: msg, icon: 'error' });
            else alert(msg);
            return;
        }
        quitApp();
    }

    /* ---------------------------------------------------------------- *
     * The dialog
     * ---------------------------------------------------------------- */

    let modalEl = null;

    function rowHtml(r, i) {
        const badge = (t, bg) =>
            '<span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;' +
            'background:' + bg + ';color:#fff;border-radius:3px;padding:1px 6px;margin-left:6px;">' + esc(t) + '</span>';
        const tag = r.current ? badge(tr('current'), '#16a34a')
                  : r.missing ? badge(tr('missing'), '#dc2626')
                  : r.channel ? badge(r.channel, r.fork ? '#d97706' : '#0f766e') : '';
        const sub = [r.vendor, r.base ? 'base ' + r.base : '', r.file.split(/[\\/]/).pop()]
                    .filter(Boolean).join(' · ');
        const btn = (r.current || r.missing || r.error)
            ? ''
            : '<button data-i="' + i + '" class="astro-ver-use" style="border:1px solid #0f766e;' +
              'background:#0f766e;color:#fff;border-radius:5px;padding:5px 12px;cursor:pointer;' +
              'font-size:13px;white-space:nowrap;">' + esc(tr('use')) + '</button>';
        return '<div style="display:flex;align-items:center;gap:12px;padding:11px 4px;' +
               'border-bottom:1px solid #eef1f4;">' +
               '<div style="flex:1;min-width:0;">' +
                 '<div style="font-weight:600;color:#1f2937;">' + esc(r.name) +
                   (r.version ? ' <span style="font-weight:400;color:#6b7280;">v' + esc(r.version) + '</span>' : '') +
                   tag + '</div>' +
                 '<div style="font-size:11.5px;color:#8b95a1;margin-top:2px;overflow:hidden;' +
                 'text-overflow:ellipsis;white-space:nowrap;">' + esc(sub) + '</div>' +
               '</div>' + btn + '</div>';
    }

    function open() {
        if (!nodeOk) return;
        close();
        const rows = list();
        const p = paths();

        modalEl = document.createElement('div');
        modalEl.id = 'astroVersionsModal';
        modalEl.style.cssText =
            'position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:100050;' +
            'display:flex;align-items:center;justify-content:center;' +
            'font:14px/1.45 -apple-system,Segoe UI,sans-serif;';
        modalEl.innerHTML =
            '<div style="background:#fff;border-radius:10px;box-shadow:0 20px 60px rgba(0,0,0,.3);' +
            'width:min(620px,92vw);max-height:86vh;display:flex;flex-direction:column;overflow:hidden;">' +
              '<div style="padding:16px 20px 10px;">' +
                '<div style="font-size:17px;font-weight:700;color:#111827;">' + esc(tr('title')) + '</div>' +
                '<div style="font-size:12.5px;color:#6b7280;margin-top:6px;">' + esc(tr('intro')) + '</div>' +
              '</div>' +
              '<div id="astroVerList" style="overflow:auto;padding:0 20px;">' +
                (rows.length ? rows.map(rowHtml).join('')
                             : '<div style="padding:18px 0;color:#6b7280;white-space:pre-wrap;">' +
                               esc(fmt(tr('noOthers'), p.res)) + '</div>') +
              '</div>' +
              '<div style="padding:12px 20px 16px;display:flex;justify-content:space-between;' +
              'align-items:center;gap:12px;border-top:1px solid #eef1f4;">' +
                '<div style="font-size:11.5px;color:#9aa4b0;">' + esc(tr('unsaved')) + '</div>' +
                '<button id="astroVerClose" style="border:1px solid #d1d5db;background:#f9fafb;' +
                'border-radius:5px;padding:6px 14px;cursor:pointer;">' + esc(tr('close')) + '</button>' +
              '</div>' +
            '</div>';
        document.body.appendChild(modalEl);

        modalEl.addEventListener('click', (ev) => {
            if (ev.target === modalEl) return close();
            const b = ev.target.closest && ev.target.closest('.astro-ver-use');
            if (b) { close(); switchTo(rows[Number(b.dataset.i)]); return; }
            if (ev.target.id === 'astroVerClose') close();
        });
        document.addEventListener('keydown', onKey);
    }

    function onKey(ev) { if (ev.key === 'Escape') close(); }

    function close() {
        if (modalEl && modalEl.parentNode) modalEl.parentNode.removeChild(modalEl);
        modalEl = null;
        document.removeEventListener('keydown', onKey);
    }

    /* ---------------------------------------------------------------- *
     * Injecting this module into another build
     * ---------------------------------------------------------------- */

    /*
     * Add `blockly-core/versions.js` and a script tag to a target archive.
     *
     * Without this the switch is a one-way door: the build you move to has no
     * version menu, so the only way back is a Desktop shortcut that needs the
     * app closed and flashes a console window — fragile enough that it failed
     * in practice. Injecting the switcher means every build can reach every
     * other build from the same menu.
     *
     * Only two things are added and nothing is removed, so the target keeps
     * its own identity; inspect() ignores this file precisely so an injected
     * official build is still reported as official.
     *
     * Same append-and-rewrite-the-header approach as patch_asar.js: keep the
     * original data section byte for byte, append the new content, and point
     * the header entries at it.
     */
    function injectSwitcher(srcFile, outFile) {
        const afs = ofs(), fs = require('fs'), path = require('path');

        // Our own source, read out of the running archive.
        const self = fs.readFileSync(
            path.join(process.resourcesPath, 'app.asar', 'blockly-core', 'versions.js'));

        const orig  = afs.readFileSync(srcFile);
        const hSize = orig.readUInt32LE(12);
        const dataStart = 16 + hSize;
        const header = JSON.parse(orig.slice(16, 16 + hSize).toString('utf8'));

        const entry = (p) => {
            const parts = p.split('/');
            let node = header.files;
            for (let i = 0; i < parts.length; i++) {
                if (!node[parts[i]]) node[parts[i]] = i < parts.length - 1 ? { files: {} } : {};
                node = i < parts.length - 1 ? node[parts[i]].files : node[parts[i]];
            }
            return node;
        };

        // The target's own main.html, with one script tag added.
        const mh = header.files['views'].files['main.html'];
        let html = orig.slice(dataStart + Number(mh.offset),
                              dataStart + Number(mh.offset) + mh.size).toString('utf8');
        const NL = String.fromCharCode(10), TAB = String.fromCharCode(9);
        const tag = '<script type="text/javascript" src="../blockly-core/versions.js"></script>';
        if (html.indexOf('blockly-core/versions.js') === -1) {
            const at = html.lastIndexOf('</body>');
            html = at === -1 ? html + NL + tag : html.slice(0, at) + TAB + tag + NL + html.slice(at);
        }
        const htmlBuf = Buffer.from(html, 'utf8');

        let acc = orig.length - dataStart;
        const appended = [];
        for (const [p, buf] of [['blockly-core/versions.js', self], ['views/main.html', htmlBuf]]) {
            const e = entry(p);
            e.offset = String(acc);
            e.size   = buf.length;
            acc += buf.length;
            appended.push(buf);
        }

        const hBuf = Buffer.from(JSON.stringify(header), 'utf8');
        const pad  = (4 - (hBuf.length % 4)) % 4;
        const prefix = Buffer.alloc(16);
        prefix.writeUInt32LE(4, 0);
        prefix.writeUInt32LE(4 + 4 + hBuf.length + pad, 4);
        prefix.writeUInt32LE(4 + hBuf.length + pad, 8);
        prefix.writeUInt32LE(hBuf.length, 12);

        afs.writeFileSync(outFile, Buffer.concat(
            [prefix, hBuf, Buffer.alloc(pad), orig.slice(dataStart), ...appended]));
    }

    /* ---------------------------------------------------------------- *
     * Entry point in the menu bar
     * ---------------------------------------------------------------- */

    /*
     * Sits in the same dropdown as Update FW. That menu exists in every build,
     * which is what makes one entry point work everywhere — and it is where
     * someone already looks for "which version of things am I on".
     */
    function installNavItem() {
        if (document.getElementById('astroVersionsNavLink')) return true;
        const dfu = document.getElementById('dfuNavLink');
        if (!dfu) return false;
        const host = dfu.closest('li') || dfu.parentNode;
        if (!host || !host.parentNode) return false;

        const li = document.createElement('li');
        const a = document.createElement('a');
        a.className = 'dropdown-item';
        a.id = 'astroVersionsNavLink';
        a.style.cursor = 'pointer';
        a.innerHTML = '<i class="bi bi-layers"></i> <span>' + esc(tr('menu')) + '</span>';
        a.addEventListener('click', (ev) => { ev.preventDefault(); open(); });
        li.appendChild(a);
        host.parentNode.insertBefore(li, host.nextSibling);
        return true;
    }

    window.MBR4Versions = {
        open, close,
        label: () => tr('menu'),
        available: nodeOk,
        _list: list,
        _inspect: (f) => { try { return inspect(f); } catch (e) { return { error: e.message }; } },
        _quit: quitApp,
        _install: installNavItem,
        _inject: injectSwitcher,
        _hasSwitcher: archiveHasSwitcher,
    };

    // The menu bar is upstream markup and we do not control when it lands, so
    // keep trying for a while rather than assuming it is already there.
    if (nodeOk && !installNavItem()) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', installNavItem);
        }
        [400, 1200, 2500, 4000, 7000].forEach((t) => setTimeout(installNavItem, t));
    }

    console.log('[Versions] versions.js module loaded');
})();
