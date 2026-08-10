// ==UserScript==
// @name         Remove Twitch "Replying to" Text (No Delay) - 2 Lines Max + Compact Subs
// @namespace    http://tampermonkey.net/
// @version      14.2
// @description  Supprime "Replying to" instantanément, limite l'affichage des réponses à 2 lignes avec ellipsis, et compacte l'affichage des subs/gifts comme FrankerFaceZ
// @author       Assistant
// @match        https://www.twitch.tv/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=twitch.tv
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    // ============================================
    // CONSTANTES ET REGEX PRÉ-COMPILÉES
    // ============================================
    const REPLY_REGEX = /^Replying to\s*/i;
    const REPLY_TEXT_EXACT = ['Replying to', 'Replying to '];
    const SPACE_BEFORE_DOT = /\s+\./g;
    const SPACE_BEFORE_COMMA = /\s+,/g;
    const WATCH_STREAK_FULL = /is currently on a\s+(\d+)-?stream streak\s*!?\s*in\s+\S+'s channel!?/gi;
    const WATCH_STREAK_SIMPLE = /is currently on a\s+(\d+)-?stream streak\s*!?/gi;
    const WATCH_STREAK_HEADER = /Watch Streak Reached!?:?\s*/gi;
    const CHANNEL_SUFFIX = /\s*!?in\s+\S+'s channel!?/gi;
    const REDEEMED_REGEX = /\bredeemed\b/gi;
    const RAID_REGEX = /raided with a viewer count of\s*(\d+)\s*\.?/gi;

    // Sélecteurs UNIQUEMENT pour le conteneur de chat (pas de fallback générique)
    const CHAT_CONTAINER_SELECTORS = [
        '.seventv-chat-list',
        '.chat-scrollable-area__message-container',
        '.chat-room__content .chat-list',
        '.stream-chat .chat-list'
    ];

    // Sélecteurs pour vérifier si un élément est dans le chat
    const CHAT_PARENT_SELECTORS = '.seventv-chat-list, .chat-scrollable-area__message-container, .chat-room, .stream-chat';

    // WeakSets pour tracker les éléments traités
    const processedElements = new WeakSet();
    const processedHighlights = new WeakSet();
    const processedSubMessages = new WeakSet();
    const processedReplyEmotes = new WeakSet();

    // État global
    let chatContainer = null;
    let chatObserver = null;
    let isObserving = false;
    let emoteCollectorScheduler = null;
    let giftCleanupScheduler = null;

    // ============================================
    // FONCTION CLÉ : VÉRIFIER SI DANS LE CHAT
    // ============================================
    const isInChat = (element) => {
        if (!element || !element.closest) return false;
        // Vérifie si l'élément est dans le conteneur de chat connu
        if (chatContainer && chatContainer.contains(element)) return true;
        // Fallback : vérifie via les sélecteurs
        return !!element.closest(CHAT_PARENT_SELECTORS);
    };

    // ============================================
    // UTILITAIRES IDLE CALLBACK
    // ============================================
    const scheduleIdleTask = (callback, timeout = 5000) => {
        if ('requestIdleCallback' in window) {
            return requestIdleCallback(callback, { timeout });
        }
        return setTimeout(callback, 100);
    };

    const cancelIdleTask = (id) => {
        if ('requestIdleCallback' in window) {
            cancelIdleCallback(id);
        } else {
            clearTimeout(id);
        }
    };

    const createIdleScheduler = (task, intervalMs) => {
        let timeoutId = null;
        let lastRun = 0;
        
        const run = () => {
            const now = Date.now();
            if (now - lastRun >= intervalMs) {
                task();
                lastRun = now;
            }
            timeoutId = scheduleIdleTask(run, intervalMs);
        };
        
        return {
            start() { timeoutId = scheduleIdleTask(run, intervalMs); },
            stop() { if (timeoutId) cancelIdleTask(timeoutId); timeoutId = null; }
        };
    };

    // Cache des emotes
    const EMOTE_CACHE_MAX_SIZE = 150;
    const emoteCache = new Map();

    // ============================================
    // TRADUCTIONS
    // ============================================
    const translations = {
        'It\'s their first Gift Sub in the channel!': 'C\'est son premier cadeau d\'abonnement sur cette chaîne !',
        'raided with a viewer count of': 'a lancé un raid avec',
        'They\'ve gifted a total of': 'Cette personne a offert',
        'Watch Streak Reached!': 'Série de visionnage atteinte !',
        'Subs in the channel!': 'abonnements sur cette chaîne !',
        'They\'ve subscribed for': 'Abonné depuis',
        'Highlight My Message': 'Mettre mon message en avant',
        'is currently on a': 'est actuellement sur une série de',
        'Subscribed with': ' s\'est abonné avec',
        'stream streak': 'streams consécutifs',
        '-stream streak': ' streams',
        'Tier 1 Subs': 'abonnements de niveau 1',
        'Tier 2 Subs': 'abonnements de niveau 2',
        'Tier 3 Subs': 'abonnements de niveau 3',
        'with Prime .': 'avec Prime.',
        'Tier 1 Sub': 'de niveau 1',
        'Tier 2 Sub': 'de niveau 2',
        'Tier 3 Sub': 'de niveau 3',
        'Subscribed': ' s\'est abonné',
        'with Prime': 'avec Prime',
        'is gifting': 'offre',
        'Gifted a': 'a offert un abonnement',
        'with Tier': 'avec le niveau',
        'Tier 1 .': 'niveau 1.',
        'Tier 2 .': 'niveau 2.',
        'Tier 3 .': 'niveau 3.',
        'Tier 1': 'de niveau 1',
        'Tier 2': 'de niveau 2',
        'Tier 3': 'de niveau 3',
        'months .': 'mois.',
        'months!': 'mois !',
        'in a row': 'consécutifs',
        'month .': 'mois.',
        'redeemed': 'a utilisé',
        'month!': 'mois !',
        'months': 'mois',
        'Sub to': 'à',
        'month': 'mois',
        'to the community': 'à la communauté',
    };

    const translationKeys = Object.keys(translations).sort((a, b) => b.length - a.length);

    // ============================================
    // GESTION DES MASS GIFT SUBS
    // ============================================
    const giftTracker = {
        pending: new Map(),
        earlyGifts: new Map(),
        COLLECT_DELAY: 3000,
        MAX_AGE: 30000,
        
        cleanup(donorKey) {
            const data = this.pending.get(donorKey);
            if (data?.timeout) clearTimeout(data.timeout);
            this.pending.delete(donorKey);
        },
        
        addEarlyGift(donor, element, recipient) {
            if (!this.earlyGifts.has(donor)) {
                this.earlyGifts.set(donor, []);
            }
            this.earlyGifts.get(donor).push({ element, recipient, timestamp: Date.now() });
        },
        
        processEarlyGifts(donor, data) {
            const early = this.earlyGifts.get(donor);
            if (!early) return;
            
            for (const gift of early) {
                if (data.recipients.length < data.count) {
                    data.recipients.push(gift.recipient);
                    gift.element.classList.add('compact-gift-hidden');
                }
            }
            this.earlyGifts.delete(donor);
        },
        
        cleanupOld() {
            const now = Date.now();
            for (const [key, data] of this.pending.entries()) {
                if (now - data.timestamp > this.MAX_AGE) {
                    this.cleanup(key);
                }
            }
            for (const [donor, gifts] of this.earlyGifts.entries()) {
                const filtered = gifts.filter(g => now - g.timestamp < this.MAX_AGE);
                if (filtered.length === 0) {
                    this.earlyGifts.delete(donor);
                } else {
                    this.earlyGifts.set(donor, filtered);
                }
            }
        }
    };

    // ============================================
    // INJECTION CSS
    // ============================================
    const injectCSS = () => {
        if (document.getElementById('reply-fix-styles')) return;

        const style = document.createElement('style');
        style.id = 'reply-fix-styles';
        style.textContent = `
            /* BORDURES SUR CHAQUE MESSAGE */
            .seventv-chat-message-background {
                border-bottom: 1px solid hsla(0, 0%, 100%, 0.1) !important;
                padding-bottom: 0.4rem !important;
                margin-bottom: 0.1rem !important;
            }

            .chat-line__message:not(.chat-line--inline),
            .chat-line_moderation, .chat-line_status, .chat-line_raid, .user-notice-line {
                border-bottom: 1px solid hsla(0, 0%, 100%, 0.1) !important;
                padding-bottom: 0.4rem !important;
            }

            /* SCROLLBAR 7TV - CACHÉ */
            .seventv-chat-list .scrollbar,
            .seventv-chat-list .scrollbar-thumb,
            .seventv-chat-list div[class*="scrollbar"] {
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
                width: 0 !important;
                pointer-events: none !important;
            }

            /* ALIGNEMENT BADGES ET EMOTES AVEC LE TEXTE */
            .chat-badge, .seventv-chat-badge img, .chat-badge img, [class*="badge"] img,
            .seventv-emote, .seventv-chat-emote, .seventv-emote-box img,
            img[data-seventv-emote-id], .chat-image__container img,
            img.chat-line__message--emote, .emote,
            .seventv-painted-content img, .seventv-message img:not(.compact-mass-gift-icon img) {
                vertical-align: -0.2em !important;
            }

            /* EMOTES 7TV DANS LES MESSAGES */
            .seventv-emote-box.emote-token {
                vertical-align: text-bottom !important;
            }

            /* ICÔNE CŒUR MASS GIFT */
            .compact-mass-gift-icon,
            .compact-mass-gift-icon svg {
                vertical-align: middle !important;
            }

            /* CACHE "REPLYING TO" */
            span.seventv-reply-prefix,
            span[class*="reply-prefix"],
            .seventv-reply-part span.reply-to-text {
                display: none !important;
            }

            /* EMOTES & MENTIONS DANS LES RÉPONSES */
            .reply-emote {
                height: 1.5em !important;
                width: auto !important;
                vertical-align: middle !important;
                margin: 0 2px !important;
                display: inline !important;
            }
            .reply-mention {
                text-decoration: underline !important;
            }

            /* FOND GRIS POUR RÉPONSES (classe ajoutée par JS) */
            .seventv-message.is-reply-message:not(:has(.seventv-user-message.has-highlight)) {
                background: hsla(0, 0%, 60%, .24) !important;
            }

            /* RÉPONSES - WHITE-SPACE */
            .seventv-message.is-reply-message,
            .chat-line__message--reply {
                white-space: normal !important;
            }

            /* Masquer les gifts cachés */
            .seventv-message.compact-gift-hidden {
                display: none !important;
            }

            /* USERNAMES */
            .chat-line__username,
            .chat-author__display-name {
                display: inline-block !important;
                -webkit-line-clamp: unset !important;
                overflow: visible !important;
                white-space: nowrap !important;
            }

            /* COMPACT SUB/RESUB MESSAGES */
            .seventv-sub-message-container {
                padding: 0.3rem 0.8rem !important;
                margin: 0.15rem 0 !important;
            }
            .seventv-sub-message-container .sub-part {
                display: flex !important;
                align-items: center !important;
                flex-wrap: wrap !important;
            }
            .seventv-sub-message-container .sub-name,
            .seventv-sub-message-container .sub-name-big {
                display: inline !important;
                font-size: inherit !important;
                font-weight: 700 !important;
            }
            .seventv-sub-message-container .sub-message-icon,
            .seventv-sub-message-container .gift-icon {
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                padding-right: 0.4rem !important;
                flex-shrink: 0 !important;
            }
            .seventv-sub-message-container .sub-message-icon svg,
            .seventv-sub-message-container .gift-icon svg {
                width: 18px !important;
                height: 18px !important;
            }
            .seventv-sub-message-container .sub-message-text {
                margin-left: 0 !important;
                flex: 1 !important;
            }
            .seventv-sub-message-container .message-part {
                width: 100% !important;
                margin-top: 0.2rem !important;
                padding-top: 0 !important;
            }

            /* COMPACT MASS GIFT */
            .compact-mass-gift-container {
                display: block;
                padding: 0.3rem 0.8rem;
                margin: 0.1rem 0;
                background-color: hsla(0deg, 0%, 50%, 10%);
                border: 0.3rem solid var(--seventv-channel-accent, #9147ff);
                overflow-wrap: anywhere;
                line-height: 1.4;
            }
            .seventv-sub-message-container:has(.compact-mass-gift-container),
            .seventv-sub-message-container.compact-mass-gift,
            .seventv-sub-message-container.compact-mass-gift.seventv-highlight {
                border: none !important;
                padding: 0 !important;
                margin: 0 !important;
                background: transparent !important;
            }
            .compact-mass-gift-header {
                display: flex;
                align-items: center;
                gap: 0.4rem;
            }
            .compact-mass-gift-icon {
                flex-shrink: 0;
                display: flex;
                align-items: center;
                color: #bf94ff;
            }
            .compact-mass-gift-icon svg {
                width: 18px;
                height: 18px;
            }
            .compact-mass-gift-text {
                flex: 1;
            }
            .compact-mass-gift-donor,
            .compact-mass-gift-recipient {
                color: #bf94ff;
                font-weight: 700;
            }
            .compact-mass-gift-recipients {
                margin-top: 0.8rem;
                margin-left: 22px;
                color: hsla(0, 0%, 100%, 0.9);
                font-size: 0.9em;
                line-height: 1.3;
            }
            .compact-mass-gift-recipient:not(:last-child)::after {
                content: ", ";
                font-weight: 400;
            }

            /* BORDERS COMBINÉS */
            .seventv-chat-message-background.highlight-border,
            .seventv-message.highlight-border,
            .highlight-border,
            .seventv-sub-message-container.seventv-highlight,
            .watch-streak-border,
            .raid-border {
                border: 0.3rem solid var(--seventv-channel-accent, #9147ff) !important;
            }
            .seventv-sub-message-container.seventv-highlight {
                padding: 0.3rem 0.8rem !important;
            }

            /* SUPPRESSION BORDERS INTERNES */
            .watch-streak-border .seventv-sub-message-container,
            .watch-streak-border.seventv-sub-message-container,
            .watch-streak-border .seventv-highlight,
            .watch-streak-border.seventv-highlight,
            .watch-streak-border > *,
            .watch-streak-border .sub-part,
            .raid-border .seventv-sub-message-container,
            .raid-border.seventv-sub-message-container,
            .raid-border > * {
                border: none !important;
            }

            /* PROPAGER LE FOND HIGHLIGHT */
            .seventv-message:has(.seventv-user-message.has-highlight) .seventv-sub-message-container.seventv-highlight,
            .seventv-message:has(.seventv-user-message.has-highlight) .compact-mass-gift-container {
                background-color: var(--seventv-highlight-dim-color) !important;
            }

            .seventv-message:has(.seventv-sub-message-container.seventv-highlight) .seventv-user-message.has-highlight,
            .seventv-message:has(.compact-mass-gift-container) .seventv-user-message.has-highlight {
                border: none !important;
            }
        `;

        (document.head || document.documentElement).appendChild(style);
    };

    injectCSS();

    // ============================================
    // FONCTIONS UTILITAIRES
    // ============================================
    
    const getTextNodes = (element) => {
        const nodes = [];
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
        let node;
        while (node = walker.nextNode()) nodes.push(node);
        return nodes;
    };

    const cleanSpaces = (text) => text.replace(SPACE_BEFORE_DOT, '.').replace(SPACE_BEFORE_COMMA, ',');

    const translateText = (text) => {
        if (!text) return text;
        let result = text;
        for (const key of translationKeys) {
            if (result.includes(key)) {
                result = result.replaceAll(key, translations[key]);
            }
        }
        return cleanSpaces(result);
    };

    // ============================================
    // GESTION DES EMOTES DANS LES RÉPONSES
    // ============================================

    const addToEmoteCache = (name, data) => {
        if (!name || !data.src || emoteCache.has(name)) return;
        
        if (emoteCache.size >= EMOTE_CACHE_MAX_SIZE) {
            let count = 0;
            for (const key of emoteCache.keys()) {
                if (count++ >= 30) break;
                emoteCache.delete(key);
            }
        }
        
        emoteCache.set(name, data);
    };

    const collectEmotesFromChat = () => {
        if (emoteCache.size >= EMOTE_CACHE_MAX_SIZE - 20) return;
        if (!chatContainer) return;
        
        // Limiter la recherche au conteneur de chat
        const seventvSelectors = '.seventv-emote, img[data-seventv-emote-id], .seventv-chat-emote';
        
        for (const emote of chatContainer.querySelectorAll(seventvSelectors)) {
            const name = emote.alt || emote.getAttribute('data-seventv-emote-name') || emote.title;
            const src = emote.src || emote.getAttribute('srcset')?.split(' ')[0];
            if (name && src) addToEmoteCache(name, { src, type: '7tv' });
        }

        const twitchSelectors = '.chat-image__container img, img.chat-line__message--emote';
        
        for (const emote of chatContainer.querySelectorAll(twitchSelectors)) {
            const name = emote.alt;
            const src = emote.src;
            if (name && src) addToEmoteCache(name, { src, type: 'twitch' });
        }
    };

    const renderEmotesInReply = (replyElement) => {
        if (!replyElement || processedReplyEmotes.has(replyElement)) return;
        
        processedReplyEmotes.add(replyElement);

        const replyText = replyElement.querySelector('.seventv-reply-message-part, .reply-message-text, .seventv-reply-text, [class*="reply-message"]');
        const targetElement = replyText || replyElement;
        if (!targetElement) return;

        const textNodes = getTextNodes(targetElement);
        
        for (const textNode of textNodes) {
            const text = textNode.textContent;
            if (!text || text.trim().length === 0) continue;

            const parts = text.split(/(\s+)/);
            let hasEmoteOrMention = false;
            
            for (const part of parts) {
                const trimmed = part.trim();
                if (trimmed && (emoteCache.has(trimmed) || trimmed.startsWith('@'))) {
                    hasEmoteOrMention = true;
                    break;
                }
            }
            
            if (!hasEmoteOrMention) continue;

            const fragment = document.createDocumentFragment();
            
            for (const part of parts) {
                const trimmed = part.trim();
                
                if (!trimmed) {
                    fragment.appendChild(document.createTextNode(part));
                    continue;
                }
                
                if (emoteCache.has(trimmed)) {
                    const emoteData = emoteCache.get(trimmed);
                    const img = document.createElement('img');
                    img.src = emoteData.src;
                    img.alt = trimmed;
                    img.title = trimmed;
                    img.className = 'reply-emote';
                    img.style.cssText = 'height: 1.5em; width: auto; vertical-align: middle; margin: 0 2px; display: inline;';
                    fragment.appendChild(img);
                } else if (trimmed.startsWith('@')) {
                    const span = document.createElement('span');
                    span.className = 'reply-mention';
                    span.textContent = trimmed;
                    fragment.appendChild(span);
                } else {
                    fragment.appendChild(document.createTextNode(part));
                }
            }
            
            if (textNode.parentNode) {
                textNode.parentNode.replaceChild(fragment, textNode);
            }
        }
    };

    const processReplyEmotes = (container) => {
        const replies = container.querySelectorAll('.is-reply-message, .seventv-reply-part, .reply-part');
        for (const reply of replies) {
            renderEmotesInReply(reply);
        }
    };

    // ============================================
    // FONCTIONS PRINCIPALES
    // ============================================

    const propagateHighlight = (userMessage, retryCount = 0) => {
        if (!userMessage || processedHighlights.has(userMessage)) return;
        if (!userMessage.classList.contains('has-highlight')) return;

        const background = userMessage.closest('.seventv-chat-message-background');
        if (!background || background.classList.contains('has-highlight-propagated')) return;

        const style = userMessage.style;
        const highlightColor = style.getPropertyValue('--seventv-highlight-color');
        const highlightDimColor = style.getPropertyValue('--seventv-highlight-dim-color');

        if ((!highlightColor || !highlightDimColor) && retryCount < 5) {
            setTimeout(() => propagateHighlight(userMessage, retryCount + 1), 50);
            return;
        }

        if (highlightColor) background.style.setProperty('--seventv-highlight-color', highlightColor);
        if (highlightDimColor) background.style.setProperty('--seventv-highlight-dim-color', highlightDimColor);

        const labelEl = userMessage.querySelector('.seventv-chat-message-highlight-label');
        const label = labelEl?.getAttribute('data-highlight-label');
        if (label) background.setAttribute('data-highlight-label', label);

        background.classList.add('has-highlight-propagated');
        processedHighlights.add(userMessage);
    };

    const processTextElement = (element) => {
        if (!element || processedElements.has(element)) return;

        const text = element.textContent;
        if (!text?.startsWith('Replying')) return;

        if (REPLY_TEXT_EXACT.includes(text)) {
            element.style.display = 'none';
            processedElements.add(element);
            return;
        }

        if (REPLY_REGEX.test(text)) {
            const newText = text.replace(REPLY_REGEX, '');
            if (newText.trim() === '') {
                element.style.display = 'none';
            } else if (element.childNodes.length === 1 && element.firstChild?.nodeType === Node.TEXT_NODE) {
                element.firstChild.textContent = newText;
            } else {
                element.textContent = newText;
            }
            processedElements.add(element);
        }
    };

    // ============================================
    // TRAITEMENT DES MESSAGES
    // ============================================

    const translateSubMessage = (container) => {
        const textEl = container.querySelector('.sub-message-text');
        if (!textEl) return;

        for (const node of getTextNodes(textEl)) {
            const translated = translateText(node.textContent);
            if (translated !== node.textContent) {
                node.textContent = translated;
            }
        }
        
        cleanupSpacesBeforePunctuation(textEl);
    };

    const cleanupSpacesBeforePunctuation = (element) => {
        if (!element) return;
        
        SPACE_BEFORE_DOT.lastIndex = 0;
        SPACE_BEFORE_COMMA.lastIndex = 0;
        
        const textNodes = getTextNodes(element);
        const len = textNodes.length;
        
        for (let i = 0; i < len; i++) {
            const node = textNodes[i];
            const text = node.textContent;
            
            if (i > 0 && /^[.,:]/.test(text.trim())) {
                const prev = textNodes[i - 1];
                if (prev) prev.textContent = prev.textContent.replace(/\s+$/, '');
            }
            
            SPACE_BEFORE_DOT.lastIndex = 0;
            SPACE_BEFORE_COMMA.lastIndex = 0;
            if (SPACE_BEFORE_DOT.test(text) || SPACE_BEFORE_COMMA.test(text)) {
                SPACE_BEFORE_DOT.lastIndex = 0;
                SPACE_BEFORE_COMMA.lastIndex = 0;
                node.textContent = cleanSpaces(text);
            }
        }
        
        const spans = element.querySelectorAll('span');
        const spansLen = spans.length;
        if (spansLen > 50) return;
        
        for (let i = 0; i < spansLen; i++) {
            const span = spans[i];
            const spanText = span.textContent;
            if (spanText === '.' || spanText === ',' || spanText === ' .' || spanText === ' ,') {
                let prev = span.previousSibling;
                while (prev) {
                    if (prev.nodeType === Node.TEXT_NODE) {
                        prev.textContent = prev.textContent.replace(/\s+$/, '');
                        break;
                    } else if (prev.nodeType === Node.ELEMENT_NODE) {
                        const nodes = getTextNodes(prev);
                        if (nodes.length) {
                            nodes[nodes.length - 1].textContent = nodes[nodes.length - 1].textContent.replace(/\s+$/, '');
                        }
                        break;
                    }
                    prev = prev.previousSibling;
                }
            }
        }
    };

    // ============================================
    // WATCH STREAK
    // ============================================

    const reformatWatchStreak = (msgElement) => {
        const fullText = msgElement.textContent || '';
        const match = fullText.match(/(\w+)\s+is currently on a\s+(\d+)-?stream streak/i);
        if (!match) return false;

        WATCH_STREAK_HEADER.lastIndex = 0;
        WATCH_STREAK_FULL.lastIndex = 0;
        WATCH_STREAK_SIMPLE.lastIndex = 0;
        CHANNEL_SUFFIX.lastIndex = 0;
        REDEEMED_REGEX.lastIndex = 0;

        for (const node of getTextNodes(msgElement)) {
            let text = node.textContent;
            
            if (text.includes('Watch Streak Reached')) {
                WATCH_STREAK_HEADER.lastIndex = 0;
                text = text.replace(WATCH_STREAK_HEADER, '');
            }
            
            if (text.includes('is currently on a') && text.includes('stream streak')) {
                WATCH_STREAK_FULL.lastIndex = 0;
                WATCH_STREAK_SIMPLE.lastIndex = 0;
                text = text.replace(WATCH_STREAK_FULL, 'est sur une série de $1 streams !');
                text = text.replace(WATCH_STREAK_SIMPLE, 'est sur une série de $1 streams !');
            }
            
            if (text.includes("'s channel")) {
                CHANNEL_SUFFIX.lastIndex = 0;
                text = text.replace(CHANNEL_SUFFIX, '');
            }
            
            if (text.includes('redeemed')) {
                REDEEMED_REGEX.lastIndex = 0;
                text = text.replace(REDEEMED_REGEX, 'a utilisé');
            }
            
            if (text !== node.textContent) {
                node.textContent = text;
            }
        }
        
        return true;
    };

    // ============================================
    // RAID
    // ============================================

    const reformatRaid = (msgElement) => {
        RAID_REGEX.lastIndex = 0;
        
        for (const node of getTextNodes(msgElement)) {
            let text = node.textContent;
            
            if (text.includes('raided with a viewer count of')) {
                RAID_REGEX.lastIndex = 0;
                text = text.replace(RAID_REGEX, 'a lancé un raid avec $1 viewers !');
            }
            
            if (text !== node.textContent) {
                node.textContent = text;
            }
        }
        
        return true;
    };

    // ============================================
    // MASS GIFT
    // ============================================

    const extractFromSubContainer = (element, type) => {
        const textEl = element.querySelector('.sub-message-text');
        if (!textEl) return type === 'donor' ? element.querySelector('.sub-name-big, .sub-name.bold, .sub-name')?.textContent.trim() : null;
        
        const text = textEl.textContent;
        
        switch(type) {
            case 'donor':
                return element.querySelector('.sub-name-big, .sub-name.bold, .sub-name')?.textContent.trim();
            case 'recipient':
                const match = text.match(/(?:Sub to|abonnement[^à]*à)\s+([^\s.!,]+)/i);
                return match?.[1];
            case 'tier':
                return text.match(/(?:Tier|niveau)\s+(\d)/i)?.[1] || '1';
            case 'giftCount':
                return parseInt(text.match(/(?:gifting|offre)\s+(\d+)/i)?.[1], 10) || 0;
            case 'totalGifts':
                return parseInt(text.match(/(?:total of|a offert)\s+(\d+)/i)?.[1], 10) || 0;
            case 'isFirst':
                return text.includes("first Gift Sub") || text.includes("premier cadeau");
            case 'isMassGift':
                return (text.includes('is gifting') || text.includes('offre')) && (text.includes('Subs') || text.includes('abonnement'));
            case 'isIndividualGift':
                const isGift = text.includes('Gifted a') || text.toLowerCase().includes('a offert un abonnement');
                const hasRecipient = text.includes('Sub to') || text.includes(' à ');
                return isGift && hasRecipient;
        }
        return null;
    };

    const GIFT_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5 6.5A2.5 2.5 0 017.5 4c.97 0 1.654.56 2.155 1.094.254.271.464.55.635.801.17-.25.38-.53.635-.801C11.425 4.56 12.103 4 13.072 4A2.5 2.5 0 0116 6.5c0 .727-.31 1.38-.804 1.84L10.285 15l-4.91-6.66A2.492 2.492 0 015 6.5z" clip-rule="evenodd"></path></svg>';

    const createCompactMassGiftElement = (donor, tier, recipients, totalGifts, isFirst) => {
        const container = document.createElement('div');
        container.className = 'compact-mass-gift-container';
        
        const totalText = isFirst 
            ? "C'est son premier cadeau d'abonnement sur cette chaîne !"
            : `Cette personne a offert ${totalGifts} abonnements sur cette chaîne !`;
        
        const recipientsList = recipients.map(r => `<span class="compact-mass-gift-recipient">${r}</span>`).join('');
        
        container.innerHTML = `<div class="compact-mass-gift-header"><div class="compact-mass-gift-icon">${GIFT_ICON_SVG}</div><div class="compact-mass-gift-text"><span class="compact-mass-gift-donor">${donor}</span> offre ${recipients.length} abonnement${recipients.length > 1 ? 's' : ''} de niveau ${tier} à la communauté ! ${totalText}</div></div><div class="compact-mass-gift-recipients">${recipientsList}</div>`;
        
        return container;
    };

    const processSubMessage = (msgElement) => {
        if (!msgElement || processedSubMessages.has(msgElement)) return;
        
        const subContainer = msgElement.querySelector('.seventv-sub-message-container');
        const fullText = msgElement.textContent || '';
        
        if (fullText.includes('Watch Streak') || fullText.includes('stream streak') || fullText.includes('est sur une série de')) {
            reformatWatchStreak(msgElement);
            addBorderClass(msgElement, 'watch-streak-border');
            processedSubMessages.add(msgElement);
            return;
        }
        
        if (fullText.includes('raided with a viewer count of') || fullText.includes('a lancé un raid avec')) {
            reformatRaid(msgElement);
            addBorderClass(msgElement, 'raid-border');
            processedSubMessages.add(msgElement);
            return;
        }
        
        if (!subContainer) return;

        translateSubMessage(subContainer);
        cleanupSpacesBeforePunctuation(subContainer);
        
        if (extractFromSubContainer(subContainer, 'isMassGift')) {
            const donor = extractFromSubContainer(subContainer, 'donor');
            const tier = extractFromSubContainer(subContainer, 'tier');
            const giftCount = extractFromSubContainer(subContainer, 'giftCount');
            const totalGifts = extractFromSubContainer(subContainer, 'totalGifts');
            const isFirst = extractFromSubContainer(subContainer, 'isFirst');
            
            if (donor && giftCount > 0) {
                const donorKey = `${donor}-${Date.now()}`;
                
                const data = {
                    count: giftCount, tier, recipients: [],
                    totalGifts: totalGifts || giftCount, isFirst,
                    element: msgElement, timeout: null,
                    timestamp: Date.now()
                };
                
                giftTracker.pending.set(donorKey, data);
                msgElement.dataset.giftDonorKey = donorKey;
                
                giftTracker.processEarlyGifts(donor, data);
                
                data.timeout = setTimeout(() => {
                    finalizeMassGift(donorKey);
                }, giftTracker.COLLECT_DELAY);
            }
            processedSubMessages.add(msgElement);
            return;
        }
        
        if (extractFromSubContainer(subContainer, 'isIndividualGift')) {
            const donor = extractFromSubContainer(subContainer, 'donor');
            const recipient = extractFromSubContainer(subContainer, 'recipient');
            
            if (donor && recipient) {
                let found = false;
                
                for (const [key, data] of giftTracker.pending.entries()) {
                    if (key.startsWith(donor + '-') && data.recipients.length < data.count) {
                        data.recipients.push(recipient);
                        msgElement.classList.add('compact-gift-hidden');
                        found = true;
                        
                        if (data.recipients.length >= data.count) {
                            clearTimeout(data.timeout);
                            finalizeMassGift(key);
                        }
                        break;
                    }
                }
                
                if (!found) {
                    giftTracker.addEarlyGift(donor, msgElement, recipient);
                    msgElement.classList.add('compact-gift-hidden');
                }
            }
            processedSubMessages.add(msgElement);
            return;
        }
        
        processedSubMessages.add(msgElement);
        propagateHighlightBackground(msgElement);
        setTimeout(() => cleanupSpacesBeforePunctuation(subContainer), 50);
    };

    const propagateHighlightBackground = (msgElement) => {
        const highlightEl = msgElement.querySelector('.seventv-user-message.has-highlight');
        if (!highlightEl) return;
        
        const subContainer = msgElement.querySelector('.seventv-sub-message-container.seventv-highlight');
        const massGiftContainer = msgElement.querySelector('.compact-mass-gift-container');
        
        const computedStyle = window.getComputedStyle(highlightEl);
        const bgColor = computedStyle.backgroundColor;
        
        if (bgColor && bgColor !== 'transparent' && bgColor !== 'rgba(0, 0, 0, 0)') {
            if (subContainer) {
                subContainer.style.backgroundColor = bgColor;
            }
            if (massGiftContainer) {
                massGiftContainer.style.backgroundColor = bgColor;
            }
            highlightEl.style.border = 'none';
        }
    };

    const finalizeMassGift = (donorKey) => {
        const data = giftTracker.pending.get(donorKey);
        if (!data?.element) {
            giftTracker.cleanup(donorKey);
            return;
        }
        
        const { element, tier, recipients, totalGifts, isFirst } = data;
        const donor = donorKey.split('-')[0];
        
        const subContainer = element.querySelector('.seventv-sub-message-container');
        if (subContainer && recipients.length > 0) {
            subContainer.innerHTML = '';
            subContainer.appendChild(createCompactMassGiftElement(donor, tier, recipients, totalGifts, isFirst));
            subContainer.classList.add('compact-mass-gift');
            subContainer.classList.remove('seventv-highlight');
            Object.assign(subContainer.style, { border: 'none', padding: '0', background: 'transparent' });
            
            setTimeout(() => propagateHighlightBackground(element), 10);
        }
        
        giftTracker.cleanup(donorKey);
    };

    // ============================================
    // AJOUT DE BORDURES
    // ============================================

    const addBorderClass = (msgElement, className) => {
        msgElement.classList.add(className);
        const bg = msgElement.querySelector('.seventv-chat-message-background');
        if (bg) bg.classList.add(className);
        const sub = msgElement.querySelector('.seventv-sub-message-container');
        if (sub) sub.classList.add(className);
    };

    // ============================================
    // PROCESSEUR PRINCIPAL
    // ============================================

    const processElement = (element) => {
        if (!element || element.nodeType !== Node.ELEMENT_NODE || processedElements.has(element)) return;

        const classList = element.classList;
        if (!classList) return;

        if (classList.contains('seventv-user-message') && classList.contains('has-highlight')) {
            propagateHighlight(element);
        }

        const tagName = element.tagName;
        if (tagName === 'SPAN' || tagName === 'DIV') {
            processTextElement(element);
        }

        if (classList.contains('seventv-message')) {
            processSeventvMessage(element);
        }

        const highlights = element.getElementsByClassName('seventv-user-message');
        for (let i = 0; i < highlights.length; i++) {
            if (highlights[i].classList.contains('has-highlight')) {
                propagateHighlight(highlights[i]);
            }
        }

        const messages = element.getElementsByClassName('seventv-message');
        for (let i = 0; i < messages.length; i++) {
            processSeventvMessage(messages[i]);
        }

        processReplyEmotes(element);

        processedElements.add(element);
    };

    const processSeventvMessage = (msg) => {
        if (processedSubMessages.has(msg)) return;
        
        const text = msg.textContent || '';
        
        // Détecter les réponses (commence par @username: ou @username )
        if (/^@[^\s:]+[:\s]/.test(text)) {
            msg.classList.add('is-reply-message');
        }
        
        if (text.includes('Watch Streak') || text.includes('stream streak') || text.includes('est sur une série de')) {
            reformatWatchStreak(msg);
            addBorderClass(msg, 'watch-streak-border');
            propagateHighlightBackground(msg);
            processedSubMessages.add(msg);
            return;
        }
        
        if (text.includes('raided with') || text.includes('a lancé un raid')) {
            reformatRaid(msg);
            addBorderClass(msg, 'raid-border');
            propagateHighlightBackground(msg);
            processedSubMessages.add(msg);
            return;
        }
        
        if (text.includes('redeemed') || text.includes('a utilisé') || text.includes('Mettre mon message en avant')) {
            REDEEMED_REGEX.lastIndex = 0;
            for (const node of getTextNodes(msg)) {
                if (node.textContent.includes('redeemed')) {
                    node.textContent = node.textContent.replace(REDEEMED_REGEX, 'a utilisé');
                }
            }
            addBorderClass(msg, 'highlight-border');
            propagateHighlightBackground(msg);
        }
        
        processSubMessage(msg);
    };

    // ============================================
    // INTERCEPTION DOM - LIMITÉE AU CHAT
    // ============================================
    
    const translateTextOnTheFly = (value) => {
        if (typeof value !== 'string') return value;
        
        WATCH_STREAK_HEADER.lastIndex = 0;
        WATCH_STREAK_FULL.lastIndex = 0;
        WATCH_STREAK_SIMPLE.lastIndex = 0;
        REDEEMED_REGEX.lastIndex = 0;
        RAID_REGEX.lastIndex = 0;
        
        if (value.includes('Watch Streak Reached')) {
            value = value.replace(WATCH_STREAK_HEADER, '');
        }
        if (value.includes('is currently on a') && value.includes('stream streak')) {
            value = value.replace(WATCH_STREAK_FULL, 'est sur une série de $1 streams !');
            value = value.replace(WATCH_STREAK_SIMPLE, 'est sur une série de $1 streams !');
        }
        if (value.includes('redeemed')) {
            value = value.replace(REDEEMED_REGEX, 'a utilisé');
        }
        if (value.includes('raided with a viewer count of')) {
            value = value.replace(RAID_REGEX, 'a lancé un raid avec $1 viewers !');
        }
        
        return cleanSpaces(value);
    };

    const setupInterceptors = () => {
        const originalAppendChild = Node.prototype.appendChild;
        const originalInsertBefore = Node.prototype.insertBefore;
        const textContentDesc = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
        const innerTextDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText');

        // appendChild - UNIQUEMENT pour les éléments dans le chat
        Node.prototype.appendChild = function(child) {
            const result = originalAppendChild.call(this, child);
            // Vérifier si l'élément ajouté est dans le chat
            if (child?.nodeType === Node.ELEMENT_NODE && isInChat(child)) {
                processElement(child);
            }
            return result;
        };

        // insertBefore - UNIQUEMENT pour les éléments dans le chat
        Node.prototype.insertBefore = function(newNode, refNode) {
            const result = originalInsertBefore.call(this, newNode, refNode);
            if (newNode?.nodeType === Node.ELEMENT_NODE && isInChat(newNode)) {
                processElement(newNode);
            }
            return result;
        };

        // textContent - UNIQUEMENT si dans le chat ET contient des mots-clés
        Object.defineProperty(Node.prototype, 'textContent', {
            set(value) {
                if (typeof value === 'string' && value.length > 0 && value.length < 1000) {
                    // Vérifier d'abord si contient des mots-clés avant de vérifier isInChat (plus rapide)
                    if (value.startsWith('Replying to')) {
                        if (isInChat(this)) {
                            value = value.replace(REPLY_REGEX, '');
                        }
                    } else if (value.includes('subscribed') || value.includes('Gifted') || 
                               value.includes('redeemed') || value.includes('raided') ||
                               value.includes('Watch Streak') || value.includes('stream streak')) {
                        if (isInChat(this)) {
                            value = translateTextOnTheFly(value);
                        }
                    }
                }
                textContentDesc.set.call(this, value);
            },
            get: textContentDesc.get
        });

        // innerText - UNIQUEMENT si dans le chat ET contient des mots-clés
        if (innerTextDesc) {
            Object.defineProperty(HTMLElement.prototype, 'innerText', {
                set(value) {
                    if (typeof value === 'string' && value.length > 0 && value.length < 1000) {
                        if (value.startsWith('Replying to')) {
                            if (isInChat(this)) {
                                value = value.replace(REPLY_REGEX, '');
                            }
                        } else if (value.includes('subscribed') || value.includes('Gifted') || 
                                   value.includes('redeemed') || value.includes('raided') ||
                                   value.includes('Watch Streak') || value.includes('stream streak')) {
                            if (isInChat(this)) {
                                value = translateTextOnTheFly(value);
                            }
                        }
                    }
                    innerTextDesc.set.call(this, value);
                },
                get: innerTextDesc.get
            });
        }
    };

    // ============================================
    // MUTATION OBSERVER - LIMITÉ AU CONTENEUR CHAT
    // ============================================
    
    let pendingNodes = [];
    let pendingHighlights = [];
    let frameScheduled = false;
    const MAX_PENDING_NODES = 50;

    const processMutations = () => {
        const nodes = pendingNodes;
        const highlights = pendingHighlights;
        pendingNodes = [];
        pendingHighlights = [];
        frameScheduled = false;

        for (const node of nodes) {
            if (node.isConnected) processElement(node);
        }
        
        for (const target of highlights) {
            if (target.isConnected) propagateHighlight(target);
        }
    };

    const queueMutation = (mutation) => {
        if (mutation.type === 'childList') {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    if (pendingNodes.length >= MAX_PENDING_NODES) {
                        pendingNodes.shift();
                    }
                    pendingNodes.push(node);
                }
            }
        } else if (mutation.type === 'attributes') {
            const target = mutation.target;
            if (target.classList?.contains('seventv-user-message') && target.classList?.contains('has-highlight')) {
                pendingHighlights.push(target);
            }
        }
        
        if (!frameScheduled && (pendingNodes.length > 0 || pendingHighlights.length > 0)) {
            frameScheduled = true;
            requestAnimationFrame(processMutations);
        }
    };

    const createObserver = () => new MutationObserver((mutations) => {
        for (const m of mutations) queueMutation(m);
    });

    // ============================================
    // INITIALISATION
    // ============================================
    
    const findChatContainer = () => {
        for (const selector of CHAT_CONTAINER_SELECTORS) {
            const container = document.querySelector(selector);
            if (container) return container;
        }
        return null;
    };

    const observeContainer = (container) => {
        if (isObserving || !container) return;

        // Stocker la référence du conteneur pour isInChat()
        chatContainer = container;

        chatObserver = createObserver();
        chatObserver.observe(container, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class'] // Seulement class, pas style
        });

        isObserving = true;
        
        collectEmotesFromChat();
        
        if (emoteCollectorScheduler) emoteCollectorScheduler.stop();
        emoteCollectorScheduler = createIdleScheduler(collectEmotesFromChat, 20000);
        emoteCollectorScheduler.start();
        
        if (giftCleanupScheduler) giftCleanupScheduler.stop();
        giftCleanupScheduler = createIdleScheduler(() => giftTracker.cleanupOld(), 45000);
        giftCleanupScheduler.start();
        
        processElement(container);
    };

    const waitForChatContainer = () => {
        const container = findChatContainer();
        if (container) {
            observeContainer(container);
            return;
        }

        // Observer temporaire pour attendre le conteneur de chat
        const bodyObserver = new MutationObserver(() => {
            const c = findChatContainer();
            if (c) {
                bodyObserver.disconnect();
                observeContainer(c);
            }
        });

        const startBodyObserver = () => {
            bodyObserver.observe(document.body, { childList: true, subtree: true });
            
            // Timeout - arrêter d'observer si pas trouvé après 15 secondes
            // NE PAS observer document.body en fallback
            setTimeout(() => {
                if (!isObserving) {
                    bodyObserver.disconnect();
                    // Réessayer de trouver le conteneur toutes les 2 secondes
                    const retryInterval = setInterval(() => {
                        const c = findChatContainer();
                        if (c) {
                            clearInterval(retryInterval);
                            observeContainer(c);
                        }
                    }, 2000);
                    // Arrêter les tentatives après 60 secondes
                    setTimeout(() => clearInterval(retryInterval), 60000);
                }
            }, 15000);
        };

        if (document.body) startBodyObserver();
        else document.addEventListener('DOMContentLoaded', startBodyObserver, { once: true });
    };

    // Navigation SPA
    const handleNavigation = () => {
        let lastUrl = location.href;

        const checkUrlChange = () => {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                
                if (chatObserver) {
                    chatObserver.disconnect();
                    isObserving = false;
                }
                
                chatContainer = null;
                
                if (emoteCollectorScheduler) {
                    emoteCollectorScheduler.stop();
                    emoteCollectorScheduler = null;
                }
                if (giftCleanupScheduler) {
                    giftCleanupScheduler.stop();
                    giftCleanupScheduler = null;
                }
                
                emoteCache.clear();
                
                for (const [key, data] of giftTracker.pending.entries()) {
                    if (data.timeout) clearTimeout(data.timeout);
                }
                giftTracker.pending.clear();
                giftTracker.earlyGifts.clear();
                
                setTimeout(waitForChatContainer, 500);
            }
        };

        window.addEventListener('popstate', checkUrlChange);
        
        const origPush = history.pushState;
        const origReplace = history.replaceState;
        history.pushState = function(...args) { origPush.apply(this, args); checkUrlChange(); };
        history.replaceState = function(...args) { origReplace.apply(this, args); checkUrlChange(); };
    };

    // Démarrage
    setupInterceptors();
    handleNavigation();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', waitForChatContainer, { once: true });
    } else {
        waitForChatContainer();
    }

    console.log('[Reply Fix + Compact Subs] Script actif - v14.2 - New reply detection');
})();