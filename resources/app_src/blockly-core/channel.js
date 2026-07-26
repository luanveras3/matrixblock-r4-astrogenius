/*
 * Channel switch — go back to the official MATRIXblock build, and return.
 *
 * The swap itself is one file copy. Everything else here exists because of a
 * single constraint: Windows locks app.asar while the app is running, so the
 * copy cannot happen in-process. The sequence is
 *
 *     preserve the current build -> spawn a detached helper -> ask the app to
 *     close -> helper waits for the process to actually exit -> copy -> relaunch
 *
 * Two properties matter more than convenience and shape the whole design:
 *
 *   1. If the user cancels the close prompt, NOTHING happens. The helper waits
 *      for the process to disappear and gives up if it does not. A switch that
 *      half-applies because someone changed their mind is far worse than a
 *      switch that did not happen.
 *   2. Nothing is ever deleted. The build being left is copied aside first, so
 *      the trip is always round. A one-way door here means reinstalling.
 */
(function () {
    'use strict';

    const OURS_KEPT = 'app.asar.astrogenius';    // where we park this build
    // Only these are trusted as a source of pristine. An install can accumulate
    // other .bak files from the user's own experiments; picking one of those up
    // would silently install something nobody asked for.
    const PRISTINE_CANDIDATES = ['app.asar.original.bak', 'app.asar.bak'];

    const WAIT_SECONDS = 180;   // how long the helper waits for the app to exit

    const I18N = {
        en: {
            menu:        'Switch to the official version',
            title:       'Switch to the official MATRIXblock?',
            body:        'The app will close and reopen running the official MATRIXblock Mini R4 v%1 — no AstroGenius features: no WiFi upload, no live block debug, no remote console.\n\nYour saved projects are unaffected: this fork adds no blocks, so .mbr4 files open in both versions.\n\nA shortcut named "%2" will be placed on your Desktop to come back.',
            confirm:     'Close and switch',
            cancel:      'Cancel',
            shortcut:    'Back to AstroGenius',
            noPristine:  'The original app.asar was not found next to this install, so there is nothing to switch back to. It is the file the installer left as app.asar.original.bak or app.asar.bak in:\n\n%1\n\nRestore it from a fresh MATRIXblock install, or reinstall the official app.',
            notPristine: 'The backup found does not look like the official build — it contains AstroGenius files. Switching would install this same fork again, so nothing was changed.',
            failed:      'Could not prepare the switch: %1',
            going:       'Close the app when it asks. It will reopen on the official version.\n\nIf you cancel the close, nothing changes.',
        },
        'pt-BR': {
            menu:        'Voltar para a versão oficial',
            title:       'Voltar para o MATRIXblock oficial?',
            body:        'O app vai fechar e reabrir na versão oficial MATRIXblock Mini R4 v%1 — sem as funções AstroGenius: sem envio por WiFi, sem depuração ao vivo, sem console remoto.\n\nSeus projetos salvos não são afetados: este fork não adiciona blocos, então arquivos .mbr4 abrem nas duas versões.\n\nUm atalho chamado "%2" vai ficar na sua Área de Trabalho para voltar.',
            confirm:     'Fechar e trocar',
            cancel:      'Cancelar',
            shortcut:    'Voltar para AstroGenius',
            noPristine:  'O app.asar original não foi encontrado nesta instalação, então não há para onde voltar. É o arquivo que o instalador deixou como app.asar.original.bak ou app.asar.bak em:\n\n%1\n\nRecupere-o de uma instalação limpa do MATRIXblock, ou reinstale o app oficial.',
            notPristine: 'O backup encontrado não parece ser a versão oficial — ele contém arquivos do AstroGenius. Trocar instalaria este mesmo fork de novo, então nada foi alterado.',
            failed:      'Não consegui preparar a troca: %1',
            going:       'Feche o app quando ele perguntar. Ele vai reabrir na versão oficial.\n\nSe você cancelar o fechamento, nada muda.',
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

    const nodeOk = (() => { try { return typeof require === 'function' && !!require('fs'); } catch (e) { return false; } })();

    /*
     * Electron intercepts every fs call whose path contains ".asar" and serves
     * it as if the archive were a directory — so plain fs cannot copy or read
     * app.asar as a file at all; it reports ENOENT. `original-fs` is the
     * unpatched module Electron ships for exactly this. Every archive
     * operation below goes through it; ordinary files still use fs.
     */
    function ofs() {
        try { return require('original-fs'); } catch (e) { return require('fs'); }
    }

    function paths() {
        const path = require('path');
        const res = process.resourcesPath;
        return {
            res,
            exe:    process.execPath,
            active: path.join(res, 'app.asar'),
            ours:   path.join(res, OURS_KEPT),
        };
    }

    /*
     * Read an asar's header and report whether it is the pristine upstream
     * build. A name proves nothing: an install accumulates .bak files from the
     * user's own history, and on the bench machine four of six turned out to be
     * old fork builds. Installing one of those as "the official version" is the
     * failure this guards against, so the archive is judged by its contents.
     */
    function inspectAsar(file) {
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
            const read = (entry) => {
                const b = Buffer.alloc(entry.size);
                fs.readSync(fd, b, 0, entry.size, base + Number(entry.offset));
                return b.toString('utf8');
            };

            // Test one: fork-only modules in blockly-core. This catches current
            // builds, and the BLE-era ones whose module names were different.
            const core = hdr.files && hdr.files['blockly-core'] && hdr.files['blockly-core'].files;
            const forkFiles = ['version.js', 'channel.js', 'wifi_upload.js', 'wifi_hud.js',
                               'connection.js', 'navmenu.js', 'usb_config.js', 'bytecode.js',
                               'arduino_wifi_wrapper.js', 'arduino_ble_wrapper.js',
                               'ble_upload.js', 'generator_bytecode'];
            let hasFork = !!core && forkFiles.some((f) => !!core[f]);

            // Test two, and the decisive one: the brand. Every build this fork
            // has ever produced writes AstroGenius into main.html, while adding
            // no file to blockly-core in its earliest versions — so the file
            // list alone is not enough. Checked on this install against six
            // archives, four of which the file list alone got wrong.
            if (!hasFork) {
                try {
                    const v = hdr.files['views'] && hdr.files['views'].files['main.html'];
                    if (v && /astrogenius/i.test(read(v))) hasFork = true;
                } catch (e) { /* unreadable main.html: fall back to test one */ }
            }

            let version = null;
            try { version = JSON.parse(read(hdr.files['package.json'])).version; }
            catch (e) { /* a version is nice to show, not required */ }
            return { pristine: !hasFork, version };
        } finally { fs.closeSync(fd); }
    }

    /** The pristine archive to switch to, or null with a reason. */
    function findPristine() {
        const fs = ofs(), path = require('path'), p = paths();
        let sawCandidate = false;
        for (const name of PRISTINE_CANDIDATES) {
            const f = path.join(p.res, name);
            if (!fs.existsSync(f)) continue;
            sawCandidate = true;
            try {
                const info = inspectAsar(f);
                if (info.pristine) return { file: f, version: info.version };
            } catch (e) { /* unreadable or not an asar — try the next one */ }
        }
        return { file: null, reason: sawCandidate ? 'notPristine' : 'noPristine' };
    }

    function helperScript() {
        // Waits for the app to exit before touching anything, and gives up
        // rather than forcing it. $timeout expiring means the user cancelled
        // the close prompt — the correct response to which is to do nothing.
        return [
            'param([string]$exe, [string]$src, [string]$dst, [int]$timeout,',
            '      [string]$back, [string]$backName)',
            '$name = [IO.Path]::GetFileNameWithoutExtension($exe)',
            '$deadline = (Get-Date).AddSeconds($timeout)',
            'while ((Get-Date) -lt $deadline) {',
            '  if (-not (Get-Process -Name $name -ErrorAction SilentlyContinue)) { break }',
            '  Start-Sleep -Milliseconds 500',
            '}',
            'if (Get-Process -Name $name -ErrorAction SilentlyContinue) { exit 2 }',
            '# The handle can outlive the process by a moment; retry the copy.',
            'Start-Sleep -Milliseconds 1200',
            '$done = $false',
            'for ($i = 0; $i -lt 10; $i++) {',
            '  try { Copy-Item -LiteralPath $src -Destination $dst -Force; $done = $true; break }',
            '  catch { Start-Sleep -Milliseconds 700 }',
            '}',
            'if (-not $done) { exit 3 }',
            '# Place the return shortcut only now, so a cancelled switch never',
            '# leaves an orphan on the Desktop. And ask Windows where the Desktop',
            '# IS rather than guessing: it is localised and often redirected into',
            '# OneDrive, and a guess put the file in a legacy junction the user',
            '# would never have seen.',
            'if ($back) {',
            '  try {',
            '    $d = [Environment]::GetFolderPath("Desktop")',
            '    if ($d) { Copy-Item -LiteralPath $back -Destination (Join-Path $d $backName) -Force }',
            '  } catch { }',
            '}',
            'Start-Process -FilePath $exe',
            '',
        ].join('\r\n');
    }

    /*
     * The way back. Once the official build is running there is no AstroGenius
     * UI left to offer a return trip, so the return has to live outside the
     * app entirely — a shortcut on the Desktop. Without this the switch is a
     * one-way door, which is the difference between a feature people try and
     * one they avoid.
     */
    function returnScript(p) {
        const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
        return [
            '@echo off',
            'setlocal',
            'echo.',
            'echo   ' + (lang() === 'pt-BR' ? 'Voltando para o AstroGenius Edition...' : 'Switching back to AstroGenius Edition...'),
            'echo.',
            'powershell -NoProfile -ExecutionPolicy Bypass -Command ^',
            '  "$e=' + q(p.exe) + '; $n=[IO.Path]::GetFileNameWithoutExtension($e);' +
            ' if (Get-Process -Name $n -ErrorAction SilentlyContinue) {' +
            ' Write-Host \'  ' + (lang() === 'pt-BR' ? 'Feche o MATRIXblock primeiro, depois rode este atalho de novo.' : 'Close MATRIXblock first, then run this shortcut again.') + '\';' +
            ' Read-Host; exit 1 };' +
            ' Copy-Item -LiteralPath ' + q(p.ours) + ' -Destination ' + q(p.active) + ' -Force;' +
            ' Start-Process -FilePath $e"',
            '',
        ].join('\r\n');
    }

    /** Everything that can fail, done BEFORE the app is asked to close. */
    function prepare() {
        const fs = require('fs'), path = require('path'), p = paths();
        const afs = ofs();   // archives only — see ofs()

        const found = findPristine();
        if (!found.file) {
            const e = new Error(found.reason === 'noPristine'
                ? fmt(tr('noPristine'), p.res) : tr('notPristine'));
            e.handled = true;
            throw e;
        }

        // Park the current build so the return trip has something to restore.
        // Reading a locked file is allowed on Windows; only writing over it is
        // not, which is why this can happen while the app is still running.
        afs.copyFileSync(p.active, p.ours);

        // The pristine archive is used where it already sits. An earlier draft
        // copied it to a fixed name for tidiness, which cost 108 MB of disk on
        // every install for no gain — the .bak it would have copied FROM is
        // exactly as likely to survive as the copy.

        const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'astro-switch-'));
        const helper = path.join(dir, 'switch.ps1');
        fs.writeFileSync(helper, helperScript(), 'utf8');

        const backName = tr('shortcut') + '.cmd';
        const back = path.join(dir, backName);
        fs.writeFileSync(back, returnScript(p), 'utf8');

        return { p, helper, source: found.file, version: found.version, back, backName };
    }

    function launchHelper(plan) {
        const { spawn } = require('child_process');
        const child = spawn('powershell.exe', [
            '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
            '-File', plan.helper,
            '-exe', plan.p.exe, '-src', plan.source, '-dst', plan.p.active,
            '-timeout', String(WAIT_SECONDS),
            '-back', plan.back, '-backName', plan.backName,
        ], { detached: true, stdio: 'ignore', windowsHide: true });
        child.unref();
    }

    function say(title, text, opts) {
        if (window.Swal) return window.Swal.fire(Object.assign({ title, text }, opts || {}));
        return Promise.resolve({ isConfirmed: window.confirm(title + '\n\n' + text) });
    }

    async function switchToStable() {
        if (!nodeOk) return;
        let plan;
        try {
            plan = prepare();
        } catch (e) {
            await say(tr('title'), e.handled ? e.message : fmt(tr('failed'), e.message),
                      { icon: 'error', confirmButtonText: 'OK' });
            return;
        }

        const r = await say(tr('title'),
            fmt(tr('body'), plan.version || '1.0.8', tr('shortcut')),
            { icon: 'warning', showCancelButton: true,
              confirmButtonText: tr('confirm'), cancelButtonText: tr('cancel') });
        if (!r || !r.isConfirmed) return;

        launchHelper(plan);
        await say(tr('title'), tr('going'), { icon: 'info', confirmButtonText: 'OK' });
        // The app's own close flow runs from here — including its "save your
        // work?" prompt. We deliberately do not bypass it.
        window.close();
    }

    window.MBR4Channel = {
        switchToStable,
        _prepare: prepare,
        _findPristine: () => { try { return findPristine(); } catch (e) { return { error: e.message }; } },
        _inspect: (f) => { try { return inspectAsar(f); } catch (e) { return { error: e.message }; } },
        label: () => tr('menu'),
        available: nodeOk,
    };

    console.log('[Channel] channel.js module loaded');
})();
