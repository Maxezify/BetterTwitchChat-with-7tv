/**
 * Tests de BetterTwitchChat.js contre du DOM Twitch réel.
 *
 * Les fixtures de `fixtures/lines.json` sont des extraits HTML réellement capturés
 * dans le chat de Twitch avec la nouvelle extension 7TV active (pseudos remplacés par
 * des placeholders). Le script est injecté dans Chromium puis on vérifie le rendu
 * calculé, pas seulement la présence de classes.
 *
 * Prérequis : Playwright + Chromium.
 * Lancement  : node tools/tests/run.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

// Playwright peut être installé localement ou globalement : on tente les deux.
const loadChromium = async () => {
    try {
        return (await import('playwright')).chromium;
    } catch {
        const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
        const mod = await import(`file://${globalRoot}/playwright/index.js`);
        return (mod.default ?? mod).chromium;
    }
};
const chromium = await loadChromium();

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = readFileSync(resolve(HERE, '../../BetterTwitchChat.js'), 'utf8');
const LINES = JSON.parse(readFileSync(resolve(HERE, 'fixtures/lines.json'), 'utf8'));

// PNG 1x1 : sans réseau, une image cassée se dimensionne sur son texte alternatif,
// ce qui fausserait la vérification de la taille de l'illustration « cadeau mystère ».
const INLINE_PNG = 'data:image/gif;base64,R0lGODlhZABkAIAAAP///wAAACH5BAEAAAAALAAAAABkAGQAAAIhhI+py+0Po5y02ouz3rz7D4biSJbmiabqyrbuC8fyTBcAOw==';
const withInlineImage = (html) => html.replace(/src="https:\/\/static-cdn[^"]*"/g, `src="${INLINE_PNG}"`);

const EMOTE_NAME = (LINES.emoteMessage.match(/data-emote-name="([^"]+)"/) || [])[1];
const LONG_TEXT = `regarde ça ${EMOTE_NAME} @alice c'est un message vraiment très long qui doit s'afficher en entier sans être coupé par une ellipse au bout d'une seule ligne`;

// La citation vise MentionUser01, qui figure déjà dans la fixture statique : sa
// couleur de chat est donc connue au moment où la réponse arrive.
const replyWithEmote = LINES.replyMod
    .replace(/<p title="[^"]*"/, `<p title="${LONG_TEXT}"`)
    .replace(/(Répond à <span dir="auto">)@[^<]*(<\/span>)/, '$1@MentionUser01$2')
    .replace(/(<span dir="auto">)!time(<\/span>)/, `$1${LONG_TEXT}$2`);

const highlightedReply = LINES.replyMod
    .replace('class="chat-line__message"', 'class="chat-line__message seventv-chat-message-custom-highlight"');

const FIXTURE = `<!doctype html><meta charset="utf-8"><title>fixture</title>
<style>
  body { background:#0e0e10; color:#efeff1; font:14px/1.5 Inter,Arial,sans-serif; margin:0; }
  /* Reproduit la troncature Twitch de la citation, que le script doit annuler. */
  .chat-line__message-container > div:first-child p {
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin: 0;
    color: #adadb8; font-size: 13px;
  }
  .chat-line__message { padding: 5px 20px; }
  /* Twitch dispose la rangée de citation en flex : bulle à gauche, texte à droite. */
  .chat-line__message-container > div:first-child > div { display: flex; align-items: center; gap: 4px; }
  .tw-svg { display: block; }
  /* Couleurs de highlight telles que 7TV les applique. */
  .seventv-chat-message-custom-highlight { background: rgba(224,5,185,.16); border-left: 2px solid rgb(224,5,185); }
  .seventv-chat-message-first-highlight  { background: rgba(205,56,205,.153); border-left: 2px solid rgb(205,56,205); }
  .mystery-gift-theme__image { width: 96px; height: 96px; }
</style>
<div data-test-selector="chat-scrollable-area__message-container" class="chat-scrollable-area__message-container">
${LINES.status}
${LINES.emoteMessage}
${LINES.plain}
</div>
<script>window.__LATER = ${JSON.stringify({
    replyWithEmote,
    replyMod: LINES.replyMod,
    highlightedReply,
    subPrime: LINES.subPrime,
    resub: LINES.resub,
    giftMass: withInlineImage(LINES.giftMass),
    giftSingles: LINES.giftSingles,
    sysNotice: LINES.sysNotice
})};</script>`;

// ---------------------------------------------------------------------------
const checks = [];
const check = (name, actual, expected) => {
    const ok = typeof expected === 'function' ? expected(actual) : Object.is(actual, expected);
    checks.push({ name, ok, actual, expected: typeof expected === 'function' ? '(prédicat)' : expected });
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 360, height: 900 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('https://www.twitch.tv/')) {
        return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FIXTURE });
    }
    return route.abort();
});
await page.goto('https://www.twitch.tv/examplestreamer');
await page.evaluate(SCRIPT);
await page.waitForTimeout(150);

const addLines = (keys) => page.evaluate((ks) => {
    const root = document.querySelector('[data-test-selector="chat-scrollable-area__message-container"]');
    for (const k of ks) {
        const v = window.__LATER[k];
        for (const html of Array.isArray(v) ? v : [v]) {
            const holder = document.createElement('div');
            holder.innerHTML = html;
            root.appendChild(holder.firstElementChild);
        }
    }
}, keys);

await addLines(['replyWithEmote', 'replyMod', 'highlightedReply', 'subPrime', 'resub', 'sysNotice', 'giftMass']);
await page.waitForTimeout(250);
await addLines(['giftSingles']);
await page.waitForTimeout(300);

// Idempotence : plusieurs passes complètes ne doivent rien dupliquer.
await page.evaluate(() => { window.__BTC.reload(); window.__BTC.reload(); window.__BTC.reload(); });
await page.waitForTimeout(250);

const r = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const qa = (s) => [...document.querySelectorAll(s)];
    const quote = q('.btc-reply-quote');
    const qs = quote && getComputedStyle(quote);
    const hl = q('.seventv-chat-message-custom-highlight');
    const hlSlot = hl && hl.querySelector('.btc-reply-slot');
    const giftList = q('.btc-gift-recipients');
    const massImg = q('.mystery-gift-theme__image');
    const noticeLine = q('.btc-notice-card .btc-notice-line');
    const resubCustom = q('.btc-notice-line [data-a-target="chat-resubscription-message__custom-message"]');

    return {
        replyLines: qa('.chat-line__message.btc-reply').length,
        whiteSpace: qs && qs.whiteSpace,
        overflow: qs && qs.overflow,
        textOverflow: qs && qs.textOverflow,
        color: qs && qs.color,
        fontSize: qs && qs.fontSize,
        wrappedLines: quote
            ? Math.round(quote.getBoundingClientRect().height / parseFloat(qs.lineHeight)) : 0,
        prefixStripped: quote ? !/Répond à|Replying to/.test(quote.textContent) : false,
        emotes: qa('.btc-reply-quote .btc-reply-emote').length,
        emoteFrom7tv: /cdn\.7tv\.app/.test((q('.btc-reply-quote .btc-reply-emote') || {}).src || ''),
        mentions: qa('.btc-reply-quote .btc-reply-mention').length,
        gradeAccent: hl ? hl.style.getPropertyValue('--btc-reply-accent') : '',
        // Style « rail » : la citation n'a plus de cadre propre, l'accent est porté
        // par un box-shadow interne sur toute la ligne.
        slotHasOwnBox: hlSlot
            ? (getComputedStyle(hlSlot).backgroundImage !== 'none'
               || parseFloat(getComputedStyle(hlSlot).borderLeftWidth) > 0)
            : true,
        lineBoxShadow: hl ? getComputedStyle(hl).boxShadow : '',
        quotedNameColored: (() => {
            const t = document.querySelector('.btc-reply-quote .btc-reply-target');
            return t ? t.style.color : '';
        })(),
        // Calage vertical de la bulle sur la première ligne de la citation. Le décalage
        // doit être petit ET identique partout, y compris quand la première ligne
        // contient une emote susceptible de faire grandir la ligne.
        iconOffsets: [...document.querySelectorAll('.btc-reply-slot')].map((slot) => {
            const svg = slot.querySelector('svg');
            const quote = slot.querySelector('.btc-reply-quote');
            if (!svg || !quote) return null;
            const walker = document.createTreeWalker(quote, NodeFilter.SHOW_TEXT);
            let first = null, n;
            while (!first && (n = walker.nextNode())) if (n.textContent.trim()) first = n;
            if (!first) return null;
            const range = document.createRange();
            range.selectNodeContents(first);
            const line = range.getClientRects()[0];
            if (!line) return null;
            const s = svg.getBoundingClientRect();
            return +((s.top + s.height / 2) - (line.top + line.height / 2)).toFixed(1);
        }).filter(v => v !== null),
        noticeFontSize: noticeLine ? getComputedStyle(noticeLine).fontSize : '',
        resubCustomFontSize: resubCustom ? getComputedStyle(resubCustom).fontSize : '',
        massImgWidth: massImg ? getComputedStyle(massImg).width : '',
        giftRecipients: giftList ? [...giftList.querySelectorAll('.btc-gift-recipient')].map(e => e.textContent) : [],
        giftHidden: qa('.btc-hidden').length,
        giftExpected: (() => { const e = [...window.__BTC.gifts.pending.values()][0]; return e ? e.expected : null; })(),
        sysNoticeText: (q('.seventv-system-notice') || {}).textContent || '',
        rootPolluted: q('[data-test-selector="chat-scrollable-area__message-container"]').classList.contains('btc-notice-card'),
        horizontalScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
});

// --- 1. fond plus clair sur les messages qui répondent ---
check('réponses détectées', r.replyLines, 3);
check('citation sans cadre détaché (style rail)', r.slotHasOwnBox, false);

// --- 2. réponse visible en entier, plus petite, grise, avec emotes ---
check('citation non tronquée (white-space)', r.whiteSpace, 'normal');
check('citation non tronquée (overflow)', r.overflow, 'visible');
check('citation non tronquée (text-overflow)', r.textOverflow, 'clip');
check('citation sur plusieurs lignes', r.wrappedLines, (v) => v >= 3);
check('police réduite', r.fontSize, '11.9px');
check('couleur grise', r.color, 'rgb(143, 143, 154)');
check('préfixe « Répond à » retiré', r.prefixStripped, true);
check('emote rendue dans la citation', r.emotes, 1);
check('emote servie par le CDN 7TV', r.emoteFrom7tv, true);
check('mention mise en valeur', r.mentions, 1);

// --- 3. notices compactées + regroupement des gifts ---
check('notices compactées', r.noticeFontSize, '12.5px');
check('message de resub à taille normale', r.resubCustomFontSize, '14px');
check('illustration cadeau réduite', r.massImgWidth, '26px');
check('gifts individuels masqués', r.giftHidden, 3);
check('destinataires regroupés', r.giftRecipients.join(','), 'recipient_one,recipient_two,recipient_three');
check('nombre de gifts annoncé lu', r.giftExpected, 50);
check('notice système 7TV traduite', r.sysNoticeText, 'timedout_user a été exclu 30 s');

// --- 4. couleur de grade 7TV reprise sur la réponse ---
check('accent de grade capté', r.gradeAccent, 'rgb(224, 5, 185)');
check('filet de grade sur toute la ligne', r.lineBoxShadow, (v) => /rgb\(224, 5, 185\).*inset/.test(v));
check('pseudo cité non coloré par défaut', r.quotedNameColored, '');
check('bulle calée sur la première ligne', r.iconOffsets, (v) => v.length >= 2 && v.every(o => Math.abs(o) <= 1.5));
check('calage identique avec et sans emote', r.iconOffsets, (v) => new Set(v).size === 1);

// --- garde-fous ---
check('racine du chat non polluée', r.rootPolluted, false);
check('pas de débordement horizontal', r.horizontalScroll, false);
check('aucune erreur JS', pageErrors.length, 0);

// --- 5. 7TV pose sa classe après coup / navigation SPA ---
await page.evaluate(() => {
    const root = document.querySelector('[data-test-selector="chat-scrollable-area__message-container"]');
    const holder = document.createElement('div');
    holder.innerHTML = window.__LATER.replyMod;
    holder.firstElementChild.id = 'late';
    root.appendChild(holder.firstElementChild);
});
await page.waitForTimeout(150);
const accentBefore = await page.evaluate(() =>
    document.querySelector('#late .chat-line__message').style.getPropertyValue('--btc-reply-accent'));
await page.evaluate(() =>
    document.querySelector('#late .chat-line__message').classList.add('seventv-chat-message-custom-highlight'));
await page.waitForTimeout(200);
const accentAfter = await page.evaluate(() =>
    document.querySelector('#late .chat-line__message').style.getPropertyValue('--btc-reply-accent'));
check('pas d\'accent sans highlight', accentBefore, '');
check('accent capté quand 7TV colore après coup', accentAfter, 'rgb(224, 5, 185)');

// --- 6. les styles alternatifs restent fonctionnels ---
const styleProbe = await page.evaluate(async () => {
    const line = document.querySelector('.chat-line__message.btc-reply');
    const slot = line.querySelector('.btc-reply-slot');
    const read = () => ({
        lineShadow: getComputedStyle(line).boxShadow,
        slotBorder: parseFloat(getComputedStyle(slot).borderLeftWidth),
        slotBg: getComputedStyle(slot).backgroundImage,
        quoteWrap: getComputedStyle(line.querySelector('.btc-reply-quote')).whiteSpace
    });
    const out = {};
    for (const style of ['card', 'inline', 'rail']) {
        window.__BTC.config.reply.style = style;
        window.__BTC.reload();
        await new Promise(r => setTimeout(r, 60));
        out[style] = read();
    }
    return out;
});
// L'option de recoloration doit rester fonctionnelle même si elle est désactivée par défaut.
const colorOptIn = await page.evaluate(async () => {
    window.__BTC.config.reply.colorQuotedName = true;
    window.__BTC.reload();
    await new Promise(r => setTimeout(r, 80));
    const t = document.querySelector('.btc-reply-quote .btc-reply-target');
    const color = t ? t.style.color : '';
    window.__BTC.config.reply.colorQuotedName = false;
    return color;
});
check('recoloration du pseudo cité disponible en option', colorOptIn, (v) => !!v && v !== 'inherit');

check('card : la citation retrouve sa bordure', styleProbe.card.slotBorder, 4);
check('card : la citation retrouve son fond', styleProbe.card.slotBg, (v) => v !== 'none');
check('inline : aucun filet sur la ligne', styleProbe.inline.lineShadow, 'none');
check('inline : aucun cadre sur la citation', styleProbe.inline.slotBorder, 0);
check('rail : filet sur la ligne', styleProbe.rail.lineShadow, (v) => v !== 'none' && /inset/.test(v));
check('rail : aucun cadre sur la citation', styleProbe.rail.slotBorder, 0);
check('citation déroulée dans les trois styles',
    ['card', 'inline', 'rail'].every(s => styleProbe[s].quoteWrap === 'normal'), true);

await page.evaluate(() => history.pushState({}, '', '/une-autre-chaine'));
await page.waitForTimeout(1300);
await addLines(['replyMod']);
await page.waitForTimeout(300);
const afterNav = await page.evaluate(() => ({
    replies: document.querySelectorAll('.chat-line__message.btc-reply').length,
    pendingGifts: window.__BTC.gifts.pending.size,
    emoteIndex: window.__BTC.emotes.size
}));
check('traitement actif après navigation SPA', afterNav.replies, (v) => v >= 1);
check('gifts en attente purgés à la navigation', afterNav.pendingGifts, 0);

await browser.close();

// ---------------------------------------------------------------------------
let failed = 0;
for (const c of checks) {
    if (!c.ok) failed++;
    console.log(`${c.ok ? '  ok  ' : ' FAIL '} ${c.name}` +
        (c.ok ? '' : `\n         attendu : ${c.expected}\n         obtenu  : ${JSON.stringify(c.actual)}`));
}
console.log(`\n${checks.length - failed}/${checks.length} vérifications passées`);
if (pageErrors.length) console.log('Erreurs JS :', pageErrors);
process.exit(failed ? 1 : 0);
