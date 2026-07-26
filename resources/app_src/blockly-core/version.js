/*
 * Version identity for the AstroGenius fork.
 *
 * Two versions matter and they are not the same thing:
 *
 *   - the UPSTREAM app from MATRIX Robotics, which is a released, supported,
 *     stable product;
 *   - this fork, which is a community build on top of it and is BETA.
 *
 * Showing only one of them is how support goes wrong. A teacher reporting a
 * problem needs to be able to say which base and which fork build they are on,
 * and — more importantly — MATRIX must not receive bug reports for code they
 * did not write. The BETA marking is there to make the distinction impossible
 * to miss, not to be modest about it.
 *
 * This module is the single source of truth. Nothing else in the IDE should
 * hardcode a version string.
 */
(function () {
    'use strict';

    // The fork's own version. Bump this in the same commit that moves the git
    // tag, and keep CHANGELOG.md in step.
    const FORK = '3.5.0';

    // 'beta' while the WiFi/OTA work is being validated in the field.
    // Set to 'stable' only once a release has survived real classroom use.
    const CHANNEL = 'beta';

    // Fallback for the base version, used only if reading package.json fails.
    // The fork is built and tested against this upstream release.
    const BASE_FALLBACK = '1.0.8';

    function readBase() {
        // The app runs with node integration (our uploader spawns arduino-cli),
        // so the archive's own manifest is readable. Every step is guarded:
        // a version label must never be the thing that breaks the IDE.
        try {
            if (typeof require === 'function') {
                const pkg = require('../package.json');
                if (pkg && pkg.version) return String(pkg.version);
            }
        } catch (e) { /* fall through to the constant */ }
        return BASE_FALLBACK;
    }

    const BASE = readBase();

    const I18N = {
        en: {
            channelBeta:   'BETA',
            channelStable: 'STABLE',
            // %1 fork version, %2 channel, %3 upstream version
            full:      'AstroGenius Edition v%1 (%2) — community build on MATRIXblock Mini R4 v%3 (stable, MATRIX Robotics)',
            tooltip:   'AstroGenius v%1 %2\nBase: MATRIXblock Mini R4 v%3 (official, stable)\n\nThis is a community fork. Report problems with the AstroGenius features to the fork, not to MATRIX Robotics.',
            baseLine:  'on MATRIXblock %1',
        },
        'pt-BR': {
            channelBeta:   'BETA',
            channelStable: 'ESTÁVEL',
            full:      'AstroGenius Edition v%1 (%2) — build da comunidade sobre o MATRIXblock Mini R4 v%3 (estável, MATRIX Robotics)',
            tooltip:   'AstroGenius v%1 %2\nBase: MATRIXblock Mini R4 v%3 (oficial, estável)\n\nEste é um fork da comunidade. Relate problemas das funções AstroGenius ao fork, não à MATRIX Robotics.',
            baseLine:  'sobre o MATRIXblock %1',
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

    function tr(k) {
        const t = I18N[lang()] || I18N.en;
        return (t && t[k]) || I18N.en[k] || k;
    }

    function fmt(s) {
        const a = arguments;
        return String(s).replace(/%(\d)/g, (m, i) => (a[Number(i)] === undefined ? m : a[Number(i)]));
    }

    const channelLabel = () => tr(CHANNEL === 'beta' ? 'channelBeta' : 'channelStable');

    window.MBR4Version = {
        fork:    FORK,
        channel: CHANNEL,
        base:    BASE,
        isBeta:  CHANNEL === 'beta',

        /** "3.5.0 BETA" — for a compact chip. */
        short()   { return FORK + ' ' + channelLabel(); },
        /** "on MATRIXblock 1.0.8" — the second line under a chip. */
        baseLine() { return fmt(tr('baseLine'), BASE); },
        /** One sentence naming both versions and who owns which. */
        full()    { return fmt(tr('full'), FORK, channelLabel(), BASE); },
        /** Multi-line, for a title= attribute. */
        tooltip() { return fmt(tr('tooltip'), FORK, channelLabel(), BASE); },
    };

    // Fill the navbar chip and give the whole brand block a tooltip naming
    // both versions. Retried a few times: the badge is upstream markup and we
    // do not control when it lands relative to this script.
    function paint() {
        const chip = document.getElementById('astroVersionChip');
        if (!chip) return false;
        chip.textContent = window.MBR4Version.short();
        const badge = chip.closest('.navbar-brand');
        if (badge) badge.title = window.MBR4Version.tooltip();
        return true;
    }
    if (!paint()) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', paint);
        }
        [300, 1000, 2500].forEach((t) => setTimeout(paint, t));
    }

    console.log('[Version] ' + window.MBR4Version.full());
})();
