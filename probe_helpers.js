'use strict';
/*
 * Shared helpers for the Playwright probes.
 *
 * Why this exists: the app raises SweetAlert2 dialogs that a human dismisses
 * without thinking and an automated probe never answers —
 *   - "Restore previous session?" on startup, whenever tabs were left open;
 *   - "unsaved changes / close anyway?" on quit.
 * A probe that ignores them looks exactly like a crash: the evaluate hangs or
 * the window goes away, and every observation collected so far is lost. That
 * cost two misdiagnoses in one session (an OTA run was blamed first on the
 * modem and then on the battery, when the real story was a modal waiting for
 * a click). Answer them first, always.
 */

/**
 * Dismiss any SweetAlert2 dialog currently on screen.
 *
 * Prefers the affirmative button, because for both dialogs we care about the
 * affirmative answer is the harmless one: restoring a session is fine, and
 * confirming a close is what we want when we are closing anyway.
 *
 * @param {import('playwright').Page} win
 * @param {'confirm'|'cancel'} [prefer]
 * @return {Promise<string|null>} the dialog title we dismissed, or null.
 */
async function dismissDialog(win, prefer) {
    try {
        return await win.evaluate((prefer) => {
            const popup = document.querySelector('.swal2-container .swal2-popup');
            if (!popup || popup.offsetParent === null) return null;
            const title = (popup.querySelector('.swal2-title') || {}).textContent || '(untitled)';
            const pick = prefer === 'cancel'
                ? (popup.querySelector('.swal2-cancel') || popup.querySelector('.swal2-confirm'))
                : (popup.querySelector('.swal2-confirm') || popup.querySelector('.swal2-cancel'));
            if (pick) pick.click();
            return title.trim();
        }, prefer || 'confirm');
    } catch (e) {
        return null;   // page gone; the caller's own error reporting is better
    }
}

/**
 * Keep dismissing dialogs for as long as they appear.
 *
 * Startup can raise more than one in sequence, and a long flow (an OTA) can
 * raise one in the middle. Runs in the background so a probe can start it once
 * and forget it.
 *
 * @return {function(): void} call to stop the watcher.
 */
function autoDismiss(win, intervalMs = 700, onDismiss) {
    const timer = setInterval(async () => {
        const title = await dismissDialog(win);
        if (title && onDismiss) onDismiss(title);
    }, intervalMs);
    return () => clearInterval(timer);
}

/**
 * Launch the app with the dialog watcher already running, which is what every
 * probe actually wants.
 */
async function launchApp(electron, opts = {}) {
    // The app is single-instance: a leftover window makes launch() return an
    // process that immediately exits with "App already running!", and the
    // probe fails for a reason that has nothing to do with what it tests.
    // Leftovers happen whenever an earlier probe died before closeApp() —
    // and they leave the user closing windows by hand, which is worse.
    try {
        require('child_process').execSync(
            'taskkill /IM "MATRIXblock Mini R4.exe" /F', { stdio: 'ignore' });
        await new Promise((r) => setTimeout(r, 1500));
    } catch (e) { /* nothing running, which is the normal case */ }

    const app = await electron.launch({
        executablePath: 'C:/matrixblock-r4/MATRIXblock Mini R4.exe',
        timeout: opts.timeout || 20000,
    });
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    const stop = autoDismiss(win, 700, (t) => console.log('  [dialog dismissed]', t));
    await win.waitForTimeout(opts.settleMs || 12000);
    return { app, win, stopDialogs: stop };
}

/** Close the app, answering the "unsaved changes" prompt on the way out. */
async function closeApp(app, win, stopDialogs) {
    if (stopDialogs) stopDialogs();
    await dismissDialog(win, 'confirm');
    try { await app.close(); } catch (e) { /* already gone */ }
}

module.exports = { dismissDialog, autoDismiss, launchApp, closeApp };
