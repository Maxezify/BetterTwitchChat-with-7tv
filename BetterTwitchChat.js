// ==UserScript==
// @name         BetterTwitchChat (+ 7TV)
// @namespace    https://github.com/Maxezify/BetterTwitchChat-with-7tv
// @version      15.17.0
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
 *   [data-a-target="chat-scroller"]                                 élément qui défile
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

    const VERSION = '15.17.0';

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
            // Espace entre le bas de la citation et le début du message.
            gap: '10px',
            // Retire « Répond à » / « Replying to » et garde « @pseudo : texte ».
            hidePrefix: true,
            // Garde la petite bulle SVG à gauche de la citation.
            showIcon: true,
            // Reconstruit les emotes dans la citation (Twitch n'y met que du texte brut).
            renderEmotes: true,
            // Souligne les pseudos cités : celui de la personne à qui l'on répond et
            // les mentions présentes dans le texte cité.
            underlineNames: true,
            // Recolore le « @pseudo » cité avec sa vraie couleur de chat. Désactivé :
            // la couleur attire trop l'œil sur une citation censée rester discrète.
            colorQuotedName: false,
            // Volontairement calé sous l'interligne : une emote plus haute ferait
            // grandir la première ligne et désalignerait la bulle.
            emoteHeight: '1.3em',
            // Épaisseur du filet posé sur les réponses que 7TV ne colore pas. Là où il
            // en trace un, le nôtre s'efface : les deux s'additionneraient. Le sien est
            // déclaré en `.25rem`, donc sa valeur en pixels dépend de la police racine ;
            // 2 px est le réglage retenu à l'œil, à ajuster si le sien paraît différent.
            accentWidth: '2px',
            accentFallback: 'hsla(0, 0%, 100%, 0.4)'
        },

        // --- Notices sub / prime / gift / raid ---
        compact: {
            enabled: true,
            // Donne aux notices la typographie du texte cité : même taille, même gris.
            // Elles deviennent une information secondaire qu'on parcourt sans s'y
            // arrêter. Le pseudo garde sa couleur. À false, c'est `fontSize` qui règle
            // la taille et les notices gardent la couleur du texte de Twitch.
            quoteLook: true,
            // Redonne au pseudo d'une notice sa couleur de chat. Twitch ne la met pas :
            // le pseudo sort dans la couleur du texte, donc en gris comme le reste une
            // fois la notice compactée, et on ne voit plus de qui il s'agit.
            colorNames: true,
            // Teinte le fond de la notice avec la couleur de sa barre, comme 7TV teinte
            // les messages qu'il relève. Twitch pose la couleur d'accent de la chaîne en
            // style inline sur cette barre. 0 pour ne pas teindre du tout.
            tintOpacity: 0.15,
            fontSize: '12.5px',
            lineHeight: '1.35',
            iconSize: '15px',
            // Espace entre la barre de couleur et le texte de la notice.
            textIndent: '8px',
            // Regroupe « X offre N abonnements » + les N « X a offert un abonnement à Y »
            // en une seule notice avec la liste des destinataires.
            aggregateGifts: true,
            // Délai d'attente des gifts individuels après l'annonce du gift multiple.
            giftWindowMs: 12000,
            // Fenêtre de rattrapage pour les gifts arrivés avant l'annonce.
            giftLookbehindMs: 15000
        },

        // --- Divers ---
        // Trait de séparation entre les messages. Désactivé : 7TV en pose déjà un
        // (classe seventv-chat-lines-separator-twitch sur <html>), le nôtre doublait.
        separators: false,
        // Retire l'étiquette que 7TV accroche aux messages relevés par une règle
        // « Custom Highlights » (l'emoji ou le texte donné à la règle). On enlève
        // l'attribut qui la porte plutôt que de masquer son rendu : la règle qui
        // l'affiche vit dans une feuille de style d'extension qu'on ne peut pas lire,
        // et masquer les pseudo-éléments de la ligne emporterait aussi le séparateur
        // que 7TV y dessine. La couleur de grade, elle, n'est pas touchée.
        hideHighlightLabel: true,
        // Espace au-dessus des messages relevés par une règle « Custom Highlights ».
        // 7TV y réserve 1.3rem pour son étiquette et n'en met que 0.75rem en dessous ;
        // l'étiquette partie, l'espace est vide. Mettre null pour laisser 7TV décider.
        highlightPaddingTop: '0.75rem',
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
        emote: 'img[data-emote-name],img.seventv-emote,img.chat-image,img.chat-line__message--emote',
        // Élément qui porte réellement le défilement du chat. 7TV stylise lui-même sa
        // scrollbar sur ce sélecteur, c'est donc une ancre déclarée, pas devinée.
        scroller: '.scrollable-area[data-a-target="chat-scroller"],[data-a-target="chat-scroller"]'
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
           décale pas le texte du message.
           Pas de filet là où 7TV trace déjà le sien : les deux s'additionneraient et
           la barre paraîtrait deux fois trop épaisse sur les messages de grade. */
        .chat-line__message.btc-reply.btc-reply:not(.btc-native-accent) {
            box-shadow: inset ${r.accentWidth} 0 0 0 var(--btc-reply-accent);
        }
        .btc-reply-slot.btc-reply-slot {
            background: none !important;
            border: 0 !important;
            /* L'espace au-dessus est un padding, pas une marge : une marge haute
               s'effondrerait à travers les conteneurs sans bordure ni remplissage et
               s'appliquerait hors du fond du message au lieu d'aérer la citation. */
            padding: ${r.gap} 0 0 0 !important;
            margin: 0 0 ${r.gap} 0 !important;
        }`,

        inline: `
        .btc-reply-slot.btc-reply-slot {
            background: none !important;
            border: 0 !important;
            padding: ${r.gap} 0 0 0 !important;
            margin: 0 0 ${r.gap} 0 !important;
        }`,

        card: `
        .btc-reply-slot.btc-reply-slot {
            background-image: linear-gradient(var(--btc-reply-block-tint), var(--btc-reply-block-tint));
            border-left: ${r.accentWidth} solid var(--btc-reply-accent);
            border-radius: 2px;
            padding: calc(${r.gap} / 2) 6px !important;
            margin: ${r.gap} 0 ${r.gap} 0 !important;
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
        // Espace entre l'icône et le texte d'une notice. Nommé parce que deux règles
        // doivent s'accorder dessus : celle qui l'écarte, et celle qui aligne le message
        // d'abonnement sur ce même bord.
        const NOTICE_GAP = '6px';
        const Q = 'p.btc-reply-quote.btc-reply-quote';
        const NL = '.btc-notice-line.btc-notice-line';
        const NC = '.btc-notice-card.btc-notice-card';
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
            /* Assurance : la largeur peut venir d'un aspect-ratio mémorisé. S'il était
               faux, l'emote serait étirée plutôt que simplement mal cadrée. */
            object-fit: contain !important;
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
        ${r.underlineNames ? `
        ${Q} .btc-reply-mention,
        ${Q} .btc-reply-target {
            text-decoration: underline !important;
            text-underline-offset: 2px !important;
        }` : ''}
        ${S} svg {
            width: calc(var(--btc-reply-font-scale, ${r.fontScale}) * 1.15em) !important;
            height: calc(var(--btc-reply-font-scale, ${r.fontScale}) * 1.15em) !important;
            opacity: 0.55;
            flex-shrink: 0;
        }
        ${r.showIcon ? '' : `${S} svg { display: none !important; }`}

        /* ---------- 3. Notices sub / prime / gift compactées ---------- */
        ${c.enabled ? `
        /* Aucune marge à gauche de la carte : c'est elle qui décollait la barre de
           couleur du bord. L'espace avant le texte est repris sur la ligne de notice. */
        ${NC} {
            padding: 3px 8px 3px 0 !important;
            margin: 1px 0 !important;
            /* Teinte additive : posée en dégradé, elle se compose avec le fond de Twitch
               au lieu de l'écraser — même procédé que le fond des réponses. La variable
               est renseignée en JS depuis la couleur de la barre ; sans elle, la règle
               retombe sur du transparent et ne change rien. */
            background-image: linear-gradient(var(--btc-notice-tint, transparent),
                                              var(--btc-notice-tint, transparent)) !important;
        }
        ${NC} .btc-notice-bar {
            width: 3px !important;
            min-width: 3px !important;
        }
        ${NL} {
            /* Même expression que la citation, donc exactement la même taille rendue :
               une valeur en pixels recopiée à la main divergerait au premier réglage. */
            font-size: ${c.quoteLook
                ? `calc(1em * var(--btc-reply-font-scale, ${r.fontScale}))`
                : c.fontSize} !important;
            line-height: ${c.lineHeight} !important;
            padding: 0 0 0 ${c.textIndent} !important;
            /* Repère de positionnement pour l'icône, sortie du flux plus bas. */
            position: relative !important;
        }
        /* L'icône est centrée sur la notice entière, message d'abonnement compris. Elle
           ne peut donc pas rester dans la rangée icône + texte : cette rangée s'arrête
           au texte, et l'icône se retrouvait haut placée dès qu'un message suivait. On
           la sort du flux et on réserve sa place par un remplissage sur la notice — ce
           qui aligne du même coup TOUT le contenu, texte et message, sur un seul bord
           gauche, au lieu de dépendre d'un retrait recopié à deux endroits.
           Le remplissage n'est posé que s'il y a une icône : un gift multiple n'en a
           pas, et son texte serait décalé dans le vide. */
        ${NL}:has(.btc-notice-icon) {
            padding-left: calc(${c.textIndent} + ${c.iconSize} + ${NOTICE_GAP}) !important;
        }
        ${NL} .btc-notice-icon {
            position: absolute !important;
            left: ${c.textIndent} !important;
            top: 50% !important;
            transform: translateY(-50%) !important;
        }
        ${NL} p,
        ${NL} span:not(.btc-gift-recipient) {
            line-height: ${c.lineHeight} !important;
        }
        /* Twitch déclare la taille de police sur ses propres composants de texte — les
           classes CoreText hachées — et en !important. La taille posée sur la ligne de
           notice était donc réécrite fragment par fragment : la notice restait à la
           taille de Twitch pendant que le message d'abonnement, lui, suivait la nôtre.
           Même rapport de force que sur la citation, même parade : le sélecteur de type
           porte la spécificité à (0,2,1) et passe devant, sans dépendre d'un hachage qui
           change à chaque build. On hérite au lieu de recalculer — la ligne porte déjà
           la bonne taille, et répéter calc(1em * échelle) la réduirait à chaque niveau. */
        ${NL} p,
        ${NL} span,
        ${NL} div,
        ${NL} a,
        ${NL} b,
        ${NL} strong,
        ${NL} button {
            font-size: inherit !important;
        }
        ${NL} > * svg {
            width: ${c.iconSize} !important;
            height: ${c.iconSize} !important;
        }
        /* Le message écrit par la personne qui se réabonne est une ligne de chat
           complète, imbriquée dans la notice et rendue par Twitch à sa taille normale.
           Il vit hors du bloc de texte de la notice : aucune des règles de mise en
           ligne ne l'atteint, et il ressortait comme un corps étranger au milieu d'une
           notice à la taille d'une citation. Il prend donc la même typographie — ce
           sont, comme une citation, les mots de quelqu'un d'autre — mais garde son
           propre bloc : c'est du texte libre, le fondre dans la phrase de Twitch
           brouillerait qui parle.

           On hérite de la taille au lieu de réappliquer l'expression de la citation :
           celle-ci est relative au
           em du parent, et le parent est déjà réduit — la réappliquer ici réduirait une
           seconde fois. */
        ${NL} ${SEL.resubCustom} {
            font-size: ${c.quoteLook ? 'inherit' : '14px'} !important;
            line-height: ${c.quoteLook ? c.lineHeight : '1.5'} !important;
            /* Aucun retrait propre : le remplissage de la notice place déjà le message
               sur le même bord gauche que le texte de l'annonce. */
            margin: 2px 0 0 0 !important;
        }
        /* Twitch enveloppe pseudo et badges dans un <button>, dont la feuille par défaut
           du navigateur garde le remplissage et la bordure — 1px 6px et 2px, soit 8 px
           qui décalaient les badges vers la droite par rapport au texte de l'annonce.
           On neutralise la boîte du bouton plutôt que de compter sur Twitch pour le
           faire : rien ne garantit qu'il la réinitialise sur toutes ses pages. */
        ${NL} ${SEL.resubCustom} button {
            padding: 0 !important;
            border: 0 !important;
            margin: 0 !important;
            background: none !important;
            vertical-align: baseline !important;
        }
        /* La ligne imbriquée porte le remplissage d'un message de chat : dans une
           notice, ces 20 px de côté décalent le texte sans rien apporter. */
        ${NL} ${SEL.resubCustom} .chat-line__message {
            padding: 0 !important;
        }
        ${NL} ${SEL.resubCustom} svg {
            width: auto !important;
            height: auto !important;
        }
        /* Illustration « cadeau mystère » : de 100 px de haut à une vignette. */
        ${NL} ${SEL.massGiftImage} {
            width: 26px !important;
            height: 26px !important;
            object-fit: contain !important;
            margin: 0 6px 0 0 !important;
        }
        ${NL} ${SEL.massGiftOverlay} {
            display: none !important;
        }
        ${NL} ${SEL.massGiftName} {
            display: inline !important;
            font-size: ${c.quoteLook ? 'inherit' : c.fontSize} !important;
            margin: 0 !important;
        }
        /* Bord gauche irrégulier : l'icône vivait dans le flux du texte, si bien que la
           première ligne démarrait après elle et les suivantes revenaient sous elle. La
           rangée devient une colonne d'icône plus un bloc de texte, ce qui aligne toutes
           les lignes. Les trois rôles sont étiquetés en JS : la profondeur du porte-icône
           varie d'un type de notice à l'autre, un sélecteur CSS unique se tromperait de
           cible — il l'a fait. */
        /* L'icône étant hors du flux, la rangée n'a plus rien à répartir : un bloc
           ordinaire suffit, et le texte occupe toute la largeur restante. */
        ${NL} .btc-notice-row {
            display: block !important;
        }
        ${NL} .btc-notice-icon {
            height: calc(${c.lineHeight} * 1em) !important;
            width: ${c.iconSize} !important;
            display: flex !important;
            align-items: center !important;
        }
        ${NL} .btc-notice-text {
            display: block !important;
            min-width: 0 !important;
        }

        /* Twitch enveloppe le pseudo dans des conteneurs rendus en bloc, ce qui le
           pousse sur sa propre ligne au-dessus du texte de la notice. On les remet en
           ligne pour que la notice tienne en un seul paragraphe. Le conteneur
           intermédiaire est visé par sa structure et non par sa classe hachée. */
        ${NL} span:has(> .chatter-name),
        ${NL} .chatter-name,
        ${NL} .chatter-name span {
            display: inline !important;
        }

        /* Une notice tient en un seul flux. Le pseudo n'est pas le seul bloc que Twitch
           y place : une « série de visionnage » range le pseudo et les points de chaîne
           dans une rangée à part, au-dessus du texte, et cette rangée contient
           elle-même des <p> — soit trois retours à la ligne pour une seule notice.
           Plutôt que d'énumérer des structures qui changeront, tout ce qui vit dans le
           bloc de texte passe en ligne.

           Exception : le message personnalisé d'un resub, du texte libre écrit par la
           personne, garde son propre bloc. Le :not() le retire de la sélection et,
           accessoirement, porte la spécificité de cette règle au-dessus de celle qui le
           met en forme plus bas — l'ordre des règles ne décide donc de rien ici. */
        ${NL} .btc-notice-text div:not(:has(${SEL.resubCustom})),
        ${NL} .btc-notice-text p:not(${SEL.resubCustom}),
        ${NL} .btc-notice-text span:not(${SEL.resubCustom}) {
            display: inline !important;
        }

        /* Ces fragments étaient séparés par des sauts de bloc, pas par des espaces :
           mis bout à bout ils se recollent (« StreakUser01+ », « 450Série de visionnage
           atteinte ! »). On rend l'espace à tout fragment qui en précède un autre. Le
           dernier n'en reçoit pas, sinon la notice traînerait une espace en fin de
           ligne. Là où Twitch écrit déjà l'espace dans son texte, l'élément se trouve
           être le dernier de son parent : aucun doublon possible. */
        ${NL} .btc-notice-text div:not(:last-child)::after,
        ${NL} .btc-notice-text p:not(:last-child)::after,
        ${NL} .btc-notice-text .chatter-name:not(:last-child)::after {
            content: " ";
            white-space: pre;
        }

        /* Une boîte rendue en ligne ignore width et height : l'icône de points de
           chaîne, que Twitch dimensionnait par son conteneur, repartait à sa taille
           naturelle et faisait enfler la ligne. On la borne sur l'interligne.
           L'illustration du gift multiple a sa propre taille, plus bas. */
        ${NL} .btc-notice-text img:not(${SEL.massGiftImage}) {
            height: calc(${c.lineHeight} * 1em) !important;
            width: auto !important;
            vertical-align: -0.2em !important;
        }

        /* Le conteneur du nom du donateur peut être une colonne flex, qui garderait le
           pseudo au-dessus du texte malgré le display:inline. On le repasse en bloc.
           Visé par sa structure : sa classe est un hachage. */
        ${NL} div:has(> ${SEL.massGiftName}) {
            display: block !important;
        }

        /* Le nom du donateur est un <p> passé en inline : sans ça, il se recolle au
           texte qui suit (« SquidNinja00offre 50 abonnements »). */
        ${NL} ${SEL.massGiftName}::after {
            content: " ";
            white-space: pre;
        }

        /* Apparence « citation » : le texte de la notice reprend le gris du texte cité
           pour rester une information secondaire. Le pseudo est exclu — c'est lui qui
           permet de reconnaître la notice d'un coup d'œil, il garde sa couleur. */
        ${c.quoteLook ? `
        /* Visé sur la ligne de notice entière et non sur son bloc de texte : ce bloc
           n'est étiqueté qu'à partir de l'icône SVG, et un gift multiple n'en a pas —
           il restait blanc au milieu de notices grises.
           Les pseudos sont exclus : ce sont eux qui permettent de reconnaître la notice
           d'un coup d'œil. Leur couleur est posée en style inline par Twitch, qu'un
           !important de notre côté écraserait sans cette exception. */
        ${NL},
        ${NL} p:not(${SEL.massGiftName}),
        ${NL} span:not(.chatter-name):not(.chatter-name *):not(${SEL.username}):not(${SEL.username} *) {
            color: var(--btc-reply-color) !important;
        }
        /* Twitch enveloppe pseudo et badges dans un <button>, et la feuille par défaut
           du navigateur y impose 13.33px sans héritage. Tout ce qui s'exprime en em à
           l'intérieur se résout donc sur cette taille-là et non sur celle de la notice.
           On rétablit l'héritage sur tout le sous-arbre avant de dimensionner quoi que
           ce soit en em. */
        ${NL} ${SEL.resubCustom} * {
            font-size: inherit !important;
        }
        /* Badges remis à l'échelle du texte réduit. */
        ${NL} ${SEL.resubCustom} .chat-badge {
            height: calc(${c.lineHeight} * 1em) !important;
            width: auto !important;
        }
        /* Un pseudo dont la couleur reste inconnue — la personne n'a pas encore parlé —
           ne doit pas fondre dans le gris de la notice : il garde la couleur de texte
           de Twitch, comme avant compactage. Le style inline posé par le script quand
           la couleur est connue passe devant, un !important en ligne l'emportant sur un
           !important de feuille quelle que soit la spécificité. */
        ${NL} .chatter-name,
        ${NL} ${SEL.massGiftName} {
            color: var(--color-text-base, #efeff1) !important;
        }
        /* Un pseudo dont on a retrouvé la couleur : les enveloppes intérieures que
           Twitch colore par ses propres classes doivent suivre la nôtre. Posée
           uniquement sur les pseudos recolorés, pour que les autres gardent le rendu
           de Twitch au lieu de virer au gris. */
        ${NL} .btc-notice-name span {
            color: inherit !important;
        }
        ` : ''}
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

        /* ---------- Espace au-dessus des messages relevés par 7TV ---------- */
        /* 7TV réserve 1.3rem au-dessus de ces messages pour y poser son étiquette de
           règle, contre 0.75rem en dessous. L'étiquette retirée, ce déséquilibre ne
           correspond plus à rien. Sa règle a une spécificité de (0,10,0) — un :is()
           suivi de huit :not() — mais elle n'est pas !important : la nôtre l'emporte
           donc sans avoir à rivaliser de sélecteur. */
        ${CONFIG.highlightPaddingTop ? `
        .seventv-chat-message-custom-highlight {
            padding-top: ${CONFIG.highlightPaddingTop} !important;
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
    // nom -> { url, ratio }. Le ratio largeur/hauteur sert à réserver la place de
    // l'emote dans la citation avant son chargement : sans lui l'image naît à zéro de
    // large puis s'élargit d'un coup, la citation se re-découpe et le message grandit
    // une seconde fois — après que Twitch a recollé le chat en bas.
    const emoteIndex = new Map();

    const urlFromSrcset = (srcset) => {
        if (!srcset) return null;
        // « url 1x, url 2x, url 3x » — on prend le 2x s'il existe, sinon le premier.
        const entries = srcset.split(',').map(s => s.trim()).filter(Boolean);
        if (!entries.length) return null;
        const two = entries.find(e => /\s2x$/.test(e));
        return (two || entries[0]).split(/\s+/)[0] || null;
    };

    /** Ratio plausible pour une emote : au-delà, c'est une mesure aberrante. */
    const ratioPlausible = (r) => (r > 0.1 && r < 12 ? r : 0);

    const rememberEmote = (img) => {
        const name = img.dataset.emoteName || img.getAttribute('alt');
        if (!name) return;
        const connu = emoteIndex.get(name);
        // Déjà connue avec ses proportions : plus rien à en tirer. Sans elles on
        // retente, l'image de la fois précédente n'était pas encore chargée. On lit
        // uniquement les dimensions naturelles : mesurer la boîte forcerait un calcul
        // de mise en page sur chaque emote de chaque message.
        if (connu && connu.ratio) return;
        const url = (connu && connu.url)
            || img.dataset.fallbackImageUrl
            || urlFromSrcset(img.getAttribute('srcset'))
            || img.currentSrc
            || img.getAttribute('src');
        if (!url) return;
        const ratio = img.naturalWidth > 0 && img.naturalHeight > 0
            ? ratioPlausible(img.naturalWidth / img.naturalHeight)
            : 0;
        if (!connu && emoteIndex.size >= EMOTE_INDEX_MAX) {
            // FIFO : on jette le plus ancien quart.
            let drop = Math.floor(EMOTE_INDEX_MAX / 4);
            for (const key of emoteIndex.keys()) {
                if (drop-- <= 0) break;
                emoteIndex.delete(key);
            }
        }
        emoteIndex.set(name, { url, ratio });
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

            // Un pseudo de notice attendait cette couleur : on le sert maintenant.
            const attente = pendingNoticeNames.get(login);
            if (attente) {
                for (const el of attente) {
                    if (el.isConnected) applyNoticeNameColor(el, color);
                }
                pendingNoticeNames.delete(login);
            }
        }
    };

    // =========================================================================
    // COULEUR DES PSEUDOS DE NOTICE
    // Twitch n'applique pas la couleur de chat au pseudo d'une notice : il sort dans la
    // couleur du texte, donc en gris comme le reste une fois la notice compactée. On la
    // repose depuis l'index alimenté par les messages. La personne n'a pas forcément
    // encore parlé — une série de visionnage récompense le fait de regarder, pas
    // d'écrire — alors le pseudo est mis en attente et recoloré dès qu'un de ses
    // messages passe.
    // =========================================================================
    const PENDING_NAMES_MAX = 60;
    const pendingNoticeNames = new Map();   // login -> Set(éléments)

    const applyNoticeNameColor = (el, color) => {
        el.classList.add('btc-notice-name');
        // En important : Twitch colore les enveloppes intérieures par ses propres
        // classes, qu'un style inline ordinaire ne dépasserait pas.
        el.style.setProperty('color', color, 'important');
    };

    const colorNoticeNames = (noticeLine) => {
        if (!CONFIG.compact.colorNames) return;
        // Source exacte quand elle existe : le message joint à un abonnement porte la
        // couleur en style inline. On la préfère à l'index, qui repose sur le nom
        // affiché et peut manquer quelqu'un dont le login diffère.
        const auteur = noticeLine.querySelector(`${SEL.resubCustom} ${SEL.username}`);
        const couleurJointe = auteur ? (auteur.style.color || '').trim() : '';

        for (const nom of noticeLine.querySelectorAll(`${SEL.chatterName},${SEL.massGiftName}`)) {
            // Le pseudo du message joint a déjà la sienne, posée par Twitch.
            if (nom.closest(SEL.resubCustom)) continue;
            if (nom.classList.contains('btc-notice-name')) continue;

            const login = nom.textContent.trim().toLowerCase();
            const color = couleurJointe || (login && nameColors.get(login));
            if (color) { applyNoticeNameColor(nom, color); continue; }
            if (!login) continue;

            if (pendingNoticeNames.size >= PENDING_NAMES_MAX) {
                pendingNoticeNames.delete(pendingNoticeNames.keys().next().value);
            }
            let attente = pendingNoticeNames.get(login);
            if (!attente) { attente = new Set(); pendingNoticeNames.set(login, attente); }
            attente.add(nom);
        }
    };

    /** Recolore le « @pseudo » de la citation avec la couleur de chat de la personne. */
    const colorQuotedName = (quote, line) => {
        const span = quote.querySelector(':scope > span');
        if (!span) return;

        // L'étiquetage est inconditionnel : il sert aussi au soulignement, qui n'a rien
        // à voir avec la recoloration. Les lier faisait dépendre le soulignement de la
        // cible d'une option sans rapport, et seules les mentions du texte étaient
        // soulignées.
        span.classList.add('btc-reply-target');
        if (!CONFIG.reply.colorQuotedName) return;

        // 7TV expose le login exact de la personne citée sur la ligne. On le préfère au
        // texte affiché, qui peut être un nom international ou une casse différente.
        const login = (line && line.dataset.seventvReplyParentLogin
            || span.textContent.trim().replace(/^@/, '')).toLowerCase();
        if (!login) return;
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
                    const { url, ratio } = emoteIndex.get(t);
                    const img = document.createElement('img');
                    img.src = url;
                    img.alt = t;
                    img.title = t;
                    img.loading = 'lazy';
                    img.className = 'btc-reply-emote';
                    if (ratio) {
                        // Place réservée d'avance : le chargement ne déplace plus rien.
                        img.style.aspectRatio = String(ratio);
                    } else {
                        // Proportions inconnues : on rattrapera le décalage au chargement.
                        img.addEventListener('load', () => onEmoteChargee(img, t), { once: true });
                    }
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

    /**
     * Marque les lignes où 7TV dessine déjà sa barre, pour que le style rail n'en
     * superpose pas une seconde. On ne touche à la classe que si elle change : la
     * modifier déclencherait notre propre observateur d'attributs.
     */
    const appliquerBarreNative = (line, presente) => {
        if (line.classList.contains('btc-native-accent') !== presente) {
            line.classList.toggle('btc-native-accent', presente);
        }
    };

    const HIGHLIGHT_LABEL_ATTR = 'data-seventv-custom-highlight-label';

    /**
     * Enlève l'étiquette de règle « Custom Highlights ». Retirer un attribut absent ne
     * produit aucun enregistrement de mutation : l'opération est idempotente et ne peut
     * pas relancer notre propre observateur.
     */
    const stripHighlightLabel = (el) => {
        if (!CONFIG.hideHighlightLabel) return;
        if (el.hasAttribute(HIGHLIGHT_LABEL_ATTR)) el.removeAttribute(HIGHLIGHT_LABEL_ATTR);
    };

    const applyGradeAccent = (line) => {
        let accent = null;
        // 7TV trace-t-il déjà sa propre barre à gauche de cette ligne ? Si oui, le filet
        // s'ajouterait à la sienne et la ferait paraître deux fois trop épaisse. Il faut
        // donc le mesurer, pas seulement lire la couleur déclarée : un highlight de
        // premier message, par exemple, dessine une bordure sans poser de variable.
        let barreNative = false;
        try {
            const cs = getComputedStyle(line);
            barreNative = parseFloat(cs.borderLeftWidth) > 0 && !isTransparent(cs.borderLeftColor);

            // Couleur : la variable inline de 7TV d'abord, c'est la source autoritative.
            const inline = (line.style.getPropertyValue('--seventv-chat-custom-highlight-border-color')
                || line.style.getPropertyValue('--seventv-chat-custom-highlight-color')).trim();
            if (inline) {
                line.style.setProperty('--btc-reply-accent', inline);
                appliquerBarreNative(line, barreNative);
                return;
            }

            // Repli : la couleur peut venir d'une feuille de style plutôt que d'un
            // attribut inline. Là, seul le style calculé la connaît.
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
        appliquerBarreNative(line, barreNative);
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

    /**
     * Étiquette la rangée « icône + texte » d'une notice. La profondeur du porte-icône
     * change selon le type — un abonnement l'enveloppe d'un div de plus qu'un watch
     * streak — donc on remonte depuis l'icône jusqu'au premier ancêtre qui a un second
     * enfant : c'est la rangée, et l'enfant qu'on vient de quitter est la colonne.
     */
    const layoutNoticeRow = (noticeLine) => {
        const icon = noticeLine.querySelector('.tw-svg');
        if (!icon) return;

        let colonne = icon;
        let rangee = icon.parentElement;
        while (rangee && rangee !== noticeLine && rangee.childElementCount < 2) {
            colonne = rangee;
            rangee = rangee.parentElement;
        }
        if (!rangee || rangee.childElementCount < 2) return;

        rangee.classList.add('btc-notice-row');
        colonne.classList.add('btc-notice-icon');
        for (const enfant of rangee.children) {
            if (enfant !== colonne) enfant.classList.add('btc-notice-text');
        }
    };

    // =========================================================================
    // TEINTE DES NOTICES
    // Twitch pose la couleur d'accent de la chaîne en style inline sur la barre des
    // notices d'abonnement. Celle d'une série de visionnage ne la porte pas : elle
    // retombe sur un gris de thème (--color-border-quote). On retient donc la dernière
    // couleur non neutre rencontrée pour teinter aussi celles qui n'en ont pas — sans
    // quoi la moitié des notices resteraient grises.
    // =========================================================================
    let accentChaine = '';

    // Notices teintées d'un gris faute de mieux : la couleur de la chaîne n'était pas
    // encore connue. Rien ne garantit qu'une notice d'abonnement arrive en premier —
    // une série de visionnage peut très bien ouvrir la session. On les revoit dès que
    // la couleur se présente, comme on recolore les pseudos mis en attente.
    const CARTES_NEUTRES_MAX = 40;
    const cartesNeutres = new Set();

    /** Un gris n'est pas une couleur de chaîne : ses trois composantes se valent. */
    const estNeutre = (red, green, blue) =>
        Math.max(red, green, blue) - Math.min(red, green, blue) < 12;

    const poserTeinte = (card, composantes) => {
        card.style.setProperty('--btc-notice-tint',
            `rgba(${composantes.join(', ')}, ${CONFIG.compact.tintOpacity})`);
    };

    const tintNotice = (card, bar) => {
        if (!CONFIG.compact.tintOpacity) return;
        let composantes = null;
        try {
            const m = getComputedStyle(bar).backgroundColor.match(/rgba?\(([^)]+)\)/);
            if (!m) return;
            const [red, green, blue, alpha] = m[1].split(',').map(v => parseFloat(v));
            if (![red, green, blue].every(Number.isFinite)) return;
            if (alpha === 0) return;                    // barre invisible : rien à reprendre
            composantes = [red, green, blue];
        } catch (e) { return; }

        if (!estNeutre(...composantes)) {
            const decouverte = accentChaine !== composantes.join(', ');
            accentChaine = composantes.join(', ');
            if (decouverte && cartesNeutres.size) {
                const rattrapage = accentChaine.split(',').map(v => parseFloat(v));
                for (const attente of cartesNeutres) {
                    if (attente.isConnected) poserTeinte(attente, rattrapage);
                }
                cartesNeutres.clear();
            }
        } else if (accentChaine) {
            composantes = accentChaine.split(',').map(v => parseFloat(v));
        } else {
            if (cartesNeutres.size >= CARTES_NEUTRES_MAX) {
                cartesNeutres.delete(cartesNeutres.values().next().value);
            }
            cartesNeutres.add(card);
        }
        poserTeinte(card, composantes);
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
        layoutNoticeRow(noticeLine);
        colorNoticeNames(noticeLine);
        // La barre de couleur est le frère précédent : un div vide avec un
        // background inline.
        const bar = noticeLine.previousElementSibling;
        if (bar && !bar.childElementCount && bar.getAttribute('style')) {
            bar.classList.add('btc-notice-bar');
            tintNotice(card, bar);
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
        if (element.matches?.(SEL.line)) {
            diag.lignes++; stripHighlightLabel(element); processReply(element);
        }
        for (const line of element.querySelectorAll(SEL.line)) {
            diag.lignes++; stripHighlightLabel(line); processReply(line);
        }
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

    // Indices qu'on est bien sur une page de chaîne : sans eux, l'absence de chat est
    // normale (page d'accueil, annuaire…) et il ne faut surtout pas alerter.
    const PAGE_CHAT_SELECTORS = '[data-a-target="chat-input"],.chat-room,'
        + 'section[data-test-selector="chat-room-component-layout"],[data-test-selector="chat-room"]';

    const runSelfCheck = ({ verbeux = false, force = false } = {}) => {
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

        if (cassees.length && (force || !inactif)) {
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

    // =========================================================================
    // RECOLLAGE EN BAS
    // Nos transformations agrandissent la ligne : la citation passe d'une ligne
    // tronquée à plusieurs, les espaces s'ajoutent. Elles s'appliquent dans la frame
    // qui suit l'insertion, donc APRÈS que Twitch a recollé le chat en bas — le bas du
    // nouveau message se retrouvait sous le pli. On recolle une fois la ligne à sa
    // taille définitive, et seulement si le chat y était déjà : quelqu'un qui a remonté
    // l'historique ne doit jamais être ramené en bas de force.
    // =========================================================================

    // Twitch recolle au pixel près, mais scrollHeight peut être fractionnaire. Un cran
    // de molette dépasse largement ce seuil : aucun risque de confondre les deux cas.
    const SCROLL_EPSILON = 4;
    let scroller = null;
    let colleEnBas = true;
    const scrollersEcoutes = new WeakSet();

    const mesurerCollage = (sc) =>
        !sc || sc.scrollHeight - sc.scrollTop - sc.clientHeight <= SCROLL_EPSILON;

    const recollerEnBas = (sc) => { if (sc) sc.scrollTop = sc.scrollHeight; };

    const trouverScroller = () => {
        const defile = (el) => !!el && el.scrollHeight - el.clientHeight > SCROLL_EPSILON;
        const nomme = document.querySelector(SEL.scroller);
        if (defile(nomme)) return nomme;
        // Repli structurel si Twitch déplaçait le débordement sur un autre niveau :
        // le premier ancêtre du chat qui défile réellement. Aucune classe hachée.
        let el = chatRoot && chatRoot.parentElement;
        while (el && el !== document.body) {
            const oy = getComputedStyle(el).overflowY;
            if ((oy === 'auto' || oy === 'scroll') && defile(el)) return el;
            el = el.parentElement;
        }
        // Chat pas encore assez rempli pour déborder : rien à compenser de toute façon.
        return nomme || null;
    };

    const getScroller = () => {
        if (!scroller || !scroller.isConnected) scroller = trouverScroller();
        if (scroller && !scrollersEcoutes.has(scroller)) {
            scrollersEcoutes.add(scroller);
            // Seule source fiable de l'intention de lecture : un agrandissement du
            // contenu n'émet aucun événement de défilement, une action humaine si.
            scroller.addEventListener('scroll',
                () => { colleEnBas = mesurerCollage(scroller); }, { passive: true });
        }
        return scroller;
    };

    /**
     * Une emote dont on ignorait les proportions vient de se charger : elle a pris sa
     * largeur d'un coup et a pu re-découper la citation. On retient ses proportions
     * pour les prochaines, puis on rattrape le décalage.
     */
    const onEmoteChargee = (img, nom) => {
        const connu = emoteIndex.get(nom);
        if (connu && !connu.ratio && img.naturalWidth > 0 && img.naturalHeight > 0) {
            connu.ratio = ratioPlausible(img.naturalWidth / img.naturalHeight);
        }
        if (colleEnBas) recollerEnBas(getScroller());
    };

    const flush = () => {
        const batch = queue;
        queue = [];
        frameScheduled = false;
        // Mesuré ici et non à l'insertion : à ce stade Twitch a déjà fait son propre
        // recollage, l'écart au bas reflète donc bien l'intention de qui lit.
        const sc = getScroller();
        colleEnBas = mesurerCollage(sc);
        for (const node of batch) {
            if (node.isConnected) {
                try { processLine(node); }
                catch (e) { console.error('[BTC] échec du traitement', e); }
            }
        }
        if (colleEnBas) recollerEnBas(sc);
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
                // 7TV pose ses classes de highlight après l'insertion, avec l'étiquette
                // de règle : il faut retirer celle-ci et recalculer la couleur d'accent.
                const t = m.target;
                if (t.nodeType !== Node.ELEMENT_NODE) continue;
                stripHighlightLabel(t);
                if (t.classList?.contains('btc-reply')) applyGradeAccent(t);
            }
        }
    };

    const start = (root) => {
        if (observer) observer.disconnect();
        chatRoot = root;
        scroller = null;      // la navigation SPA remplace tout l'arbre du chat
        accentChaine = '';    // et on change de chaîne, donc de couleur d'accent
        cartesNeutres.clear();
        observer = new MutationObserver(onMutations);
        observer.observe(root, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'data-seventv-processed']
        });
        // Relevé initial : sans lui, une emote chargée avant le premier lot traité
        // recollerait le chat en bas alors que rien ne dit qu'il y était.
        colleEnBas = mesurerCollage(getScroller());
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
            else if (++attempts > 60) {
                clearInterval(retryTimer);
                // Trou repéré après coup : l'auto-diagnostic n'était planifié que depuis
                // start(). Si le conteneur du chat n'est jamais trouvé, start() n'est
                // jamais appelé et la panne la plus grave restait muette — exactement ce
                // que ce contrôle est censé empêcher.
                if (document.querySelector(PAGE_CHAT_SELECTORS)) {
                    runSelfCheck({ force: true });
                }
            }
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
