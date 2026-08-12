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

// 7TV pose la couleur de sa règle de highlight en variables inline sur la ligne,
// exactement comme dans les captures de production.
const highlightedReply = LINES.replyMod
    .replace('class="chat-line__message"',
        'class="chat-line__message seventv-chat-message-custom-highlight" '
        + 'data-seventv-custom-highlight-label="M" '
        + 'style="--seventv-chat-custom-highlight-color: #55E800;'
        + ' --seventv-chat-custom-highlight-border-color: #55E800;'
        + ' --seventv-chat-custom-highlight-bg: #55E80026;"');

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
  .seventv-chat-message-custom-highlight {
    background: var(--seventv-chat-custom-highlight-bg);
    border-left: 2px solid var(--seventv-chat-custom-highlight-border-color); }
  .seventv-chat-message-first-highlight  { background: rgba(205,56,205,.153); border-left: 2px solid rgb(205,56,205); }
  .mystery-gift-theme__image { width: 96px; height: 96px; }
  /* Twitch rend les conteneurs du pseudo en bloc dans les notices, ce qui le pousse
     sur sa propre ligne au-dessus du texte. Déclaré important pour que le test prouve
     que nos règles l'emportent, comme pour la taille de la citation. */
  [data-test-selector="user-notice-line"] p > span:first-child { display: block !important; }
  [data-test-selector="user-notice-line"] .chatter-name { display: block !important; }
  /* Carte de notice telle que Twitch la construit : barre de couleur à gauche,
     contenu à droite, le tout en flex. C'est ce qui rend mesurables le collage de la
     barre au bord et l'écart entre la barre et le texte. */
  /* La notice système 7TV est un enfant direct de la racine du chat : sans cette
     exclusion, la règle transformerait la racine en conteneur flex et alignerait tous
     les messages côte à côte. */
  div:has(> [data-test-selector="user-notice-line"]):not([data-test-selector]) {
    display: flex; background: #26262c; }
  div:has(> [data-test-selector="user-notice-line"]):not([data-test-selector]) > div:first-child {
    width: 4px; align-self: stretch; background: rgb(250,41,41); }
  [data-test-selector="user-notice-line"] { flex: 1 1 auto; min-width: 0; }
  /* Porte-icône et bloc de texte sont dans un même flux en ligne : la première ligne
     démarre après l'icône, les suivantes reviennent sous elle. C'est le bord gauche
     irrégulier signalé sur une notice réelle. */
  [data-test-selector="user-notice-line"] div:has(> .tw-svg) { display: inline; }
  [data-test-selector="user-notice-line"] div:has(> p) { display: inline; }
  [data-test-selector="user-notice-line"] .tw-svg { display: inline-block; vertical-align: middle; }
  /* Le bloc texte du gift multiple est une colonne : pseudo au-dessus du message. */
  [data-test-selector="user-notice-line"] div:has(> .mystery-gift-theme__displayname) {
    display: flex !important; flex-direction: column !important; }
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
    // Formulation réelle d'un abonnement de longue date : le texte occupe deux lignes,
    // seule façon de vérifier que leur bord gauche est aligné.
    subPrime: LINES.subPrime.replace(
        '5e mois d\u2019abonnement',
        '60e mois d\u2019abonnement, dont 60 mois cons\u00e9cutifs'),
    resub: LINES.resub,
    giftMass: withInlineImage(LINES.giftMass),
    giftSingles: LINES.giftSingles,
    sysNotice: LINES.sysNotice
})};</script>`;

// ---------------------------------------------------------------------------
const checks = [];
const RAW_URL = 'https://raw.githubusercontent.com/Maxezify/BetterTwitchChat-with-7tv/'
    + 'claude/twitch-chat-7tv-userscript-1hh5y8/BetterTwitchChat.js';
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
        // Le pseudo d'une notice doit être sur la même ligne que le texte qui suit.
        // On compare les centres verticaux plutôt que les hauteurs : un simple
        // display:inline mal appliqué laisserait le pseudo au-dessus.
        noticeNomEnLigne: (() => {
            const notice = document.querySelector('.btc-notice-line');
            if (!notice) return null;
            const nom = notice.querySelector('.chatter-name');
            const para = nom && nom.closest('p');
            if (!nom || !para) return null;
            // premier nœud de texte utile après le pseudo, dans le même paragraphe
            const walker = document.createTreeWalker(para, NodeFilter.SHOW_TEXT);
            let apres = null, n, vuNom = false;
            while ((n = walker.nextNode())) {
                if (!vuNom) { if (nom.contains(n)) vuNom = true; continue; }
                if (n.textContent.trim()) { apres = n; break; }
            }
            if (!apres) return null;
            const range = document.createRange();
            range.selectNodeContents(apres);
            const rt = range.getClientRects()[0];
            const rn = nom.getBoundingClientRect();
            if (!rt) return null;
            return Math.round(Math.abs((rn.top + rn.height / 2) - (rt.top + rt.height / 2)));
        })(),
        // Les trois défauts signalés sur une notice réelle : barre décollée du bord,
        // texte collé à la barre, bord gauche du texte irrégulier d'une ligne à l'autre.
        noticeGeometrie: (() => {
            const ligne = document.querySelector('.btc-notice-line');
            const carte = ligne && ligne.closest('.btc-notice-card');
            const barre = carte && carte.querySelector('.btc-notice-bar');
            const para = ligne && ligne.querySelector('p');
            if (!ligne || !carte || !barre || !para) return null;
            const rc = carte.getBoundingClientRect(), rb = barre.getBoundingClientRect();
            // getClientRects() sur un bloc ne rend qu'une boîte : il faut un Range sur
            // son contenu pour obtenir une boîte par ligne de texte.
            const portee = document.createRange();
            portee.selectNodeContents(para);
            const lignesTexte = [...portee.getClientRects()].filter(r => r.width > 1);
            return {
                barreAuBord: Math.round(rb.left - rc.left),
                ecartBarreContenu: Math.round(
                    (ligne.firstElementChild || ligne).getBoundingClientRect().left - rb.right),
                nbLignes: lignesTexte.length,
                desalignement: lignesTexte.length >= 2
                    ? Math.round(Math.abs(lignesTexte[0].left - lignesTexte[1].left)) : 0,
                // Le vrai symptôme : l'icône dans le flux du texte fait démarrer la 1re
                // ligne après elle, les suivantes revenant sous elle. Le texte doit donc
                // occuper sa propre colonne, entièrement à droite de l'icône.
                texteApresIcone: (() => {
                    const icone = ligne.querySelector('.tw-svg');
                    if (!icone) return null;
                    return Math.round(para.getBoundingClientRect().left
                        - icone.getBoundingClientRect().right);
                })()
            };
        })(),
        // Gift multiple : le donateur doit être sur la ligne du texte, pas au-dessus.
        giftDonorEnLigne: (() => {
            const nom = document.querySelector('.btc-notice-line .mystery-gift-theme__displayname');
            if (!nom) return null;
            const suivant = nom.nextElementSibling;
            if (!suivant) return null;
            // Première ligne du texte seulement : sa boîte entière couvre plusieurs
            // lignes et son centre serait bien plus bas que celui du pseudo.
            const rs = suivant.getClientRects()[0];
            const rn = nom.getClientRects()[0];
            if (!rs || !rn) return null;
            return Math.round(Math.abs((rn.top + rn.height / 2) - (rs.top + rs.height / 2)));
        })(),
        // Espace au-dessus de la citation, mesuré depuis le haut de la zone de contenu
        // de la ligne. Posé en padding : une marge s'effondrerait hors du fond du
        // message et l'espace n'apparaîtrait pas là où on l'attend.
        espaceAuDessus: [...document.querySelectorAll('.chat-line__message.btc-reply')]
            .map((line) => {
                const slot = line.querySelector('.btc-reply-slot');
                const quote = slot && slot.querySelector('.btc-reply-quote');
                if (!quote) return null;
                const hautContenu = line.getBoundingClientRect().top
                    + parseFloat(getComputedStyle(line).paddingTop);
                return Math.round(quote.getBoundingClientRect().top - hautContenu);
            }).filter(v => v !== null),
        pseudosSoulignes: (() => {
            const cibles = [...document.querySelectorAll('.btc-reply-quote .btc-reply-target')];
            const mentions = [...document.querySelectorAll('.btc-reply-quote .btc-reply-mention')];
            // Exiger la présence des deux : sans ça, l'assertion passait alors que la
            // cible de la réponse n'était même pas étiquetée, donc jamais soulignée.
            if (!cibles.length || !mentions.length) return null;
            return [...cibles, ...mentions]
                .every(el => /underline/.test(getComputedStyle(el).textDecorationLine));
        })(),
        // Écart entre le bas de la citation et le haut du message : à 1 px la citation
        // paraissait collée au message.
        gapCitationMessage: [...document.querySelectorAll('.chat-line__message.btc-reply')]
            .map((line) => {
                const slot = line.querySelector('.btc-reply-slot');
                const corps = line.querySelector('.chat-line__no-background');
                if (!slot || !corps) return null;
                return Math.round(corps.getBoundingClientRect().top - slot.getBoundingClientRect().bottom);
            }).filter(v => v !== null),
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
        coupables: (() => {
            const large = document.documentElement.clientWidth;
            return [...document.querySelectorAll('*')]
                .filter(el => el.getBoundingClientRect().right > large + 1)
                .slice(0, 6)
                .map(el => ({
                    tag: el.tagName,
                    cls: (el.getAttribute('class') || '').split(' ').filter(c => !/-sc-/.test(c)).join(' '),
                    right: Math.round(el.getBoundingClientRect().right),
                    w: Math.round(el.getBoundingClientRect().width)
                }));
        })(),
        rootPolluted: q('[data-test-selector="chat-scrollable-area__message-container"]').classList.contains('btc-notice-card'),
        horizontalScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
});

// --- 1. fond plus clair sur les messages qui répondent ---
check('réponses détectées', r.replyLines, 3);
check('citation sans cadre détaché (style rail)', r.slotHasOwnBox, false);
check('espace entre citation et message', r.gapCitationMessage, (v) => v.length >= 2 && v.every(g => g >= 9));
check('espace au-dessus de la citation', r.espaceAuDessus, (v) => v.length >= 2 && v.every(g => g >= 9));
check('espaces haut et bas symétriques', r.espaceAuDessus,
    (v) => v.every((haut, i) => Math.abs(haut - r.gapCitationMessage[i]) <= 1));
check('pseudos cités soulignés', r.pseudosSoulignes, true);
check('pseudo de notice sur la ligne du texte', r.noticeNomEnLigne, (v) => v !== null && v <= 3);
check('donateur du gift multiple sur la ligne du texte', r.giftDonorEnLigne, (v) => v !== null && v <= 3);
check('barre de couleur collée au bord gauche', r.noticeGeometrie, (g) => g && g.barreAuBord === 0);
check('contenu décollé de la barre', r.noticeGeometrie, (g) => g && g.ecartBarreContenu >= 6);
check('notice sur plusieurs lignes (cas mesurable)', r.noticeGeometrie, (g) => g && g.nbLignes >= 2);
check('bord gauche du texte régulier', r.noticeGeometrie, (g) => g && g.desalignement <= 1);
check('texte en colonne à droite de l\'icône', r.noticeGeometrie, (g) => g && g.texteApresIcone >= 0);

// --- 2. réponse visible en entier, plus petite, grise, avec emotes ---
check('citation non tronquée (white-space)', r.whiteSpace, 'normal');
check('citation non tronquée (overflow)', r.overflow, 'visible');
check('citation non tronquée (text-overflow)', r.textOverflow, 'clip');
check('citation sur plusieurs lignes', r.wrappedLines, (v) => v >= 3);
check('police réduite', r.fontSize, '10.92px');
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
check('accent de grade lu depuis la variable 7TV', r.gradeAccent, '#55E800');
check('filet de grade sur toute la ligne', r.lineBoxShadow, (v) => /rgb\(85, 232, 0\).*inset/.test(v));
check('pseudo cité non coloré par défaut', r.quotedNameColored, '');
check('bulle calée sur la première ligne', r.iconOffsets, (v) => v.length >= 2 && v.every(o => Math.abs(o) <= 1.5));
// Égalité stricte serait trompeuse : une emote décale la ligne de base d'une fraction
// de pixel. Ce qui compte est que l'écart reste sous le pixel, donc invisible.
check('calage stable avec et sans emote', r.iconOffsets,
    (v) => Math.max(...v) - Math.min(...v) <= 1);

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
// En production, 7TV ajoute la classe ET les variables de couleur d'un seul geste.
await page.evaluate(() => {
    const el = document.querySelector('#late .chat-line__message');
    el.style.setProperty('--seventv-chat-custom-highlight-border-color', '#E005B9');
    el.style.setProperty('--seventv-chat-custom-highlight-bg', '#E005B926');
    el.classList.add('seventv-chat-message-custom-highlight');
});
await page.waitForTimeout(200);
const accentAfter = await page.evaluate(() =>
    document.querySelector('#late .chat-line__message').style.getPropertyValue('--btc-reply-accent'));
check('pas d\'accent sans highlight', accentBefore, '');
check('accent capté quand 7TV colore après coup', accentAfter, '#E005B9');

// --- mise à jour automatique : Tampermonkey a besoin des deux directives ---
check('@updateURL présent', SCRIPT, (t) => t.includes('// @updateURL') && t.includes(RAW_URL));
check('@downloadURL présent', SCRIPT, (t) => t.includes('// @downloadURL') && t.includes(RAW_URL));
check('version de l\'en-tête alignée sur VERSION', SCRIPT, (t) => {
    const entete = (t.match(/@version\s+([\d.]+)/) || [])[1];
    const constante = (t.match(/const VERSION = '([\d.]+)'/) || [])[1];
    return entete && entete === constante;
});

// --- auto-diagnostic : sain d'abord, cassé ensuite ---
const sain = await page.evaluate(() => window.__BTC.selfCheck());
check('auto-diagnostic : toutes les ancres répondent', sain.ok, true);
check('auto-diagnostic : chat non considéré inactif', sain.inactif, false);
check('auto-diagnostic : réponses comptées', sain.compteurs.reponses, (v) => v >= 3);
check('auto-diagnostic : aucune réponse ratée', sain.compteurs.reponsesRatees, 0);

// Casse simulée : Twitch annonce une réponse dans l'aria-label, mais la citation n'est
// plus là où nous la cherchons. C'est le scénario exact qui a tué la v14 en silence.
const casse = await page.evaluate(() => {
    const root = document.querySelector('[data-test-selector="chat-scrollable-area__message-container"]');
    const holder = document.createElement('div');
    holder.innerHTML = window.__LATER.replyMod;
    const line = holder.firstElementChild.querySelector('.chat-line__message');
    line.setAttribute('aria-label', 'Réponse à Quelqun, Envoyé à 14:28 et Bot : test');
    // on vide l'emplacement où vit la citation
    line.querySelector('.chat-line__message-container').firstElementChild.innerHTML = '';
    root.appendChild(holder.firstElementChild);
    return null;
});
await page.waitForTimeout(250);
const alerte = await page.evaluate(() => window.__BTC.selfCheck());
check('auto-diagnostic : casse de la citation détectée', alerte.ok, false);
check('auto-diagnostic : la bonne ancre est désignée', alerte.sondes,
    (ss) => ss.some(p => p.ancre === 'bloc de citation' && !p.ok));
check('auto-diagnostic : réponse ratée comptabilisée', alerte.compteurs.reponsesRatees, (v) => v >= 1);

// Panne la plus grave : le conteneur du chat introuvable. L'auto-diagnostic n'étant
// planifié que depuis start(), elle ne déclenchait aucun avertissement.
const rootIntrouvable = await page.evaluate(() => {
    const probe = window.__BTC.selfCheck.call(null);
    return probe;
});
check('auto-diagnostic : sonde du conteneur présente', rootIntrouvable.sondes,
    (ss) => ss.some(p => p.ancre === 'conteneur du chat'));

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
// Filet de sécurité : si la variable de scale disparaît (feuille concurrente, ordre de
// cascade), calc() deviendrait invalide et font-size retomberait sur l'héritage, soit la
// taille du message. Le repli inscrit dans var() doit empêcher ça.
const scaleFallback = await page.evaluate(async () => {
    const root = document.documentElement;
    root.style.setProperty('--btc-reply-font-scale', 'initial');
    await new Promise(r => setTimeout(r, 50));
    const size = getComputedStyle(document.querySelector('.btc-reply-quote')).fontSize;
    root.style.removeProperty('--btc-reply-font-scale');
    return size;
});
check('la citation reste réduite sans la variable', scaleFallback, '10.92px');

// Le diagnostic intégré doit rapporter la version et les tailles réellement appliquées.
const diag = await page.evaluate(() => window.__BTC.check());
check('__BTC.check() rapporte la version', diag.version, (v) => /^\d+\.\d+\.\d+$/.test(v));
check('__BTC.check() mesure la citation', diag.tailleCitation, '10.92px');
check('__BTC.check() mesure le message', diag.tailleMessage, '14px');

// Régression majeure : Twitch stylise la citation via une classe styled-components
// hachée qui déclare font-size en !important, et injecte sa feuille APRÈS la nôtre.
// À spécificité égale c'est l'ordre qui tranche, et nous perdions. On reproduit
// exactement ce scénario : notre règle doit tenir.
const vsTwitch = await page.evaluate(async () => {
    const rival = document.createElement('style');
    rival.id = 'faux-styled-components';
    rival.textContent = '.OLUUU { font-size: 14px !important; white-space: nowrap !important;'
        + ' overflow: hidden !important; text-overflow: ellipsis !important; }';
    document.head.appendChild(rival);           // injectée après btc-styles
    await new Promise(r => setTimeout(r, 60));
    const cs = getComputedStyle(document.querySelector('.btc-reply-quote'));
    const out = { fontSize: cs.fontSize, whiteSpace: cs.whiteSpace, overflow: cs.overflow };
    rival.remove();
    return out;
});
check('taille tenue face à un !important concurrent', vsTwitch.fontSize, '10.92px');
check('déroulement tenu face à un !important concurrent', vsTwitch.whiteSpace, 'normal');
check('overflow tenu face à un !important concurrent', vsTwitch.overflow, 'visible');

// Le diagnostic de cascade doit désigner notre règle comme gagnante.
const why = await page.evaluate(() => window.__BTC.whyFontSize());
check('whyFontSize() rapporte la taille appliquée', why.applique, '10.92px');
check('whyFontSize() trouve notre règle', why.regles,
    (rs) => rs.some(r => /btc-reply-quote/.test(r.selecteur || '') && r.important));

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
if (r.coupables.length) {
    console.log('éléments qui débordent :', JSON.stringify(r.coupables, null, 1));
}
let failed = 0;
for (const c of checks) {
    if (!c.ok) failed++;
    console.log(`${c.ok ? '  ok  ' : ' FAIL '} ${c.name}` +
        (c.ok ? '' : `\n         attendu : ${c.expected}\n         obtenu  : ${JSON.stringify(c.actual)}`));
}
console.log(`\n${checks.length - failed}/${checks.length} vérifications passées`);
if (pageErrors.length) console.log('Erreurs JS :', pageErrors);
process.exit(failed ? 1 : 0);
