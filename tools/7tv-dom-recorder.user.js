// ==UserScript==
// @name         BTC — Enregistreur DOM Twitch/7TV (diagnostic)
// @namespace    https://github.com/Maxezify/BetterTwitchChat-with-7tv
// @version      1.0.0
// @description  Capture des échantillons du DOM du chat Twitch (avec ou sans 7TV) pour reconstruire BetterTwitchChat. Rien n'est envoyé sur le réseau : tout reste local, export manuel en JSON.
// @author       -
// @match        https://www.twitch.tv/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/*
 * MODE D'EMPLOI
 * -------------
 * 1. DÉSACTIVE d'abord BetterTwitchChat.js (sinon tu enregistres le DOM déjà modifié
 *    par le script, ce qui fausse tout).
 * 2. Active ce script (Tampermonkey) OU colle tout le fichier dans la console
 *    DevTools d'un onglet twitch.tv. (Firefox : tape d'abord `allow pasting`.)
 * 3. Ouvre une grosse chaîne bien active (chat rapide, beaucoup de subs/gifts).
 * 4. Un petit panneau apparaît en haut à droite : il liste ce qui a été capturé.
 *    Laisse tourner 5–15 min pour attraper les subs / gifts / raids qui sont rares.
 * 5. Clique « Exporter JSON » → un fichier btc-dom-dump-<timestamp>.json est
 *    téléchargé. C'est ce fichier qu'il faut me transmettre.
 *
 * CONTENU DU DUMP : structure HTML des messages, classes CSS, variables CSS,
 * couleurs calculées, règles CSS 7TV accessibles, et les URLs des assets de
 * l'extension. Les pseudos publics du chat y figurent (c'est du chat public).
 * Aucun cookie, token, e-mail ou donnée de compte n'est collecté.
 */

(function () {
    'use strict';

    if (window.__BTC_RECORDER__) {
        console.warn('[BTC Recorder] déjà actif sur cette page.');
        return;
    }
    window.__BTC_RECORDER__ = true;

    // ============================================================
    // CONFIG
    // ============================================================
    const MAX_PER_CAT   = 3;      // échantillons conservés par catégorie
    const MAX_HTML      = 24000;  // troncature de l'outerHTML
    const SNAPSHOT_WAIT = 1200;   // ms avant snapshot (le temps que 7TV finisse de peindre)
    const MAX_CSS_RULES = 500;

    const CATEGORIES = [
        'normal', 'reply', 'reply_emote', 'mention',
        'mod', 'vip', 'broadcaster', 'subscriber',
        'highlight', 'first_message', 'announcement',
        'sub', 'resub', 'prime', 'gift_single', 'gift_mass',
        'raid', 'watch_streak', 'redeem', 'moderation'
    ];

    const CHAT_ROOT_SELECTORS = [
        '.seventv-chat-list',
        '[data-test-selector="chat-scrollable-area__message-container"]',
        '.chat-scrollable-area__message-container',
        '.chat-list--default .simplebar-content > div',
        '.chat-room__content .chat-list',
        'section[data-test-selector="chat-room-component-layout"]'
    ];

    const MESSAGE_SELECTORS = [
        '.seventv-message',
        '.seventv-chat-message-background',
        '[data-a-target="chat-line-message"]',
        '.chat-line__message',
        '.user-notice-line',
        '.chat-line__status',
        '.chat-line__moderation'
    ].join(',');

    const BADGE_SELECTORS = [
        '.chat-badge',
        '.seventv-chat-badge',
        '[data-a-target="chat-badge"]',
        '[class*="badge" i] img',
        'img[class*="badge" i]'
    ].join(',');

    const PROBE_VARS = [
        '--seventv-highlight-color', '--seventv-highlight-dim-color',
        '--seventv-channel-accent', '--seventv-paint-color',
        '--7tv-highlight-color', '--7tv-accent',
        '--color-background-base', '--color-background-alt',
        '--color-text-base', '--color-accent'
    ];

    // ============================================================
    // ÉTAT
    // ============================================================
    const store = new Map(CATEGORIES.map(c => [c, []]));
    const scheduled = new WeakSet();
    let chatRoot = null;
    let chatRootSelector = null;
    let observer = null;
    let totalSeen = 0;

    // ============================================================
    // HELPERS
    // ============================================================
    const safe = (fn, fallback) => { try { return fn(); } catch (e) { return fallback; } };
    const txt  = (el) => safe(() => (el.textContent || '').replace(/\s+/g, ' ').trim(), '');
    const has  = (el, sel) => safe(() => !!el.querySelector(sel), false);

    const badgeLabels = (el) => safe(() => {
        const out = new Set();
        for (const n of el.querySelectorAll(BADGE_SELECTORS)) {
            const v = n.getAttribute('alt') || n.getAttribute('aria-label') ||
                      n.getAttribute('title') || n.getAttribute('data-badge') || '';
            if (v && v.length < 80) out.add(v);
        }
        return [...out];
    }, []);

    const cssVarsOf = (el) => safe(() => {
        const cs = getComputedStyle(el);
        const vars = {};
        // Chrome expose les custom properties dans l'itération de getComputedStyle
        for (let i = 0; i < cs.length; i++) {
            const p = cs[i];
            if (p.charCodeAt(0) === 45 && p.charCodeAt(1) === 45) {
                const v = cs.getPropertyValue(p).trim();
                if (v) vars[p] = v.slice(0, 220);
            }
        }
        // Firefox ne les liste pas : on sonde une liste connue
        for (const p of PROBE_VARS) {
            if (vars[p]) continue;
            const v = cs.getPropertyValue(p).trim();
            if (v) vars[p] = v.slice(0, 220);
        }
        return vars;
    }, {});

    const styleSnapshot = (el) => safe(() => {
        const cs = getComputedStyle(el);
        return {
            backgroundColor: cs.backgroundColor,
            backgroundImage: (cs.backgroundImage || '').slice(0, 240),
            color: cs.color,
            fontSize: cs.fontSize,
            lineHeight: cs.lineHeight,
            fontWeight: cs.fontWeight,
            padding: cs.padding,
            margin: cs.margin,
            border: cs.border,
            borderLeft: cs.borderLeft,
            borderRadius: cs.borderRadius,
            boxShadow: (cs.boxShadow || '').slice(0, 240),
            display: cs.display,
            opacity: cs.opacity,
            whiteSpace: cs.whiteSpace,
            webkitLineClamp: cs.webkitLineClamp
        };
    }, {});

    const ancestorChain = (el) => safe(() => {
        const out = [];
        let n = el, depth = 0;
        while (n && n !== document.body && depth++ < 14) {
            out.push({
                tag: n.tagName,
                class: n.getAttribute('class') || '',
                style: n.getAttribute('style') || '',
                dataset: Object.assign({}, n.dataset),
                backgroundColor: safe(() => getComputedStyle(n).backgroundColor, '')
            });
            if (n === chatRoot) break;
            n = n.parentElement;
        }
        return out;
    }, []);

    // Tous les descendants qui peignent réellement un fond / une bordure.
    // C'est ce qui permet de retrouver où 7TV applique la couleur de grade
    // (modo, VIP, broadcaster…) : sur la ligne, sur un wrapper interne, ou via box-shadow.
    const paintedDescendants = (el) => safe(() => {
        const out = [];
        let i = 0;
        for (const n of el.querySelectorAll('*')) {
            if (i++ > 200 || out.length >= 30) break;
            const cs = getComputedStyle(n);
            const bg = cs.backgroundColor;
            const bgImg = cs.backgroundImage;
            const bd = cs.borderLeftWidth;
            const sh = cs.boxShadow;
            const paintsBg = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
            const paintsImg = bgImg && bgImg !== 'none';
            const paintsBorder = bd && bd !== '0px';
            const paintsShadow = sh && sh !== 'none';
            if (!paintsBg && !paintsImg && !paintsBorder && !paintsShadow) continue;
            out.push({
                tag: n.tagName,
                class: n.getAttribute('class') || '',
                inlineStyle: n.getAttribute('style') || '',
                backgroundColor: paintsBg ? bg : undefined,
                backgroundImage: paintsImg ? bgImg.slice(0, 200) : undefined,
                borderLeft: paintsBorder ? cs.borderLeft : undefined,
                boxShadow: paintsShadow ? sh.slice(0, 200) : undefined
            });
        }
        return out;
    }, []);

    // Sous-éléments intéressants : la partie « réponse », le corps du message,
    // le pseudo, et le conteneur de notice sub/gift.
    const INTERESTING_PARTS = {
        reply:      '[class*="reply" i], [title^="Replying to" i]',
        body:       '[data-a-target="chat-message-text"], .seventv-chat-message-body, .text-fragment, [class*="message-body" i]',
        username:   '.chat-author__display-name, .seventv-chat-user-username, [data-a-target="chat-message-username"], [class*="user-username" i]',
        notice:     '.seventv-sub-message-container, .user-notice-line, [class*="sub-message" i], [class*="notice" i]',
        emote:      '.seventv-emote, img[data-seventv-emote-id], .chat-image, [class*="emote" i] img, img[class*="emote" i]',
        badgeList:  '[class*="badge" i]'
    };

    const partsSnapshot = (el) => {
        const out = {};
        for (const [key, sel] of Object.entries(INTERESTING_PARTS)) {
            const node = safe(() => el.querySelector(sel), null);
            if (!node) continue;
            out[key] = {
                selectorMatched: sel,
                tag: node.tagName,
                class: node.getAttribute('class') || '',
                style: node.getAttribute('style') || '',
                dataset: Object.assign({}, node.dataset),
                text: txt(node).slice(0, 400),
                html: safe(() => node.outerHTML.slice(0, 4000), ''),
                computed: styleSnapshot(node)
            };
        }
        return out;
    };

    // ============================================================
    // CLASSIFICATION
    // ============================================================
    const classify = (el) => {
        const tags = new Set();
        const t = txt(el);
        const cls = safe(() => (el.getAttribute('class') || '').toLowerCase(), '');
        const badges = badgeLabels(el).join(' | ').toLowerCase();

        // --- réponses ---
        const replyPart = safe(() => el.querySelector('[class*="reply" i], [title^="Replying to" i]'), null);
        if (replyPart || /^replying to/i.test(t)) {
            tags.add('reply');
            if (has(replyPart || el, INTERESTING_PARTS.emote)) tags.add('reply_emote');
        }

        // --- rôles (fonds colorés 7TV) ---
        if (/moderator|modérateur/.test(badges) || /\bmod\b/.test(cls)) tags.add('mod');
        if (/\bvip\b/.test(badges) || /\bvip\b/.test(cls)) tags.add('vip');
        if (/broadcaster|streamer|chaîne/.test(badges)) tags.add('broadcaster');
        if (/subscriber|abonn|founder|fondateur/.test(badges)) tags.add('subscriber');

        // --- états visuels ---
        if (has(el, '[class*="highlight" i]') || /highlight/.test(cls)) tags.add('highlight');
        if (has(el, '[class*="mention" i]') || /mention/.test(cls)) tags.add('mention');
        if (has(el, '[class*="first-time" i], [class*="first-message" i], [class*="firstmessage" i]') ||
            /first message|premier message/i.test(t)) tags.add('first_message');
        if (has(el, '[class*="announcement" i]') || /announcement/.test(cls)) tags.add('announcement');
        if (/moderation/.test(cls) || /timed out|has been banned|message deleted/i.test(t)) tags.add('moderation');

        // --- notices sub / gift / raid ---
        if (/is gifting\s+\d+|offre\s+\d+/i.test(t)) tags.add('gift_mass');
        else if (/gifted a .*sub to|a offert un abonnement/i.test(t)) tags.add('gift_single');

        if (/subscribed (with|at|for)|s'est abonné/i.test(t)) {
            tags.add(/\d+\s*(months?|mois)/i.test(t) ? 'resub' : 'sub');
        }
        if (/with prime|avec prime/i.test(t)) tags.add('prime');
        if (/raided with a viewer count|a lancé un raid/i.test(t)) tags.add('raid');
        if (/watch streak|stream streak|série de visionnage|série de \d+ streams/i.test(t)) tags.add('watch_streak');
        if (/\bredeemed\b|a utilisé/i.test(t)) tags.add('redeem');

        // « normal » = message utilisateur de référence : pas de réponse, pas de notice,
        // pas de grade coloré. Le badge d'abonné ne disqualifie pas (il ne colore pas le fond).
        const DISQUALIFY_NORMAL = ['reply', 'mod', 'vip', 'broadcaster', 'highlight', 'mention',
                                   'first_message', 'announcement', 'moderation', 'sub', 'resub',
                                   'prime', 'gift_single', 'gift_mass', 'raid', 'watch_streak', 'redeem'];
        const isUserMessage = has(el, INTERESTING_PARTS.username) || !!el.dataset.aUser;
        if (isUserMessage && !DISQUALIFY_NORMAL.some(c => tags.has(c))) tags.add('normal');
        if (tags.size === 0 && t.length > 0) tags.add('normal');

        return [...tags].filter(c => store.has(c));
    };

    // ============================================================
    // CAPTURE
    // ============================================================
    const captureNode = (el) => {
        if (!el || !el.isConnected) return;

        const cats = classify(el);
        if (cats.length === 0) return;

        // On ne construit le gros snapshot que si au moins une catégorie a de la place
        const needed = cats.filter(c => store.get(c).length < MAX_PER_CAT);
        if (needed.length === 0) return;

        const sample = {
            categories: cats,
            capturedAt: new Date().toISOString(),
            text: txt(el).slice(0, 600),
            badges: badgeLabels(el),
            tag: el.tagName,
            class: el.getAttribute('class') || '',
            style: el.getAttribute('style') || '',
            dataset: Object.assign({}, el.dataset),
            computed: styleSnapshot(el),
            cssVars: cssVarsOf(el),
            paintedDescendants: paintedDescendants(el),
            parts: partsSnapshot(el),
            ancestors: ancestorChain(el),
            outerHTML: safe(() => el.outerHTML.slice(0, MAX_HTML), '')
        };

        for (const c of needed) store.get(c).push(sample);
        totalSeen++;
        renderPanel();
    };

    const topLevelLineFor = (node) => {
        // Remonte jusqu'au conteneur de ligne de chat le plus haut sous chatRoot.
        let n = node;
        while (n && n.parentElement && n.parentElement !== chatRoot && n.parentElement !== document.body) {
            n = n.parentElement;
        }
        return n;
    };

    const scheduleCapture = (el) => {
        if (!el || el.nodeType !== 1 || scheduled.has(el)) return;
        scheduled.add(el);
        setTimeout(() => captureNode(el), SNAPSHOT_WAIT);
    };

    const onMutations = (mutations) => {
        for (const m of mutations) {
            for (const node of m.addedNodes) {
                if (node.nodeType !== 1) continue;
                const line = topLevelLineFor(node);
                if (line) scheduleCapture(line);
                if (safe(() => node.matches(MESSAGE_SELECTORS), false)) scheduleCapture(node);
            }
        }
    };

    // ============================================================
    // ENVIRONNEMENT / CSS
    // ============================================================
    const classCensus = () => safe(() => {
        const counts = Object.create(null);
        if (!chatRoot) return counts;
        let i = 0;
        for (const n of chatRoot.querySelectorAll('*')) {
            if (i++ > 25000) break;
            const c = n.getAttribute('class');
            if (!c) continue;
            for (const k of c.split(/\s+/)) if (k) counts[k] = (counts[k] || 0) + 1;
        }
        // trié par fréquence décroissante
        return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
    }, {});

    const cssRulesSample = () => {
        const out = [];
        const inaccessible = [];
        for (const sheet of safe(() => [...document.styleSheets], [])) {
            let rules = null;
            try { rules = sheet.cssRules; }
            catch (e) { inaccessible.push(sheet.href || '(inline, illisible)'); continue; }
            if (!rules) continue;
            for (const r of rules) {
                const t = safe(() => r.cssText, '') || '';
                if (t.length > 4000) continue;
                if (/seventv|7tv|chat-line|reply|highlight|user-notice|mod-|vip/i.test(t)) {
                    out.push({ href: sheet.href || '(inline)', cssText: t });
                    if (out.length >= MAX_CSS_RULES) return { rules: out, inaccessible, truncated: true };
                }
            }
        }
        return { rules: out, inaccessible, truncated: false };
    };

    const environment = () => ({
        recorderVersion: '1.0.0',
        recordedAt: new Date().toISOString(),
        url: location.href,
        userAgent: navigator.userAgent,
        language: navigator.language,
        chatRootSelector,
        chatRootClass: chatRoot ? chatRoot.getAttribute('class') : null,
        chatRootChildrenSample: safe(() => [...chatRoot.children].slice(0, 3).map(c => ({
            tag: c.tagName, class: c.getAttribute('class') || '', dataset: Object.assign({}, c.dataset)
        })), []),
        sevenTvDomPresent: !!document.querySelector('[class*="seventv" i]'),
        sevenTvLegacyChatList: !!document.querySelector('.seventv-chat-list'),
        nativeTwitchChatList: !!document.querySelector('.chat-scrollable-area__message-container'),
        globalsMatching7tv: safe(() => Object.keys(window).filter(k => /seventv|7tv/i.test(k)).slice(0, 30), []),
        extensionAssets: safe(() => [...document.querySelectorAll('link[href], script[src]')]
            .map(n => n.href || n.src)
            .filter(u => /^(chrome|moz|safari-web)-extension:/.test(u)), []),
        injectedStyleTags: safe(() => [...document.querySelectorAll('style')]
            .map(s => ({ id: s.id || '', length: (s.textContent || '').length,
                         head: (s.textContent || '').slice(0, 160) }))
            .filter(s => /seventv|7tv/i.test(s.id + s.head)), []),
        rootCssVars: safe(() => cssVarsOf(document.documentElement), {}),
        htmlClass: document.documentElement.getAttribute('class') || '',
        bodyClass: document.body ? (document.body.getAttribute('class') || '') : ''
    });

    // ============================================================
    // EXPORT
    // ============================================================
    const buildDump = () => ({
        environment: environment(),
        counts: Object.fromEntries([...store].map(([k, v]) => [k, v.length])),
        samples: Object.fromEntries([...store].filter(([, v]) => v.length > 0)),
        classCensus: classCensus(),
        css: cssRulesSample()
    });

    const exportDump = () => {
        const dump = buildDump();
        const json = JSON.stringify(dump, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `btc-dom-dump-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        console.log('[BTC Recorder] dump exporté', dump);
        return dump;
    };

    const resetDump = () => {
        for (const c of CATEGORIES) store.set(c, []);
        totalSeen = 0;
        renderPanel();
    };

    window.__BTC_DUMP   = exportDump;
    window.__BTC_STATUS = () => Object.fromEntries([...store].map(([k, v]) => [k, v.length]));
    window.__BTC_RESET  = resetDump;

    // ============================================================
    // PANNEAU UI
    // ============================================================
    let panel = null, listEl = null, collapsed = false;

    const buildPanel = () => {
        panel = document.createElement('div');
        panel.id = 'btc-recorder-panel';
        panel.style.cssText = [
            'position:fixed', 'top:8px', 'right:8px', 'z-index:2147483647',
            'width:230px', 'max-height:70vh', 'overflow:auto',
            'background:#18181b', 'color:#efeff1',
            'border:1px solid #9147ff', 'border-radius:6px',
            'font:11px/1.35 Inter,Roobert,Helvetica,Arial,sans-serif',
            'padding:8px', 'box-shadow:0 4px 14px rgba(0,0,0,.6)'
        ].join(';');

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px;';
        header.innerHTML = '<strong style="flex:1;font-size:12px">BTC Recorder</strong>';

        const toggle = document.createElement('button');
        toggle.textContent = '−';
        toggle.style.cssText = 'background:#3a3a3d;color:#efeff1;border:0;border-radius:3px;width:20px;height:20px;cursor:pointer;';
        toggle.onclick = () => {
            collapsed = !collapsed;
            listEl.style.display = collapsed ? 'none' : '';
            actions.style.display = collapsed ? 'none' : '';
            toggle.textContent = collapsed ? '+' : '−';
        };
        header.appendChild(toggle);

        listEl = document.createElement('div');

        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;gap:4px;margin-top:8px;';
        const mk = (label, bg, fn) => {
            const b = document.createElement('button');
            b.textContent = label;
            b.style.cssText = `flex:1;background:${bg};color:#fff;border:0;border-radius:3px;padding:5px 4px;cursor:pointer;font-size:11px;`;
            b.onclick = fn;
            return b;
        };
        actions.appendChild(mk('Exporter JSON', '#9147ff', exportDump));
        actions.appendChild(mk('Reset', '#3a3a3d', resetDump));

        panel.append(header, listEl, actions);
        document.body.appendChild(panel);
        panel._actions = actions;
        return actions;
    };

    let actions = null;

    const renderPanel = () => {
        if (!panel) actions = buildPanel();
        const rows = CATEGORIES.map(c => {
            const n = store.get(c).length;
            const done = n >= MAX_PER_CAT;
            const color = n === 0 ? '#8d8d92' : (done ? '#00c853' : '#ffb300');
            return `<div style="display:flex;justify-content:space-between;color:${color}">
                <span>${c}</span><span>${n}/${MAX_PER_CAT}</span></div>`;
        }).join('');
        const rootOk = chatRoot ? '#00c853' : '#ff5252';
        listEl.innerHTML =
            `<div style="color:${rootOk};margin-bottom:4px">chat root : ${chatRootSelector || 'INTROUVABLE'}</div>` +
            rows;
    };

    // ============================================================
    // DÉMARRAGE
    // ============================================================
    const findChatRoot = () => {
        for (const sel of CHAT_ROOT_SELECTORS) {
            const el = document.querySelector(sel);
            if (el) { chatRootSelector = sel; return el; }
        }
        return null;
    };

    const start = () => {
        chatRoot = findChatRoot();
        renderPanel();
        if (!chatRoot) return false;

        observer = new MutationObserver(onMutations);
        observer.observe(chatRoot, { childList: true, subtree: true });

        for (const child of [...chatRoot.children]) scheduleCapture(child);

        console.log('[BTC Recorder] démarré sur', chatRootSelector,
                    '— window.__BTC_DUMP() pour exporter.');
        return true;
    };

    const boot = () => {
        if (start()) return;
        const iv = setInterval(() => {
            if (start()) clearInterval(iv);
        }, 1500);
        setTimeout(() => clearInterval(iv), 120000);
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
        boot();
    }
})();
