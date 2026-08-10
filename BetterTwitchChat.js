// ==UserScript==
// @name         BetterTwitchChat (+ 7TV)
// @namespace    https://github.com/Maxezify/BetterTwitchChat-with-7tv
// @version      15.5.0
// @description  Réponses lisibles en entier (emotes incluses), notices sub/prime/gift compactées, regroupement des gifts multiples. Compatible chat Twitch natif + nouvelle extension 7TV.
// @author       Maxezify
// @match        https://www.twitch.tv/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=twitch.tv
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/Maxezify/BetterTwitchChat-with-7tv/claude/twitch-chat-7tv-userscript-1hh5y8/BetterTwitchChat.js
// @downloadURL  https://raw.githubusercontent.com/Maxezify/BetterTwitchChat-with-7tv/claude/twitch-chat-7tv-userscript-1hh5y8/BetterTwitchChat.js
// ==/UserScript==

/*
 * v15 — réécriture complète.
 *
 * Mise à jour automatique : @updateURL / @downloadURL pointent sur la branche de
 * travail, seule à porter la v15. Si elle est un jour fusionnée dans main, il faut
 * remplacer le segment de branche par `main` dans les deux URLs de l'en-tête.
 *
 * La nouvelle extension 7TV (ID lppmekppnliemjclknbagdhoocikieoi) ne remplace plus le
 * moteur de rendu du chat : elle décore le chat natif de Twitch. Toutes les classes
 * `.seventv-chat-list`, `.seventv-message`, `.seventv-sub-message-container`… sur
 * lesquelles reposait la v14 ont disparu. Ce script cible désormais le DOM Twitch natif
 * et lit les marqueurs 7TV (`data-seventv-*`, `.seventv-emote`, classes de highlight)
 * là où ils existent.
 *
 * Ancres considérées comme stables :
 *   [data-test-selector="chat-scrollable-area__message-container"]  conteneur du chat
 *   .chat-line__message / [data-a-target="chat-line-message"]       ligne de message
 *   .chat-line__message-container                                   corps de la ligne
 *   [data-a-target="chat-line-message-body"] / .text-fragment       texte du message
 *   .chat-author__display-name                                      pseudo
 *   [data-test-selector="user-notice-line"]                         notice sub/gift/raid
 *   .mystery-gift-theme__*                                          gift multiple
 *   img[data-emote-name] / .seventv-emote / .chat-image             emotes
 *
 * Les classes en `Layout-sc-…`/`kBZhWz` sont des hachages styled-components : elles
 * changent à chaque build de Twitch et ne sont JAMAIS utilisées comme sélecteur ici.
 * Le bloc « réponse » n'a pas de classe stable ; il est identifié par sa position
 * (premier enfant non vide de .chat-line__message-container) et par son <p title>.
 */

(function () {
    'use strict';

    const VERSION = '15.5.0';

    // =========================================================================
    // CONFIGURATION — tout ce qui se règle sans toucher au reste du fichier
    // =========================================================================
    const CONFIG = {
        // --- Réponses ---
        reply: {
            // Présentation de la citation :
            //   'rail'   la citation fait corps avec le message, un filet vertical dans
            //            la couleur de grade court le long de l'ensemble
            //   'inline' la citation est juste la première ligne du message, sans filet
            //   'card'   la citation est un bloc détaché avec son propre fond
            style: 'rail',
            // Fond du message qui répond à quelqu'un. Volontairement exprimé en blanc
            // semi-transparent : il s'ajoute au fond existant, donc il reste visible
            // par-dessus les couleurs de highlight 7TV (modo, VIP, first-time…).
            lineTint: 'hsla(0, 0%, 100%, 0.08)',
            // Fond du bloc de citation lui-même, un cran plus clair.
            blockTint: 'hsla(0, 0%, 100%, 0.06)',
            // Couleur du texte cité : gris, plus sombre que le texte des messages.
            color: '#8f8f9a',
            // Taille de la citation, relative au texte du chat.
            fontScale: 0.78,
            // Interligne de la citation. Sert aussi à caler verticalement la bulle.
            lineHeight: 1.4,
            // Retire « Répond à » / « Replying to » et garde « @pseudo : texte ».
            hidePrefix: true,
            // Garde la petite bulle SVG à gauche de la citation.
            showIcon: true,
            // Reconstruit les emotes dans la citation (Twitch n'y met que du texte brut).
            renderEmotes: true,
            // Recolore le « @pseudo » cité avec sa vraie couleur de chat. Désactivé :
            // la couleur attire trop l'œil sur une citation censée rester discrète.
            colorQuotedName: false,
            // Volontairement calé sous l'interligne : une emote plus haute ferait
            // grandir la première ligne et désalignerait la bulle.
            emoteHeight: '1.3em',
            // Épaisseur de la barre de couleur reprise du grade 7TV.
            accentWidth: '4px',
            accentFallback: 'hsla(0, 0%, 100%, 0.4)'
        },

        // --- Notices sub / prime / gift / raid ---
        compact: {
            enabled: true,
            fontSize: '12.5px',
            lineHeight: '1.35',
            iconSize: '15px',
            // Regroupe « X offre N abonnements » + les N « X a offert un abonnement à Y »
            // en une seule notice avec la liste des destinataires.
            aggregateGifts: true,
            // Délai d'attente des gifts individuels après l'annonce du gift multiple.
            giftWindowMs: 12000,
            // Fenêtre de rattrapage pour les gifts arrivés avant l'annonce.
            giftLookbehindMs: 15000
        },

        // --- Divers ---
        // Trait de séparation entre les messages.
        separators: true,
        // Traduit en français les notices que Twitch laisse en anglais et les notices
        // système de 7TV (celles-ci sont toujours en anglais). Sans effet si ton
        // interface Twitch est déjà en français.
        translate: true,
        // Journalise dans la console ce que le script détecte.
        debug: false
    };

    // =========================================================================
    // SÉLECTEURS
    // =========================================================================
    const SEL = {
        chatRoot: [
            '[data-test-selector="chat-scrollable-area__message-container"]',
            '.chat-scrollable-area__message-container',
            '.seventv-chat-list'
        ],
        line: '.chat-line__message,[data-a-target="chat-line-message"]',
        lineContainer: '.chat-line__message-container',
        body: '[data-a-target="chat-line-message-body"]',
        username: '.chat-author__display-name',
        chatterName: '.chatter-name',
        notice: '[data-test-selector="user-notice-line"]',
        systemNotice: '[data-seventv-system-notice],.seventv-system-notice-line',
        resubCustom: '[data-a-target="chat-resubscription-message__custom-message"]',
        massGiftName: '.mystery-gift-theme__displayname',
        massGiftImage: '.mystery-gift-theme__image',
        massGiftOverlay: '.mystery-gift-theme__overlay',
        emote: 'img[data-emote-name],img.seventv-emote,img.chat-image,img.chat-line__message--emote'
    };

    const log = (...args) => { if (CONFIG.debug) console.log('[BTC]', ...args); };

    // Compteurs alimentés par le traitement, lus par l'auto-diagnostic.
    const diag = { lignes: 0, reponses: 0, reponsesRatees: 0, notices: 0, verifieA: 0 };

    // =========================================================================
    // TEXTES — reconnaissance FR + EN
    // =========================================================================
    const RE = {
        // « Répond à @user : texte » / « Replying to @user: text »
        replyPrefix: /^\s*(?:Répond\s+à|En\s+réponse\s+à|Replying\s+to)\s*/i,
        // Twitch annonce une réponse dans l'aria-label de la ligne : « Réponse à X, … ».
        // Sert à repérer une réponse que nous n'aurions PAS su découper — le signal de
        // casse le plus fiable, car positif plutôt que fondé sur une absence.
        replyAria: /^\s*(?:Réponse\s+à|Replying\s+to|En\s+réponse\s+à)/i,
        // « offre 50 abonnements de niveau 1 à la communauté » / « is gifting 50 Tier 1 Subs »
        massGift: /(?:offre|a\s+offert)\s+([\d\s .,]+?)\s*abonnements?\b|is\s+gifting\s+([\d,]+)\s*Tier/i,
        // « a offert un abonnement de niveau 1 à X » / « Gifted a Tier 1 Sub to X »
        singleGift: /a\s+offert\s+un\s+abonnement|gifted\s+a\s+.*\bsub\s+to\b/i,
        tier: /(?:niveau|Tier)\s*(\d)/i,
        totalGifts: /(?:d[ée]j[àa]\s+offert|total\s+of)\s+([\d\s .,]+?)\s*(?:abonnements?|Subs?)/i,
        subscribed: /s'est\s+abonn|subscribed\s+(?:with|at|for)/i,
        raid: /a\s+lanc[ée]\s+un\s+raid|raided\s+with\s+a\s+viewer\s+count/i
    };

    // 7TV laisse ses notices système en anglais quelle que soit la langue de Twitch.
    const SYSTEM_NOTICE_FR = [
        [/^(\S+)\s+was\s+timed\s+out\s+for\s+(\d+)\s+seconds?$/i, (m) => `${m[1]} a été exclu ${m[2]} s`],
        [/^(\S+)\s+was\s+permanently\s+banned$/i, (m) => `${m[1]} a été banni définitivement`],
        [/^(\S+)\s+was\s+unbanned$/i, (m) => `${m[1]} a été débanni`],
        [/^(\d+)\s+messages?\s+deleted$/i, (m) => `${m[1]} message(s) supprimé(s)`],
        [/^message\s+deleted$/i, () => 'message supprimé']
    ];

    // Repli si l'interface Twitch est en anglais.
    const NOTICE_FR = [
        [/\bsubscribed with Prime\b/gi, "s'est abonné avec Prime"],
        [/\bsubscribed at Tier (\d)\b/gi, "s'est abonné au niveau $1"],
        [/\bThey've subscribed for (\d+) months?\b/gi, 'abonné depuis $1 mois'],
        [/\bis gifting (\d+) Tier (\d) Subs to the community\b/gi, 'offre $1 abonnements de niveau $2 à la communauté'],
        [/\bGifted a Tier (\d) Sub to\b/gi, 'a offert un abonnement de niveau $1 à'],
        [/\bThey've gifted a total of (\d+) Subs in the channel\b/gi, 'a déjà offert $1 abonnements sur cette chaîne'],
        [/\bIt's their first Gift Sub in the channel\b/gi, 'premier abonnement offert sur cette chaîne'],
        [/\braided with a viewer count of (\d+)\b/gi, 'a lancé un raid avec $1 viewers'],
        [/\bWatch Streak Reached!?:?\s*/gi, ''],
        [/\bis currently on a (\d+)-?stream streak\b/gi, 'est sur une série de $1 streams'],
        [/\s*!?\s*in\s+\S+'s channel\b/gi, ''],
        [/\bredeemed\b/gi, 'a utilisé']
    ];

    const normalizeSpaces = (s) => s.replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
    const parseCount = (raw) => {
        if (!raw) return 0;
        const n = parseInt(raw.replace(/[\s .,]/g, ''), 10);
        return Number.isFinite(n) ? n : 0;
    };

    // =========================================================================
    // CSS
    // =========================================================================
    /**
     * Trois façons de présenter la citation. Elles partagent le même HTML : seule la
     * mise en forme change, via CONFIG.reply.style.
     *
     *  rail   — la citation fait corps avec le message : aucun cadre, aucun fond propre,
     *           un filet vertical dans la couleur de grade court le long de l'ensemble.
     *  inline — encore plus léger : la citation est simplement la première ligne du
     *           message, en gris et plus petite. Aucun filet.
     *  card   — la citation est un bloc détaché avec son propre fond et sa bordure.
     */
    const buildReplyStyles = (r) => ({
        rail: `
        /* Le filet est un box-shadow interne : contrairement à une bordure, il ne
           décale pas le texte et se superpose proprement à celui de 7TV. */
        .chat-line__message.btc-reply.btc-reply {
            box-shadow: inset ${r.accentWidth} 0 0 0 var(--btc-reply-accent);
        }
        .btc-reply-slot.btc-reply-slot {
            background: none !important;
            border: 0 !important;
            padding: 0 !important;
            margin: 0 0 1px 0 !important;
        }`,

        inline: `
        .btc-reply-slot.btc-reply-slot {
            background: none !important;
            border: 0 !important;
            padding: 0 !important;
            margin: 0 0 1px 0 !important;
        }`,

        card: `
        .btc-reply-slot.btc-reply-slot {
            background-image: linear-gradient(var(--btc-reply-block-tint), var(--btc-reply-block-tint));
            border-left: ${r.accentWidth} solid var(--btc-reply-accent);
            border-radius: 2px;
            padding: 2px 6px !important;
            margin: 1px 0 3px 0 !important;
        }`
    });

    const buildCSS = () => {
        const r = CONFIG.reply;
        const c = CONFIG.compact;
        const REPLY_STYLES = buildReplyStyles(r);

        // Spécificité renforcée. Twitch stylise la citation via une classe
        // styled-components hachée (.OLUUU au moment où ceci est écrit) qui déclare
        // `font-size: var(--font-size-5) !important`. À spécificité égale (0,1,0) et
        // avec !important des deux côtés, c'est l'ordre du document qui tranche — et
        // styled-components injecte ses feuilles après la nôtre, donc nous perdions.
        // La classe doublée porte la spécificité à (0,2,0), le sélecteur de type à
        // (0,2,1) : nous passons devant quel que soit l'ordre, sans dépendre du hachage
        // de Twitch qui change à chaque build.
        const Q = 'p.btc-reply-quote.btc-reply-quote';
        const S = '.btc-reply-slot.btc-reply-slot';
        const L = '.chat-line__message.btc-reply.btc-reply';

        return `
        :root {
            --btc-reply-line-tint: ${r.lineTint};
            --btc-reply-block-tint: ${r.blockTint};
            --btc-reply-color: ${r.color};
            --btc-reply-font-scale: ${r.fontScale};
            --btc-reply-emote-height: ${r.emoteHeight};
            --btc-reply-accent: ${r.accentFallback};
        }

        /* ---------- 1. Message qui répond à quelqu'un ---------- */
        /* Teinte additive : elle se compose avec le fond posé par 7TV (highlight de
           grade, first-time chatter…) au lieu de l'écraser. */
        .chat-line__message.btc-reply.btc-reply {
            background-image: linear-gradient(var(--btc-reply-line-tint), var(--btc-reply-line-tint));
        }

        /* ---------- 2. Citation ---------- */
        ${REPLY_STYLES[r.style] || REPLY_STYLES.rail}

        ${S} > * {
            align-items: flex-start !important;
        }
        /* La bulle vit dans un wrapper en display:block plus haut qu'elle. Alignée en
           haut de la rangée, elle flottait au-dessus du texte, et le décalage variait
           selon que la première ligne contenait une emote ou non. On donne au wrapper
           la hauteur exacte d'une ligne de citation et on y centre la bulle :
           l'ancrage devient indépendant du contenu. */
        ${S} .tw-svg,
        ${S} > * > div:first-child:has(svg) {
            height: calc(var(--btc-reply-font-scale, ${r.fontScale}) * ${r.lineHeight}em) !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            flex: 0 0 auto !important;
        }
        /* Twitch tronque la citation avec overflow:hidden posé sur des wrappers
           intermédiaires : on les neutralise pour que le texte puisse se dérouler. */
        ${S},
        ${S} > *,
        ${S} > * > * {
            overflow: visible !important;
            max-height: none !important;
            min-width: 0 !important;
        }
        ${Q} {
            display: block !important;
            white-space: normal !important;
            overflow: visible !important;
            text-overflow: clip !important;
            -webkit-line-clamp: none !important;
            -webkit-box-orient: initial !important;
            max-height: none !important;
            height: auto !important;
            font-size: calc(1em * var(--btc-reply-font-scale, ${r.fontScale})) !important;
            line-height: ${r.lineHeight} !important;
            color: var(--btc-reply-color) !important;
            overflow-wrap: anywhere !important;
        }
        ${Q} .btc-reply-emote {
            height: var(--btc-reply-emote-height) !important;
            width: auto !important;
            vertical-align: -0.32em !important;
            margin: 0 1px !important;
            display: inline-block !important;
        }
        ${Q} .btc-reply-mention {
            color: inherit !important;
            font-weight: 600 !important;
        }
        ${Q} .btc-reply-target {
            font-weight: 600 !important;
        }
        ${S} svg {
            width: calc(var(--btc-reply-font-scale, ${r.fontScale}) * 1.15em) !important;
            height: calc(var(--btc-reply-font-scale, ${r.fontScale}) * 1.15em) !important;
            opacity: 0.55;
            flex-shrink: 0;
        }
        ${r.showIcon ? '' : `${S} svg { display: none !important; }`}

        /* ---------- 3. Notices sub / prime / gift compactées ---------- */
        ${c.enabled ? `
        .btc-notice-card {
            padding: 3px 8px !important;
            margin: 1px 0 !important;
        }
        .btc-notice-bar {
            width: 3px !important;
            min-width: 3px !important;
        }
        .btc-notice-line {
            font-size: ${c.fontSize} !important;
            line-height: ${c.lineHeight} !important;
            padding: 0 !important;
        }
        .btc-notice-line p,
        .btc-notice-line span:not(.btc-gift-recipient) {
            line-height: ${c.lineHeight} !important;
        }
        .btc-notice-line > * svg {
            width: ${c.iconSize} !important;
            height: ${c.iconSize} !important;
        }
        /* Le message personnalisé d'un resub reste à taille normale. */
        .btc-notice-line ${SEL.resubCustom} {
            font-size: 14px !important;
            line-height: 1.5 !important;
            margin-top: 2px !important;
        }
        .btc-notice-line ${SEL.resubCustom} svg {
            width: auto !important;
            height: auto !important;
        }
        /* Illustration « cadeau mystère » : de 100 px de haut à une vignette. */
        .btc-notice-line ${SEL.massGiftImage} {
            width: 26px !important;
            height: 26px !important;
            object-fit: contain !important;
            margin: 0 6px 0 0 !important;
        }
        .btc-notice-line ${SEL.massGiftOverlay} {
            display: none !important;
        }
        .btc-notice-line ${SEL.massGiftName} {
            display: inline !important;
            font-size: ${c.fontSize} !important;
            margin: 0 !important;
        }
        /* Le nom du donateur est un <p> passé en inline : sans ça, il se recolle au
           texte qui suit (« SquidNinja00offre 50 abonnements »). */
        .btc-notice-line ${SEL.massGiftName}::after {
            content: " ";
            white-space: pre;
        }
        ` : ''}

        /* ---------- Regroupement des gifts multiples ---------- */
        .btc-hidden { display: none !important; }
        .btc-gift-recipients {
            margin: 3px 0 0 32px;
            color: hsla(0, 0%, 100%, 0.72);
            font-size: 0.95em;
            line-height: 1.35;
            overflow-wrap: anywhere;
        }
        .btc-gift-recipient:not(:last-child)::after {
            content: ", ";
            color: hsla(0, 0%, 100%, 0.45);
        }
        .btc-gift-pending {
            opacity: 0.6;
            font-style: italic;
        }

        /* ---------- Séparateurs ---------- */
        ${CONFIG.separators ? `
        .chat-line__message:not(.chat-line--inline),
        .btc-notice-card,
        .chat-line__status,
        .seventv-system-notice-line {
            border-bottom: 1px solid hsla(0, 0%, 100%, 0.08) !important;
            padding-bottom: 4px !important;
        }
        ` : ''}

        /* ---------- Alignement emotes / badges ---------- */
        .chat-line__message .chat-badge {
            vertical-align: -0.15em !important;
        }
        `;
    };

    const injectCSS = () => {
        const id = 'btc-styles';
        let style = document.getElementById(id);
        if (!style) {
            style = document.createElement('style');
            style.id = id;
            (document.head || document.documentElement).appendChild(style);
        }
        style.textContent = buildCSS();
    };

    // =========================================================================
    // INDEX DES EMOTES
    // Twitch ne met que du texte brut dans la citation d'une réponse. Pour y
    // réafficher les emotes, on indexe celles qui passent dans le chat.
    // =========================================================================
    const EMOTE_INDEX_MAX = 600;
    const emoteIndex = new Map(); // nom -> url

    const urlFromSrcset = (srcset) => {
        if (!srcset) return null;
        // « url 1x, url 2x, url 3x » — on prend le 2x s'il existe, sinon le premier.
        const entries = srcset.split(',').map(s => s.trim()).filter(Boolean);
        if (!entries.length) return null;
        const two = entries.find(e => /\s2x$/.test(e));
        return (two || entries[0]).split(/\s+/)[0] || null;
    };

    const rememberEmote = (img) => {
        const name = img.dataset.emoteName || img.getAttribute('alt');
        if (!name || emoteIndex.has(name)) return;
        const url = img.dataset.fallbackImageUrl
            || urlFromSrcset(img.getAttribute('srcset'))
            || img.currentSrc
            || img.getAttribute('src');
        if (!url) return;
        if (emoteIndex.size >= EMOTE_INDEX_MAX) {
            // FIFO : on jette le plus ancien quart.
            let drop = Math.floor(EMOTE_INDEX_MAX / 4);
            for (const key of emoteIndex.keys()) {
                if (drop-- <= 0) break;
                emoteIndex.delete(key);
            }
        }
        emoteIndex.set(name, url);
    };

    const indexEmotes = (root) => {
        if (!CONFIG.reply.renderEmotes) return;
        let images;
        try { images = root.querySelectorAll(SEL.emote); } catch (e) { return; }
        for (const img of images) rememberEmote(img);
    };

    // =========================================================================
    // INDEX DES COULEURS DE PSEUDO
    // La citation ne contient que « @pseudo » en texte brut. On mémorise la couleur
    // de chat de chaque personne vue passer pour pouvoir la recolorer : on identifie
    // alors d'un coup d'œil à qui le message répond.
    // =========================================================================
    const NAME_INDEX_MAX = 400;
    const nameColors = new Map(); // pseudo en minuscules -> couleur

    // On indexe toujours, même quand la recoloration est désactivée : sinon activer
    // l'option depuis la console ne colorerait que les gens vus après coup.
    const indexNameColors = (root) => {
        let nodes;
        try { nodes = root.querySelectorAll(SEL.username); } catch (e) { return; }
        for (const el of nodes) {
            const login = (el.dataset.seventvUserLogin || el.dataset.aUser || el.textContent || '')
                .trim().toLowerCase();
            if (!login) continue;
            const color = el.style.color || el.dataset.seventvChatColor;
            if (!color) continue;
            if (nameColors.has(login)) continue;
            if (nameColors.size >= NAME_INDEX_MAX) {
                nameColors.delete(nameColors.keys().next().value);
            }
            nameColors.set(login, color);
        }
    };

    /** Recolore le « @pseudo » de la citation avec la couleur de chat de la personne. */
    const colorQuotedName = (quote, line) => {
        if (!CONFIG.reply.colorQuotedName) return;
        const span = quote.querySelector(':scope > span');
        if (!span) return;
        // 7TV expose le login exact de la personne citée sur la ligne. On le préfère au
        // texte affiché, qui peut être un nom international ou une casse différente.
        const login = (line && line.dataset.seventvReplyParentLogin
            || span.textContent.trim().replace(/^@/, '')).toLowerCase();
        if (!login) return;
        span.classList.add('btc-reply-target');
        const color = nameColors.get(login);
        if (color) span.style.color = color;
    };

    // =========================================================================
    // RÉPONSES
    // =========================================================================

    /**
     * Le bloc « réponse » n'a aucune classe stable. Twitch place systématiquement un
     * premier <div> vide dans .chat-line__message-container ; quand le message est une
     * réponse, ce div contient l'icône + un <p title="texte d'origine">.
     */
    const findReplyParts = (line) => {
        const container = line.querySelector(SEL.lineContainer);
        if (!container) return null;
        const slot = container.firstElementChild;
        if (!slot || slot.childElementCount === 0) return null;
        const quote = slot.querySelector('p');
        if (!quote) return null;
        return { slot, quote };
    };

    /** Récupère l'élément qui porte le texte du message d'origine dans la citation. */
    const findQuoteTextNode = (quote) => {
        // Structure observée : « Répond à <span>@user</span> : <span>texte</span> »
        const spans = quote.querySelectorAll(':scope > span');
        return spans.length ? spans[spans.length - 1] : null;
    };

    /** Remplace les noms d'emotes par des images et met les mentions en valeur. */
    const tokenizeQuote = (target) => {
        // Les nœuds déjà transformés sont ignorés : sans ça, une seconde passe
        // re-emballerait « @pseudo » dans une mention imbriquée dans la précédente.
        const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT, {
            acceptNode: (node) => {
                const parent = node.parentElement;
                return parent && (parent.classList.contains('btc-reply-mention')
                                  || parent.classList.contains('btc-reply-target'))
                    ? NodeFilter.FILTER_REJECT
                    : NodeFilter.FILTER_ACCEPT;
            }
        });
        const textNodes = [];
        let node;
        while ((node = walker.nextNode())) textNodes.push(node);

        for (const textNode of textNodes) {
            const text = textNode.textContent;
            if (!text || !text.trim()) continue;

            const parts = text.split(/(\s+)/);
            let needsWork = false;
            for (const part of parts) {
                const t = part.trim();
                if (!t) continue;
                if (emoteIndex.has(t) || (t.length > 1 && t[0] === '@')) { needsWork = true; break; }
            }
            if (!needsWork) continue;

            const frag = document.createDocumentFragment();
            for (const part of parts) {
                const t = part.trim();
                if (!t) { frag.appendChild(document.createTextNode(part)); continue; }

                if (emoteIndex.has(t)) {
                    const img = document.createElement('img');
                    img.src = emoteIndex.get(t);
                    img.alt = t;
                    img.title = t;
                    img.loading = 'lazy';
                    img.className = 'btc-reply-emote';
                    frag.appendChild(img);
                } else if (t.length > 1 && t[0] === '@') {
                    const span = document.createElement('span');
                    span.className = 'btc-reply-mention';
                    span.textContent = t;
                    frag.appendChild(span);
                } else {
                    frag.appendChild(document.createTextNode(part));
                }
            }
            if (textNode.parentNode) textNode.parentNode.replaceChild(frag, textNode);
        }
    };

    /** Retire « Répond à » / « Replying to » en gardant « @pseudo : texte ». */
    const stripReplyPrefix = (quote) => {
        for (const child of quote.childNodes) {
            if (child.nodeType !== Node.TEXT_NODE) continue;
            const stripped = child.textContent.replace(RE.replyPrefix, '');
            if (stripped !== child.textContent) {
                child.textContent = stripped;
                return true;
            }
            if (child.textContent.trim()) return false; // premier texte utile, pas un préfixe
        }
        return false;
    };

    /**
     * Reporte la couleur posée par 7TV (highlight de grade modo/VIP, first-time chatter,
     * highlight personnalisé) sur la barre latérale du bloc de citation. On lit le style
     * calculé plutôt que des classes précises : ça marche quelle que soit la façon dont
     * 7TV applique la couleur, et ça survivra à ses prochaines mises à jour.
     */
    const isTransparent = (color) =>
        !color || color === 'transparent' || /rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(color);

    const applyGradeAccent = (line) => {
        let accent = null;
        try {
            const cs = getComputedStyle(line);

            // Source la plus fiable : 7TV pose la couleur de sa règle de highlight en
            // variable inline sur la ligne. On la lit directement plutôt que de la
            // déduire du rendu, ce qui reste juste même s'il change sa façon de peindre.
            const declared = (cs.getPropertyValue('--seventv-chat-custom-highlight-border-color')
                || cs.getPropertyValue('--seventv-chat-custom-highlight-color')).trim();

            if (declared) {
                accent = declared;
            } else if (parseFloat(cs.borderLeftWidth) > 0 && !isTransparent(cs.borderLeftColor)) {
                accent = cs.borderLeftColor;
            } else if (!isTransparent(cs.backgroundColor)) {
                // Fond de grade semi-transparent : on en reprend la teinte, opacifiée,
                // pour que la barre reste lisible.
                const m = cs.backgroundColor.match(/rgba?\(([^)]+)\)/);
                if (m) {
                    const [red, green, blue] = m[1].split(',').map(v => parseFloat(v));
                    accent = `rgba(${red}, ${green}, ${blue}, 0.85)`;
                }
            }
        } catch (e) { /* style indisponible */ }

        if (accent) line.style.setProperty('--btc-reply-accent', accent);
        else line.style.removeProperty('--btc-reply-accent');
    };

    /** Twitch signale une réponse par l'aria-label ; 7TV par un attribut dédié. */
    const looksLikeReply = (line) => !!line.dataset.seventvReplyParentLogin
        || RE.replyAria.test(line.getAttribute('aria-label') || '');

    const processReply = (line) => {
        const parts = findReplyParts(line);
        if (!parts) {
            // Twitch dit que c'est une réponse mais nous n'avons pas trouvé la citation :
            // la structure a changé. C'est exactement ce qui a tué la v14 en silence.
            if (looksLikeReply(line)) diag.reponsesRatees++;
            return;
        }
        diag.reponses++;
        const { slot, quote } = parts;

        line.classList.add('btc-reply');
        slot.classList.add('btc-reply-slot');
        quote.classList.add('btc-reply-quote');
        applyGradeAccent(line);

        // Idempotence. On se repère sur l'attribut title, qui porte le texte d'origine
        // et que Twitch met à jour quand React recycle la ligne pour un autre message.
        // Surtout pas sur textContent : on le modifie nous-mêmes, donc il dériverait et
        // le bloc serait retraité en boucle.
        const key = quote.getAttribute('title');
        if (key !== null) {
            if (quote.dataset.btcQuote === key) return;
            quote.dataset.btcQuote = key;
        } else {
            if (quote.dataset.btcQuote === '1') return;
            quote.dataset.btcQuote = '1';
        }

        if (CONFIG.reply.hidePrefix) stripReplyPrefix(quote);
        colorQuotedName(quote, line);

        if (CONFIG.reply.renderEmotes) {
            const target = findQuoteTextNode(quote) || quote;
            tokenizeQuote(target);
        }
        log('réponse traitée', key.slice(0, 60));
    };

    // =========================================================================
    // NOTICES (sub, prime, gift, raid…)
    // =========================================================================

    const translateNotice = (element) => {
        if (!CONFIG.translate) return;
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
            let text = node.textContent;
            if (!text || text.length < 3) continue;
            let out = text;
            for (const [re, to] of NOTICE_FR) {
                re.lastIndex = 0;
                if (re.test(out)) { re.lastIndex = 0; out = out.replace(re, to); }
            }
            if (out !== text) node.textContent = out.replace(/\s+([.,!?])/g, '$1');
        }
    };

    const translateSystemNotice = (element) => {
        if (!CONFIG.translate) return;
        const span = element.querySelector('.seventv-system-notice') || element;
        const text = normalizeSpaces(span.textContent || '');
        if (!text) return;
        for (const [re, build] of SYSTEM_NOTICE_FR) {
            const m = text.match(re);
            if (m) { span.textContent = build(m); return; }
        }
    };

    const compactNotice = (noticeLine) => {
        if (!CONFIG.compact.enabled) return;
        noticeLine.classList.add('btc-notice-line');

        // La « carte » est le parent qui porte le fond et la barre de couleur. On ne
        // la décore que si c'est bien un conteneur dédié : jamais la racine du chat,
        // sinon le padding s'appliquerait à toute la liste.
        const card = noticeLine.parentElement;
        if (!card || card === chatRoot || card.classList.contains('btc-notice-card')) return;
        if (card.childElementCount > 3) return;

        card.classList.add('btc-notice-card');
        // La barre de couleur est le frère précédent : un div vide avec un
        // background inline.
        const bar = noticeLine.previousElementSibling;
        if (bar && !bar.childElementCount && bar.getAttribute('style')) {
            bar.classList.add('btc-notice-bar');
        }
    };

    // =========================================================================
    // REGROUPEMENT DES GIFTS MULTIPLES
    // =========================================================================
    const gifts = {
        pending: new Map(),   // donateur -> { notice, expected, recipients, listEl, timer, ts }
        recent: [],           // gifts individuels vus récemment : { donor, recipient, line, ts }

        MAX_PENDING: 8,

        prune(now) {
            const cutoff = now - CONFIG.compact.giftLookbehindMs;
            let i = 0;
            while (i < this.recent.length && this.recent[i].ts < cutoff) i++;
            if (i) this.recent.splice(0, i);
        },

        open(donor, notice, expected, tier) {
            this.close(donor);
            if (this.pending.size >= this.MAX_PENDING) {
                const oldest = [...this.pending.keys()][0];
                this.close(oldest);
            }
            const listEl = document.createElement('div');
            listEl.className = 'btc-gift-recipients btc-gift-pending';
            notice.appendChild(listEl);

            const entry = {
                notice, expected, tier, listEl,
                recipients: [], ts: Date.now(), timer: null
            };
            entry.timer = setTimeout(() => this.close(donor), CONFIG.compact.giftWindowMs);
            this.pending.set(donor, entry);

            // Rattrapage : certains gifts individuels arrivent avant l'annonce.
            this.prune(Date.now());
            for (const g of this.recent) {
                if (g.donor === donor) this.absorb(donor, g.recipient, g.line);
            }
            this.render(donor);
            log('gift multiple ouvert', donor, expected);
        },

        absorb(donor, recipient, line) {
            const entry = this.pending.get(donor);
            if (!entry) return false;
            if (entry.recipients.length >= entry.expected) return false;
            if (entry.recipients.includes(recipient)) return false;
            entry.recipients.push(recipient);
            line.classList.add('btc-hidden');
            return true;
        },

        render(donor) {
            const entry = this.pending.get(donor);
            if (!entry) return;
            const { listEl, recipients, expected } = entry;
            listEl.textContent = '';
            for (const name of recipients) {
                const span = document.createElement('span');
                span.className = 'btc-gift-recipient';
                span.textContent = name;
                listEl.appendChild(span);
            }
            const complete = recipients.length >= expected;
            listEl.classList.toggle('btc-gift-pending', !complete);
            if (!recipients.length) listEl.textContent = '';
        },

        close(donor) {
            const entry = this.pending.get(donor);
            if (!entry) return;
            clearTimeout(entry.timer);
            entry.listEl.classList.remove('btc-gift-pending');
            if (!entry.recipients.length) entry.listEl.remove();
            this.pending.delete(donor);
        },

        reset() {
            for (const entry of this.pending.values()) clearTimeout(entry.timer);
            this.pending.clear();
            this.recent.length = 0;
        }
    };

    const nameAt = (notice, index) => {
        const names = notice.querySelectorAll(SEL.chatterName);
        const el = names[index];
        return el ? normalizeSpaces(el.textContent) : null;
    };

    const processGiftNotice = (notice, text) => {
        if (!CONFIG.compact.aggregateGifts) return;

        const massMatch = text.match(RE.massGift);
        if (massMatch) {
            const expected = parseCount(massMatch[1] || massMatch[2]);
            const donorEl = notice.querySelector(`${SEL.massGiftName} ${SEL.chatterName}`)
                || notice.querySelector(SEL.chatterName);
            const donor = donorEl ? normalizeSpaces(donorEl.textContent) : null;
            const tier = (text.match(RE.tier) || [])[1] || '1';
            if (donor && expected > 0) gifts.open(donor, notice, expected, tier);
            return;
        }

        if (RE.singleGift.test(text)) {
            const donor = nameAt(notice, 0);
            const recipient = nameAt(notice, 1);
            if (!donor || !recipient) return;

            const line = notice.closest('.btc-notice-card')?.parentElement
                || notice.parentElement
                || notice;

            const now = Date.now();
            gifts.prune(now);
            gifts.recent.push({ donor, recipient, line, ts: now });

            if (gifts.absorb(donor, recipient, line)) {
                gifts.render(donor);
                const entry = gifts.pending.get(donor);
                if (entry && entry.recipients.length >= entry.expected) gifts.close(donor);
            }
        }
    };

    const processNotice = (notice) => {
        if (notice.dataset.btcNotice === '1') return;
        notice.dataset.btcNotice = '1';
        diag.notices++;

        translateNotice(notice);
        compactNotice(notice);

        const text = normalizeSpaces(notice.textContent || '');
        processGiftNotice(notice, text);
    };

    // =========================================================================
    // TRAITEMENT D'UNE LIGNE
    // =========================================================================
    const processLine = (element) => {
        if (!element || element.nodeType !== Node.ELEMENT_NODE) return;

        indexEmotes(element);
        indexNameColors(element);

        // Notices système 7TV (exclusions, suppressions) — toujours en anglais.
        if (element.matches?.(SEL.systemNotice)) {
            translateSystemNotice(element);
        } else {
            for (const n of element.querySelectorAll(SEL.systemNotice)) translateSystemNotice(n);
        }

        // Notices Twitch (sub, prime, gift, raid…). Les notices système 7TV portent le
        // même data-test-selector mais sont déjà compactes : on les laisse tranquilles.
        const isTwitchNotice = (n) => !n.matches(SEL.systemNotice);
        if (element.matches?.(SEL.notice) && isTwitchNotice(element)) processNotice(element);
        for (const n of element.querySelectorAll(SEL.notice)) {
            if (isTwitchNotice(n)) processNotice(n);
        }

        // Messages utilisateur
        if (element.matches?.(SEL.line)) { diag.lignes++; processReply(element); }
        for (const line of element.querySelectorAll(SEL.line)) { diag.lignes++; processReply(line); }
    };

    // =========================================================================
    // AUTO-DIAGNOSTIC
    // La v14 est morte en silence : ses sélecteurs ne correspondaient plus à rien et
    // rien ne le signalait. Twitch change ses classes hachées à chaque build et 7TV
    // réécrit son extension ; ce contrôle transforme une casse muette en avertissement
    // lisible, avec le renvoi vers l'enregistreur DOM.
    // =========================================================================
    const SELF_CHECK_DELAY = 20000;
    let selfCheckTimer = null;
    let selfCheckDone = false;

    const runSelfCheck = ({ verbeux = false } = {}) => {
        const sondes = [];
        const add = (nom, ok, indice) => sondes.push({ ancre: nom, ok, indice });
        const root = chatRoot;

        add('conteneur du chat', !!root, SEL.chatRoot[0]);
        if (root) {
            add('ligne de message', !!root.querySelector(SEL.line), SEL.line);
            add('corps du message', !!root.querySelector(SEL.body), SEL.body);
            add('pseudo', !!root.querySelector(SEL.username), SEL.username);
            add('conteneur de ligne', !!root.querySelector(SEL.lineContainer), SEL.lineContainer);
        }
        add('feuille de style injectée', !!document.getElementById('btc-styles'), '#btc-styles');
        // Ancre conditionnelle : on ne peut pas conclure de l'absence de réponse, mais
        // une réponse annoncée par Twitch et non découpée est une preuve de casse.
        add('bloc de citation', diag.reponsesRatees === 0,
            '.chat-line__message-container > premier enfant non vide');

        diag.verifieA = Date.now();
        const cassees = sondes.filter(p => !p.ok);
        const inactif = diag.lignes === 0 && diag.notices === 0;

        if (cassees.length && !inactif) {
            console.warn(
                `[BetterTwitchChat] ${cassees.length} ancre(s) ne correspondent plus au DOM.\n` +
                cassees.map(p => `  ✗ ${p.ancre} — ${p.indice}`).join('\n') +
                '\nTwitch ou 7TV a probablement changé sa structure. Pour la recapturer :' +
                '\ntools/7tv-dom-recorder.user.js du dépôt, puis transmettre le JSON exporté.'
            );
        } else if (verbeux) {
            console.log('[BetterTwitchChat] toutes les ancres répondent.');
        }
        if (verbeux) console.table(sondes);

        return {
            ok: cassees.length === 0,
            inactif,
            sondes,
            compteurs: { ...diag }
        };
    };

    const scheduleSelfCheck = () => {
        clearTimeout(selfCheckTimer);
        selfCheckDone = false;
        selfCheckTimer = setTimeout(() => {
            if (selfCheckDone) return;
            selfCheckDone = true;
            runSelfCheck();
        }, SELF_CHECK_DELAY);
    };

    // =========================================================================
    // OBSERVATEUR
    // =========================================================================
    let chatRoot = null;
    let observer = null;
    let queue = [];
    let frameScheduled = false;
    const QUEUE_MAX = 120;

    const flush = () => {
        const batch = queue;
        queue = [];
        frameScheduled = false;
        for (const node of batch) {
            if (node.isConnected) {
                try { processLine(node); }
                catch (e) { console.error('[BTC] échec du traitement', e); }
            }
        }
    };

    const enqueue = (node) => {
        if (queue.length >= QUEUE_MAX) queue.shift();
        queue.push(node);
        if (!frameScheduled) {
            frameScheduled = true;
            requestAnimationFrame(flush);
        }
    };

    const onMutations = (mutations) => {
        for (const m of mutations) {
            if (m.type === 'childList') {
                for (const node of m.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) enqueue(node);
                }
            } else if (m.type === 'attributes') {
                // 7TV pose ses classes de highlight après l'insertion : il faut
                // recalculer la couleur d'accent de la citation.
                const t = m.target;
                if (t.nodeType === Node.ELEMENT_NODE && t.classList?.contains('btc-reply')) {
                    applyGradeAccent(t);
                }
            }
        }
    };

    const start = (root) => {
        if (observer) observer.disconnect();
        chatRoot = root;
        observer = new MutationObserver(onMutations);
        observer.observe(root, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'data-seventv-processed']
        });
        processLine(root);
        scheduleSelfCheck();
        log('démarré sur', root.className);
    };

    const findChatRoot = () => {
        for (const sel of SEL.chatRoot) {
            const el = document.querySelector(sel);
            if (el) return el;
        }
        return null;
    };

    let retryTimer = null;
    const connect = () => {
        clearInterval(retryTimer);
        const found = findChatRoot();
        if (found) { start(found); return; }
        let attempts = 0;
        retryTimer = setInterval(() => {
            const root = findChatRoot();
            if (root) { clearInterval(retryTimer); start(root); }
            else if (++attempts > 60) clearInterval(retryTimer);
        }, 1000);
    };

    // =========================================================================
    // NAVIGATION SPA
    // =========================================================================
    const teardown = () => {
        if (observer) { observer.disconnect(); observer = null; }
        clearInterval(retryTimer);
        clearTimeout(selfCheckTimer);
        diag.lignes = diag.reponses = diag.reponsesRatees = diag.notices = 0;
        queue = [];
        frameScheduled = false;
        chatRoot = null;
        emoteIndex.clear();
        gifts.reset();
    };

    const watchNavigation = () => {
        let lastUrl = location.href;
        const onChange = () => {
            if (location.href === lastUrl) return;
            lastUrl = location.href;
            teardown();
            setTimeout(connect, 600);
        };
        window.addEventListener('popstate', onChange);
        const push = history.pushState;
        const replace = history.replaceState;
        history.pushState = function (...args) { push.apply(this, args); onChange(); };
        history.replaceState = function (...args) { replace.apply(this, args); onChange(); };
    };

    // =========================================================================
    // DÉMARRAGE
    // =========================================================================
    injectCSS();
    watchNavigation();
    connect();

    // Point d'entrée pour bidouiller la config depuis la console.
    window.__BTC = {
        config: CONFIG,
        // Réapplique la config en cours. Le garde-fou d'idempotence des citations est
        // levé au passage, sinon un réglage modifié depuis la console n'aurait aucun
        // effet sur les messages déjà affichés.
        reload() {
            injectCSS();
            if (!chatRoot) return;
            for (const q of chatRoot.querySelectorAll('.btc-reply-quote')) {
                delete q.dataset.btcQuote;
            }
            processLine(chatRoot);
        },
        emotes: emoteIndex,
        gifts,
        // Contrôle des points d'accroche. Lancé seul 20 s après le démarrage ; à
        // rappeler à la main pour voir le détail.
        selfCheck: () => runSelfCheck({ verbeux: true }),

        // Diagnostic : dit quelle version tourne réellement et ce qui est appliqué.
        check() {
            const quote = document.querySelector('.btc-reply-quote');
            const body = document.querySelector(SEL.body);
            const info = {
                version: VERSION,
                style: CONFIG.reply.style,
                fontScale: CONFIG.reply.fontScale,
                tailleCitation: quote ? getComputedStyle(quote).fontSize : '(aucune réponse à l\'écran)',
                tailleMessage: body ? getComputedStyle(body).fontSize : '(aucun message à l\'écran)',
                reponsesTraitees: document.querySelectorAll('.btc-reply').length,
                emotesIndexees: emoteIndex.size,
                cssInjecte: !!document.getElementById('btc-styles')
            };
            console.table(info);
            return info;
        },

        /**
         * Explique QUI décide de la taille de la citation. Parcourt toutes les feuilles
         * de style, retient les règles qui visent réellement l'élément et déclarent une
         * font-size, et les rend dans l'ordre de la cascade. À utiliser quand la taille
         * ne correspond pas à `fontScale` : la dernière ligne gagnante est la coupable.
         */
        whyFontSize() {
            const quote = document.querySelector('.btc-reply-quote');
            if (!quote) { console.warn('[BTC] aucune réponse à l\'écran'); return null; }
            const matches = [];
            for (const sheet of document.styleSheets) {
                let rules;
                try { rules = sheet.cssRules; }
                catch (e) { matches.push({ origine: sheet.href || '(inline)', erreur: 'illisible (CORS)' }); continue; }
                if (!rules) continue;
                for (const rule of rules) {
                    if (!rule.style || !rule.selectorText) continue;
                    const value = rule.style.getPropertyValue('font-size');
                    if (!value) continue;
                    let hit = false;
                    try { hit = quote.matches(rule.selectorText); } catch (e) { /* sélecteur exotique */ }
                    if (!hit) continue;
                    matches.push({
                        origine: sheet.href ? sheet.href.split('/').pop() : (sheet.ownerNode?.id || '(inline)'),
                        selecteur: rule.selectorText,
                        valeur: value,
                        important: rule.style.getPropertyPriority('font-size') === 'important'
                    });
                }
            }
            const applique = getComputedStyle(quote).fontSize;
            console.log(`[BTC] taille réellement appliquée : ${applique}`);
            console.table(matches);
            return { applique, regles: matches };
        }
    };

    console.log(`[BetterTwitchChat] v${VERSION} — chat Twitch natif + 7TV`);
})();
