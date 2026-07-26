'use strict';
/*
 * Collapses this fork's navbar buttons into a single dropdown.
 *
 * Why: the stock `#boardNav` is a fixed-width block (480 px at x=603, so it
 * needs ~1083 px of window). We added four buttons to it — Send via WiFi,
 * Send VM, live debug, USB setup — and pushed it past what it was built for.
 * Measured: at a 900 px window the bar overflows the right edge by ~183 px and
 * at 700 px by ~383 px, with the positions not changing at all between the
 * two, because nothing in that bar is responsive. The connection indicator sits
 * at x=968 and is simply off-screen on a small window.
 *
 * Making the stock bar responsive would mean fighting upstream layout we do not
 * own. Grouping our own additions is the honest fix: it removes the overflow we
 * caused, and it stops a bar that already held the vendor's controls from
 * carrying four more.
 *
 * The connection indicator deliberately stays outside the menu — it is status,
 * not an action, and hiding "am I connected?" behind a click is exactly the
 * question this fork spent a long time making answerable at a glance.
 */
(function () {
    // Buttons we own, in the order they should appear. Each is installed by its
    // own module on a retry timer, so this list is polled rather than read once.
    const OURS = [
        { id: 'wifiUploadNavLink', fallback: 'Send via WiFi' },
        { id: 'vmUploadNavLink',   fallback: 'Send VM' },
        { id: 'vmDebugNavLink',    fallback: 'Live debug' },
        { id: 'usbConfigNavLink',  fallback: 'USB setup' },
    ];

    const STRINGS = {
        en:      { menu: 'Robot', title: 'Upload, debug and hub tools' },
        'pt-BR': { menu: 'Robô',  title: 'Enviar, depurar e ferramentas do hub' },
    };
    function tr(k) {
        try {
            const l = Blockly && Blockly.ScratchMsgs && Blockly.ScratchMsgs.currentLocale_;
            if (l && STRINGS[l]) return STRINGS[l][k];
        } catch (e) {}
        return STRINGS.en[k];
    }

    let menuEl = null, panelEl = null;

    function ensureMenu() {
        if (menuEl && document.body.contains(menuEl)) return menuEl;
        const host = document.getElementById('boardNav');
        if (!host) return null;

        menuEl = document.createElement('a');
        menuEl.id = 'astroNavMenu';
        menuEl.className = 'nav-link d-flex align-items-center active';
        menuEl.style.cssText = 'cursor:pointer;white-space:nowrap;';
        menuEl.title = tr('title');
        menuEl.innerHTML = '<i class="bi bi-robot"></i><span>&nbsp;' + tr('menu') +
                           '&nbsp;<i class="bi bi-caret-down-fill" style="font-size:.7em"></i></span>';

        panelEl = document.createElement('div');
        panelEl.id = 'astroNavMenuPanel';
        panelEl.style.cssText =
            'position:fixed;display:none;background:#fff;border:1px solid #d7dde3;' +
            'border-radius:6px;box-shadow:0 6px 20px rgba(0,0,0,.18);z-index:100003;' +
            'padding:6px;min-width:210px;font:14px/1.4 -apple-system,Segoe UI,sans-serif;';
        document.body.appendChild(panelEl);

        menuEl.addEventListener('click', (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            if (panelEl.style.display === 'block') { panelEl.style.display = 'none'; return; }
            const b = menuEl.getBoundingClientRect();
            panelEl.style.display = 'block';
            // Clamp to the viewport: the whole point is not to overflow again.
            const w = panelEl.offsetWidth || 210;
            panelEl.style.left = Math.max(4, Math.min(b.left, innerWidth - w - 4)) + 'px';
            panelEl.style.top  = (b.bottom + 2) + 'px';
        });
        document.addEventListener('click', (ev) => {
            if (panelEl && !panelEl.contains(ev.target) && ev.target !== menuEl) {
                panelEl.style.display = 'none';
            }
        });

        host.insertBefore(menuEl, host.firstChild);
        return menuEl;
    }

    // Move a button into the panel, keeping the element itself so its module's
    // click handler, id and label updates all keep working untouched.
    function adopt(entry) {
        const el = document.getElementById(entry.id);
        if (!el || el.parentNode === panelEl) return false;
        const label = (el.textContent || '').trim() || entry.fallback;
        el.style.cssText =
            'display:flex;align-items:center;gap:8px;padding:7px 10px;' +
            'border-radius:4px;cursor:pointer;color:#0f172a;text-decoration:none;';
        el.addEventListener('mouseenter', () => { el.style.background = '#f1f5f9'; });
        el.addEventListener('mouseleave', () => { el.style.background = ''; });
        // Closing on click keeps the menu from covering whatever it opened.
        el.addEventListener('click', () => { if (panelEl) panelEl.style.display = 'none'; });
        // Guarantee a readable label even for the icon-only buttons.
        if (!el.textContent.trim()) {
            const span = document.createElement('span');
            span.textContent = entry.fallback;
            el.appendChild(span);
        }
        panelEl.appendChild(el);
        return true;
    }

    // A footer naming both versions. The dropdown is where someone looks when
    // they are about to ask "which version is this?", and it is the one place
    // that can carry the sentence without crowding the navbar.
    function ensureFooter() {
        if (!panelEl || !window.MBR4Version) return;
        let f = panelEl.querySelector('.astro-nav-footer');
        if (!f) {
            f = document.createElement('div');
            f.className = 'astro-nav-footer';
            f.style.cssText =
                'margin-top:6px;padding:6px 8px 2px;border-top:1px solid #e6eaee;' +
                'font-size:11px;line-height:1.35;color:#7a8592;';
            panelEl.appendChild(f);
        }
        f.textContent = 'AstroGenius ' + window.MBR4Version.short() + ' · ' +
                        window.MBR4Version.baseLine();
        f.title = window.MBR4Version.tooltip();

        // The way out of the beta, right under the line that says it is one.
        if (window.MBR4Channel && window.MBR4Channel.available) {
            const a = document.createElement('a');
            a.className = 'astro-nav-channel';
            a.href = '#';
            a.textContent = window.MBR4Channel.label();
            a.style.cssText = 'display:block;margin-top:4px;color:#4a90d9;text-decoration:none;';
            a.addEventListener('click', (ev) => {
                ev.preventDefault();
                panelEl.style.display = 'none';
                window.MBR4Channel.switchToStable();
            });
            f.appendChild(a);
        }
        // Always last, however many buttons arrive after it.
        panelEl.appendChild(f);
    }

    function sweep() {
        if (!ensureMenu()) return;
        let moved = 0;
        for (const e of OURS) if (adopt(e)) moved++;
        if (moved) console.log('[NavMenu] grouped ' + moved + ' button(s)');
        ensureFooter();
        // Hide the menu itself while it holds nothing, so a build without our
        // buttons does not grow an empty control. The footer is not a button,
        // so it must not count towards "holds something".
        const buttons = panelEl.querySelectorAll(':scope > :not(.astro-nav-footer)').length;
        menuEl.style.display = buttons ? '' : 'none';
    }

    window.MBR4NavMenu = {
        _sweep: sweep,
        _count: () => (panelEl
            ? panelEl.querySelectorAll(':scope > :not(.astro-nav-footer)').length
            : 0),
    };

    // Every module installs its button on its own retry schedule, so keep
    // sweeping for a while rather than assuming they are all present.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', sweep);
    } else {
        sweep();
    }
    [1000, 2000, 3500, 5000, 7000, 9000].forEach((t) => setTimeout(sweep, t));
    setInterval(sweep, 5000);
    console.log('[NavMenu] navmenu.js module loaded');
})();
