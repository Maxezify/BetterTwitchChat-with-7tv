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
// Le srcset est retiré avec : il l'emporte sur src, et son URL réseau serait refusée.
// Une image cassée dont l'alt est vide n'est pas rendue du tout par Chrome — sa boîte
// vaut alors 0, quelle que soit la hauteur imposée, et toute mesure serait trompeuse.
const withInlineImage = (html) => html
    .replace(/srcset="[^"]*"/g, '')
    .replace(/src="https:\/\/static-cdn[^"]*"/g, `src="${INLINE_PNG}"`);

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
  /* Variables de thème Twitch relevées dans la capture. Sans elles, la barre d'une
     série de visionnage — dont la couleur est déclarée var(--color-border-quote) — est
     invalide, donc transparente, et la notice ne ressemble plus à ce qui s'affiche. */
  :root { --color-border-quote: #adadb8; }
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
  /* Règle réelle de 7TV, relevée dans sa feuille injectée. Sa spécificité vient d'un
     :is() suivi de huit :not() — (0,10,0) — et elle n'est pas !important. Le padding
     haut y est presque le double du bas : 7TV y loge son étiquette de règle. */
  :is([data-a-target="chat-line-message"], .room-message).seventv-chat-message-custom-highlight:not(.chat-line--inline):not(.seventv-chat-message-mention-highlight):not(.seventv-chat-message-reply-highlight):not(.seventv-chat-message-monitored-highlight):not(.seventv-chat-message-restricted-highlight):not(.seventv-chat-message-raider-highlight):not(.seventv-chat-message-first-highlight):not(.seventv-chat-message-usercard-open-highlight) {
    background: var(--seventv-chat-custom-highlight-bg);
    padding-top: 1.3rem;
    padding-bottom: 0.75rem;
    border-left: 2px solid var(--seventv-chat-custom-highlight-border-color); }
  .seventv-chat-message-first-highlight  { background: rgba(205,56,205,.153); border-left: 2px solid rgb(205,56,205); }
  /* Étiquette de règle « Custom Highlights ». La vraie règle vit dans une feuille de
     style d'extension illisible depuis la page ; on reproduit le seul mécanisme qui
     puisse afficher un attribut, pour que le test mesure une disparition réelle. */
  .chat-line__message[data-seventv-custom-highlight-label]::after {
    content: attr(data-seventv-custom-highlight-label); }
  .mystery-gift-theme__image { width: 96px; height: 96px; }
  /* Twitch rend les conteneurs du pseudo en bloc dans les notices, ce qui le pousse
     sur sa propre ligne au-dessus du texte. Déclaré important pour que le test prouve
     que nos règles l'emportent, comme pour la taille de la citation. */
  /* Visé par sa structure, comme en production : c'est l'enveloppe du pseudo qui est
     rendue en bloc. Un "p > span:first-child" attraperait aussi le fragment en gras
     d'un watch streak (« Série de visionnage atteinte ! »), qui lui reste en ligne —
     la fixture inventerait alors un défaut que le script n'a pas à corriger. */
  [data-test-selector="user-notice-line"] span:has(> .chatter-name) { display: block !important; }
  [data-test-selector="user-notice-line"] .chatter-name { display: block !important; }
  /* Twitch déclare la taille de police sur ses composants de texte (les classes
     CoreText hachées) en !important — même rapport de force que sur la citation, où
     .OLUUU nous avait fait perdre. Sans cette règle, la fixture laisserait croire que
     notre taille posée sur la ligne de notice suffit à s'imposer aux fragments. */
  [data-test-selector="user-notice-line"] .CoreText-sc-1txzju1-0 { font-size: 13px !important; }
  /* Aucune couleur n'est posée sur le pseudo d'une notice, volontairement. Twitch n'y
     applique pas la couleur de chat, et rien ne dit qu'il pose la moindre couleur : le
     pseudo hériterait donc du gris appliqué à la notice et deviendrait indistinct.
     C'est le cas risqué, donc celui que la fixture doit représenter. La couleur d'un
     pseudo dans un message joint, elle, vient de la capture — pas d'une règle inventée. */
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
    // Images servies pour de bon : un badge dont le chargement échoue est rendu comme
    // son texte alternatif, et sa boîte cesse de suivre la taille qu'on lui impose.
    resub: withInlineImage(LINES.resub),
    watchStreak: withInlineImage(LINES.watchStreak),
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

await addLines(['replyWithEmote', 'replyMod', 'highlightedReply', 'subPrime', 'resub', 'watchStreak', 'sysNotice', 'giftMass']);
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
        // Notice « série de visionnage » : Twitch y place le pseudo et les points de
        // chaîne dans un bloc, au-dessus du texte. Tout doit tenir sur un flux continu.
        watchStreak: (() => {
            const notice = qa('.btc-notice-line').find(n => /visionnage/i.test(n.textContent));
            if (!notice) return null;
            const nom = notice.querySelector('.chatter-name');
            const p = [...notice.querySelectorAll('p')].find(el => /actuellement/i.test(el.textContent));
            if (!nom || !p) return null;
            const rg = document.createRange();
            rg.selectNodeContents(p);
            const premiereLigne = [...rg.getClientRects()].filter(x => x.height > 0)[0];
            const rn = nom.getBoundingClientRect();
            return {
                pseudoEtTexteSurUneLigne: !!premiereLigne
                    && Math.abs(premiereLigne.top - rn.top) <= 2,
                hauteur: Math.round(notice.getBoundingClientRect().height),
                couleur: getComputedStyle(p).color,
                taille: getComputedStyle(p).fontSize,
                // Le pseudo doit échapper au gris : c'est lui qui identifie la notice.
                // Twitch pose sa couleur sur le span le plus intérieur, celui qui porte
                // le texte — viser un intermédiaire mesurerait la couleur héritée.
                couleurPseudo: (() => {
                    let el = nom;
                    while (el.firstElementChild) el = el.firstElementChild;
                    return getComputedStyle(el).color;
                })(),
                // Twitch séparait ces fragments par des sauts de bloc, pas par des
                // espaces. Mis en ligne, ils se recollaient (« 450Série de visionnage »).
                // Mesuré en pixels entre le bord droit d'un fragment et le bord gauche
                // du suivant : le contenu d'un ::after n'apparaît dans aucun textContent.
                ecarts: (() => {
                    const bord = (el, cote) => {
                        const rg2 = document.createRange();
                        rg2.selectNodeContents(el);
                        const rects = [...rg2.getClientRects()].filter(x => x.height > 0);
                        if (!rects.length) return null;
                        return cote === 'droite' ? rects[rects.length - 1].right : rects[0].left;
                    };
                    const ps = [...notice.querySelectorAll('p')];
                    const points = ps.find(el => el.textContent.trim() === '450');
                    const plus = ps.find(el => el.textContent.trim() === '+');
                    return {
                        apresPseudo: plus && bord(plus, 'gauche') !== null
                            ? Math.round(bord(plus, 'gauche') - bord(nom, 'droite')) : null,
                        apresPoints: points && bord(p, 'gauche') !== null
                            ? Math.round(bord(p, 'gauche') - bord(points, 'droite')) : null
                    };
                })(),
                // Une boîte rendue en ligne ignore width/height : l'icône de points de
                // chaîne repartait à sa taille naturelle et faisait enfler la ligne.
                hauteurIcone: (() => {
                    const img = notice.querySelector('img');
                    return img ? Math.round(img.getBoundingClientRect().height) : null;
                })(),
                // Écart entre le centre de l'icône et le centre de la notice entière.
                decalageIcone: (() => {
                    const ic = notice.querySelector('.btc-notice-icon');
                    const rangee = notice.querySelector('.btc-notice-row');
                    if (!ic || !rangee) return null;
                    const a = ic.getBoundingClientRect();
                    const b = rangee.getBoundingClientRect();
                    return Math.round(((a.top + a.height / 2) - (b.top + b.height / 2)) * 10) / 10;
                })(),
                // Nombre de lignes visuelles occupées par la notice.
                // Regroupées par proximité et non par une grille absolue : découper la
                // position en tranches fixes rendait le compte dépendant de l'endroit
                // de la page où tombe la notice, donc de la hauteur de celles d'avant.
                lignes: (() => {
                    const rg2 = document.createRange();
                    rg2.selectNodeContents(notice);
                    const hauts = [...rg2.getClientRects()]
                        .filter(x => x.height > 0).map(x => x.top).sort((a, b) => a - b);
                    let n = 0;
                    let ref = -Infinity;
                    for (const t of hauts) { if (t - ref > 4) { n++; ref = t; } }
                    return n;
                })()
            };
        })(),
        // Toutes les notices doivent porter la même couleur, y compris le gift multiple
        // — qui n'a pas d'icône SVG, donc pas de bloc de texte étiqueté.
        couleursNotices: qa('.btc-notice-line').map((n) => {
            const t = [...n.querySelectorAll('p,span')]
                .find(x => x.textContent.trim().length > 20) || n;
            return getComputedStyle(t).color;
        }),
        // Twitch impose sa taille sur chaque fragment de texte : mesurer la ligne de
        // notice ne dit rien de ce qui s'affiche réellement. On mesure les fragments,
        // les siens uniquement — les nôtres ont leurs propres tailles voulues.
        taillesNotices: qa('.btc-notice-line').flatMap((n) => [...n.querySelectorAll('p,span')]
            .filter(x => x.textContent.trim().length > 3
                && !String(x.className).includes('btc-')
                && !x.closest('.btc-gift-recipients'))
            .map(x => getComputedStyle(x).fontSize)),
        // Le message d'abonnement vit hors de la rangée icône + texte : il démarrait au
        // bord de la notice, sous l'icône, au lieu de s'aligner sur la phrase.
        alignementMessage: (() => {
            const el = q('.btc-notice-line [data-a-target="chat-resubscription-message__custom-message"]');
            const texte = el && el.closest('.btc-notice-line').querySelector('.btc-notice-text');
            if (!el || !texte) return null;
            return Math.round(el.getBoundingClientRect().left - texte.getBoundingClientRect().left);
        })(),
        // Teinte de fond reprise de la barre de la notice, où Twitch pose la couleur
        // d'accent de la chaîne en style inline.
        fondNoticeAbonnement: (() => {
            const n = qa('.btc-notice-line').find(x => /abonné\(e\)/i.test(x.textContent));
            const carte = n && n.closest('.btc-notice-card');
            return carte ? getComputedStyle(carte).backgroundImage : '';
        })(),
        // Une série de visionnage n'a pas la couleur de la chaîne sur sa barre : elle
        // retombe sur un gris de thème. Elle doit malgré tout reprendre cette couleur.
        teinteWatchStreak: (() => {
            const n = qa('.btc-notice-line').find(x => /visionnage/i.test(x.textContent));
            const carte = n && n.closest('.btc-notice-card');
            return carte ? carte.style.getPropertyValue('--btc-notice-tint') : '';
        })(),
        etiquettesHighlight: qa('[data-seventv-custom-highlight-label]').length,
        // 7TV réserve 1.3rem au-dessus pour son étiquette, 0.75rem en dessous.
        espacesHighlight: hl
            ? { haut: getComputedStyle(hl).paddingTop, bas: getComputedStyle(hl).paddingBottom }
            : null,
        // Ce que la ligne de grade affiche réellement en fin de ligne.
        etiquetteRendue: hl ? getComputedStyle(hl, '::after').content : null,
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
        // Largeur totale de la barre visible à gauche : bordure de 7TV plus notre filet.
        // Les deux s'additionnent visuellement, c'est ce total qui doit rester constant
        // entre une réponse ordinaire et celle d'un modérateur.
        barreGauche: (() => {
            const mesurer = (el) => {
                if (!el) return null;
                const cs = getComputedStyle(el);
                const ombre = (cs.boxShadow.match(/(\d+(?:\.\d+)?)px\s+0px\s+0px\s+0px\s+inset/)
                    || cs.boxShadow.match(/inset\s+(\d+(?:\.\d+)?)px/) || [])[1];
                const bordure = parseFloat(cs.borderLeftWidth) || 0;
                const filet = ombre ? parseFloat(ombre) : 0;
                return { bordure: Math.round(bordure), filet: Math.round(filet),
                         total: Math.round(bordure + filet) };
            };
            const lignes = [...document.querySelectorAll('.chat-line__message.btc-reply')];
            return {
                grade: mesurer(lignes.find(l => l.classList.contains('seventv-chat-message-custom-highlight'))),
                ordinaire: mesurer(lignes.find(l => !l.classList.contains('seventv-chat-message-custom-highlight')))
            };
        })(),
        separateurAjoute: (() => {
            const line = document.querySelector('.chat-line__message.btc-reply');
            if (!line) return null;
            return parseFloat(getComputedStyle(line).borderBottomWidth) > 0;
        })(),
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
        // Le message d'un resub prend le gris de la citation, sauf le pseudo : Twitch
        // pose sa couleur en style inline, qu'un !important de notre côté écraserait.
        resubCustomColor: resubCustom
            ? getComputedStyle(resubCustom.querySelector('.text-fragment') || resubCustom).color : '',
        resubPseudoColor: resubCustom && resubCustom.querySelector('.chat-author__display-name')
            ? getComputedStyle(resubCustom.querySelector('.chat-author__display-name')).color : '',
        // La ligne imbriquée porte le remplissage d'un message de chat : 20 px de côté
        // qui décalent le texte à l'intérieur de la notice.
        resubCustomPadding: resubCustom && resubCustom.querySelector('.chat-line__message')
            ? getComputedStyle(resubCustom.querySelector('.chat-line__message')).paddingLeft : '',
        // Le badge vit dans un <button>, dont la feuille par défaut du navigateur fixe
        // la police à 13.33px sans héritage : un em s'y résout sur cette taille-là.
        resubBadge: (() => {
            const b = resubCustom && resubCustom.querySelector('.chat-badge');
            if (!b) return null;
            return {
                hauteur: Math.round(b.getBoundingClientRect().height * 10) / 10,
                police: getComputedStyle(b).fontSize,
                interligne: getComputedStyle(resubCustom).lineHeight
            };
        })(),
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
check('aucun filet en double là où 7TV trace le sien', r.barreGauche,
    (v) => v && v.grade && v.grade.filet === 0 && v.grade.bordure > 0);
check('filet présent sur une réponse ordinaire', r.barreGauche,
    (v) => v && v.ordinaire && v.ordinaire.filet > 0);
check('barre gauche de même épaisseur avec et sans grade', r.barreGauche,
    (v) => v && v.grade && v.ordinaire && v.grade.total === v.ordinaire.total);
check('aucun séparateur ajouté', r.separateurAjoute, false);
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
// Comparé à la taille réellement rendue de la citation, pas à une valeur recopiée :
// c'est la ressemblance entre les deux qui est demandée, et elle doit survivre à un
// changement de `reply.fontScale`.
check('notices à la taille du texte cité', r.noticeFontSize, (v) => v === r.fontSize);
check('série de visionnage : pseudo et texte sur la même ligne',
    r.watchStreak, (v) => v && v.pseudoEtTexteSurUneLigne);
check('série de visionnage : aucun bloc résiduel dans la notice',
    r.watchStreak, (v) => v && v.lignes <= 2);
check('série de visionnage : texte à la couleur du texte cité',
    r.watchStreak, (v) => v && v.couleur === r.color);
// Twitch ne colore pas le pseudo d'une notice : sans garde-fou il hériterait du gris
// appliqué au texte et deviendrait impossible à repérer.
check('série de visionnage : le pseudo échappe au gris du texte',
    r.watchStreak, (v) => v && v.couleurPseudo !== r.color);
check('série de visionnage : espace entre le pseudo et les points',
    r.watchStreak, (v) => v && v.ecarts.apresPseudo >= 2);
check('série de visionnage : espace entre les points et le texte',
    r.watchStreak, (v) => v && v.ecarts.apresPoints >= 2);
check('série de visionnage : icône de points bornée sur l\'interligne',
    r.watchStreak, (v) => v && v.hauteurIcone > 0 && v.hauteurIcone <= 20);
// Comparé à la taille rendue de la notice qui l'entoure, pas à une valeur recopiée :
// c'est l'uniformité qui est demandée, et elle doit survivre à un changement de réglage.
check('message de resub à la taille de la notice',
    r.resubCustomFontSize, (v) => v === r.noticeFontSize);
check('message de resub à la couleur du texte cité', r.resubCustomColor, r.color);
check('toutes les notices à la couleur du texte cité, gift multiple compris',
    r.couleursNotices, (v) => v.length >= 5 && v.every(c => c === r.color));
// Twitch déclare sa taille sur chaque fragment, en !important : la poser sur la ligne
// ne suffit pas, et la notice restait plus grosse que la citation qu'elle jouxte.
check('chaque fragment de notice à la taille du texte cité',
    r.taillesNotices, (v) => v.length >= 10 && v.every(t => t === r.fontSize));
check('icône de notice centrée sur la hauteur du bloc',
    r.watchStreak, (v) => v && Math.abs(v.decalageIcone) <= 1);
check('message d\'abonnement aligné sur le texte de la notice',
    r.alignementMessage, (v) => v !== null && Math.abs(v) <= 1);
check('notice teintée de la couleur de sa barre',
    r.fondNoticeAbonnement, (v) => /rgba\(250,\s*41,\s*41,\s*0\.15\)/.test(v));
check('série de visionnage teintée de la couleur de la chaîne malgré sa barre neutre',
    r.teinteWatchStreak, 'rgba(250, 41, 41, 0.15)');
check('message de resub : le pseudo garde sa couleur',
    r.resubPseudoColor, (v) => v && v !== r.color);
check('message de resub sans le remplissage d\'une ligne de chat',
    r.resubCustomPadding, '0px');
check('message de resub : la police du <button> ne casse plus l\'héritage',
    r.resubBadge, (v) => v && v.police === r.noticeFontSize);
check('message de resub : badge à l\'échelle de l\'interligne',
    r.resubBadge, (v) => v && Math.abs(v.hauteur - parseFloat(v.interligne)) <= 1);
check('illustration cadeau réduite', r.massImgWidth, '26px');
check('gifts individuels masqués', r.giftHidden, 3);
check('destinataires regroupés', r.giftRecipients.join(','), 'recipient_one,recipient_two,recipient_three');
check('nombre de gifts annoncé lu', r.giftExpected, 50);
check('notice système 7TV traduite', r.sysNoticeText, 'timedout_user a été exclu 30 s');

// --- 4. couleur de grade 7TV reprise sur la réponse ---
check('accent de grade lu depuis la variable 7TV', r.gradeAccent, '#55E800');
check('étiquette de règle 7TV retirée du DOM', r.etiquettesHighlight, 0);
check('étiquette de règle 7TV plus affichée', r.etiquetteRendue, (v) => v === 'none' || v === '""');
check('espace au-dessus d\'un message de grade ramené à 0.75rem',
    r.espacesHighlight, (v) => v && v.haut === '12px');
check('espaces haut et bas symétriques sur un message de grade',
    r.espacesHighlight, (v) => v && v.haut === v.bas);
// 7TV trace déjà sa barre sur cette ligne : nous ne devons rien ajouter par-dessus.
check('pas d\'ombre ajoutée sur une ligne colorée par 7TV', r.lineBoxShadow, 'none');
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
// En production, 7TV ajoute la classe, les variables de couleur ET l'étiquette de règle
// d'un seul geste.
await page.evaluate(() => {
    const el = document.querySelector('#late .chat-line__message');
    el.style.setProperty('--seventv-chat-custom-highlight-border-color', '#E005B9');
    el.style.setProperty('--seventv-chat-custom-highlight-bg', '#E005B926');
    el.setAttribute('data-seventv-custom-highlight-label', '👮‍♂️');
    el.classList.add('seventv-chat-message-custom-highlight');
});
await page.waitForTimeout(200);
const apresHighlight = await page.evaluate(() => {
    const el = document.querySelector('#late .chat-line__message');
    return {
        accent: el.style.getPropertyValue('--btc-reply-accent'),
        etiquette: el.hasAttribute('data-seventv-custom-highlight-label')
    };
});
check('pas d\'accent sans highlight', accentBefore, '');
check('accent capté quand 7TV colore après coup', apresHighlight.accent, '#E005B9');
check('étiquette retirée quand 7TV la pose après coup', apresHighlight.etiquette, false);

// --- couleur du pseudo dans une notice ---
// Twitch n'y met pas la couleur de chat. Une série de visionnage récompense le fait de
// regarder, pas d'écrire : la personne n'a souvent jamais parlé quand la notice tombe,
// et sa couleur est encore inconnue. Le pseudo doit donc être recoloré après coup, au
// premier message qui passe.
const couleurAvant = await page.evaluate(() => {
    const n = [...document.querySelectorAll('.btc-notice-line')]
        .find(x => /visionnage/i.test(x.textContent));
    const nom = n.querySelector('.chatter-name');
    let interne = nom;
    while (interne.firstElementChild) interne = interne.firstElementChild;
    return {
        classe: nom.classList.contains('btc-notice-name'),
        style: nom.style.color,
        rendu: getComputedStyle(interne).color
    };
});
await page.evaluate((html) => {
    const root = document.querySelector('[data-test-selector="chat-scrollable-area__message-container"]');
    const holder = document.createElement('div');
    holder.innerHTML = html;
    root.appendChild(holder.firstElementChild);
}, LINES.plain
    .replace(/data-seventv-user-login="[^"]*"/g, 'data-seventv-user-login="streakuser01"')
    .replace(/data-a-user="[^"]*"/g, 'data-a-user="streakuser01"')
    .replace(/rgb\(139, 88, 255\)/g, 'rgb(255, 105, 180)')
    .replace(/>MentionUser01</g, '>StreakUser01<'));
await page.waitForTimeout(250);
const couleurApres = await page.evaluate(() => {
    const n = [...document.querySelectorAll('.btc-notice-line')]
        .find(x => /visionnage/i.test(x.textContent));
    const nom = n.querySelector('.chatter-name');
    let interne = nom;
    while (interne.firstElementChild) interne = interne.firstElementChild;
    return { pose: nom.style.color, rendu: getComputedStyle(interne).color };
});
check('pseudo de notice sans couleur tant que la personne n\'a pas parlé',
    couleurAvant, (v) => !v.classe && !v.style);
// Sans couleur connue, il doit rester lisible plutôt que fondre dans le gris du texte.
check('pseudo de notice à couleur inconnue non noyé dans le gris',
    couleurAvant, (v) => v.rendu && v.rendu !== r.color);
check('pseudo de notice recoloré dès que sa couleur devient connue',
    couleurApres, (v) => v.pose === 'rgb(255, 105, 180)' && v.rendu === 'rgb(255, 105, 180)');

// Sur un abonnement accompagné d'un message, la couleur est lue directement sur ce
// message plutôt que dans l'index : elle y est exacte, sans passer par le nom affiché.
const couleurResub = await page.evaluate(() => {
    const n = [...document.querySelectorAll('.btc-notice-line')]
        .find(x => x.querySelector('[data-a-target="chat-resubscription-message__custom-message"]'));
    const nom = n && n.querySelector('.chatter-name');
    if (!nom) return null;
    let interne = nom;
    while (interne.firstElementChild) interne = interne.firstElementChild;
    return getComputedStyle(interne).color;
});
check('pseudo d\'un abonnement coloré depuis le message joint',
    couleurResub, 'rgb(95, 158, 160)');

// Le highlight « premier message » de 7TV trace une bordure depuis sa feuille de style,
// sans poser la moindre variable inline. Lire les variables ne suffit donc pas à savoir
// qu'une barre existe déjà : il faut mesurer le style calculé.
const premierMessage = await page.evaluate(async () => {
    const root = document.querySelector('[data-test-selector="chat-scrollable-area__message-container"]');
    const holder = document.createElement('div');
    holder.innerHTML = window.__LATER.replyMod;
    holder.firstElementChild.id = 'premier';
    holder.firstElementChild.querySelector('.chat-line__message')
        .classList.add('seventv-chat-message-first-highlight');
    root.appendChild(holder.firstElementChild);
    await new Promise(r => setTimeout(r, 250));
    const cs = getComputedStyle(document.querySelector('#premier .chat-line__message'));
    return { bordure: Math.round(parseFloat(cs.borderLeftWidth) || 0), ombre: cs.boxShadow };
});
check('barre unique aussi sur un highlight sans variable inline', premierMessage,
    (v) => v.bordure > 0 && v.ombre === 'none');

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
// Même scénario sur les notices : Twitch y déclare la taille par ses composants de
// texte. La règle de fixture posée en tête de document nous laisserait gagner à
// spécificité égale — c'est l'injection tardive qui fait perdre, et c'est elle qui rend
// nécessaire le sélecteur de type. Sans lui, cette vérification tombe.
const noticeVsTwitch = await page.evaluate(async () => {
    const rival = document.createElement('style');
    rival.textContent = '[data-test-selector="user-notice-line"] .CoreText-sc-1txzju1-0'
        + ' { font-size: 13px !important; }';
    document.head.appendChild(rival);           // injectée après btc-styles
    await new Promise(r => setTimeout(r, 60));
    const notice = [...document.querySelectorAll('.btc-notice-line')]
        .find(x => /visionnage/i.test(x.textContent));
    const p = [...notice.querySelectorAll('p')].find(x => /actuellement/i.test(x.textContent));
    const out = getComputedStyle(p).fontSize;
    rival.remove();
    return out;
});
check('taille de notice tenue face à un !important injecté après nous',
    noticeVsTwitch, '10.92px');

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

check('card : la citation retrouve sa bordure', styleProbe.card.slotBorder, (v) => v > 0);
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

// Rien ne garantit qu'une notice d'abonnement arrive avant une série de visionnage : la
// couleur de la chaîne peut n'être connue qu'ensuite. La notice déjà posée doit alors
// être reteintée. La navigation vient de remettre l'accent à zéro, on est donc dans les
// conditions exactes d'un début de session.
const derniereTeinte = () => page.evaluate(() => {
    const cartes = [...document.querySelectorAll('#avant-abonnement .btc-notice-card')];
    return cartes.length ? cartes[0].style.getPropertyValue('--btc-notice-tint') : null;
});
await page.evaluate((html) => {
    const root = document.querySelector('[data-test-selector="chat-scrollable-area__message-container"]');
    const holder = document.createElement('div');
    holder.id = 'avant-abonnement';
    holder.innerHTML = html;
    root.appendChild(holder);
}, LINES.watchStreak);
await page.waitForTimeout(200);
const teinteAvant = await derniereTeinte();
await addLines(['subPrime']);
await page.waitForTimeout(200);
const teinteApres = await derniereTeinte();
check('série de visionnage d\'abord teintée d\'un gris faute de couleur de chaîne',
    teinteAvant, (v) => !!v && v !== 'rgba(250, 41, 41, 0.15)');
check('série de visionnage reteintée dès que la couleur de chaîne se présente',
    teinteApres, 'rgba(250, 41, 41, 0.15)');

// --- 6. le nouveau message reste entièrement visible ---
// Nos transformations agrandissent la ligne — citation déroulée, espaces ajoutés — dans
// la frame qui suit l'insertion, donc APRÈS que Twitch a recollé le chat en bas. Sans
// compensation, le bas du nouveau message se retrouve sous le pli.
const EPSILON = 4;   // même tolérance que le script

const reponse = (texte) => LINES.replyMod
    .replace(/<p title="[^"]*"/, `<p title="${texte}"`)
    .replace(/(<span dir="auto">)!time(<\/span>)/, `$1${texte}$2`);

const CITATION_LONGUE = '@MentionUser01 citation vraiment très longue que Twitch tronque '
    + 'en une seule ligne et que le script déroule sur plusieurs lignes';
const CITATION_EMOTES = `@MentionUser01 ${Array(8).fill(EMOTE_NAME).join(' ')} fin`;

// Une emote jamais vue : son image n'est pas chargée quand la citation la reconstruit,
// donc ses proportions sont inconnues et la place ne peut pas être réservée d'avance.
const EMOTE_INEDITE = 'EmoteInedite';
const messageEmoteInedite = LINES.emoteMessage
    .replaceAll(EMOTE_NAME, EMOTE_INEDITE)
    .replace(/emote\/[0-9A-Za-z]+\//g, 'emote/INEDITE/');

// L'ancre du scroller est facultative dans cette fixture : sans elle, le script doit
// retrouver l'élément qui défile en remontant depuis la racine du chat.
const fixtureDefilante = (avecAncre) => `<!doctype html><meta charset="utf-8"><title>défilement</title>
<style>
  html,body { margin:0; height:100%; background:#0e0e10; color:#efeff1;
              font:14px/1.5 Inter,Arial,sans-serif; }
  #defilement { height: 300px; overflow-y: auto; }
  .chat-line__message { padding: 5px 20px; }
  .chat-line__message-container > div:first-child p {
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin: 0;
    color: #adadb8; font-size: 13px; }
  .chat-line__message-container > div:first-child > div { display: flex; align-items: center; gap: 4px; }
  .tw-svg { display: block; }
  /* Twitch dimensionne ses badges en CSS. Sans ça ils grandissent à leur chargement et
     ajoutent un décalage qui ne vient pas du script — faux coupable garanti. */
  .chat-badge { width: 18px; height: 18px; vertical-align: -4px; }
</style>
<div id="defilement" class="scrollable-area"${avecAncre ? ' data-a-target="chat-scroller"' : ''}>
  <div class="simplebar-content">
    <div data-test-selector="chat-scrollable-area__message-container"
         class="chat-scrollable-area__message-container">
      ${Array.from({ length: 30 }, () => LINES.plain).join('\n')}
      ${LINES.emoteMessage}
    </div>
  </div>
</div>`;

const ouvrirPageDefilante = async (avecAncre) => {
    const pg = await browser.newPage({ viewport: { width: 340, height: 320 } });
    pg.on('pageerror', (e) => pageErrors.push(e.message));
    await pg.route('**/*', async (route) => {
        const url = route.request().url();
        if (url.startsWith('https://www.twitch.tv/')) {
            return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8',
                body: fixtureDefilante(avecAncre) });
        }
        // Latence CDN : c'est elle qui provoque la seconde poussée de hauteur quand la
        // largeur de l'emote n'a pas été réservée à l'avance.
        await new Promise(res => setTimeout(res, 150));
        return route.fulfill({ status: 200, contentType: 'image/svg+xml',
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="112" height="32"></svg>' });
    });
    await pg.goto('https://www.twitch.tv/examplestreamer');
    await pg.evaluate(SCRIPT);
    await pg.waitForTimeout(250);
    return pg;
};

const ecartAuBas = (pg) => pg.evaluate(() => {
    const sc = document.querySelector('#defilement');
    return Math.round(sc.scrollHeight - sc.scrollTop - sc.clientHeight);
});

/** Reproduit l'arrivée d'un message dans un chat collé en bas, comme le fait Twitch. */
const arriveeMessage = async (pg, htmls) => {
    await pg.evaluate((hs) => {
        const sc = document.querySelector('#defilement');
        sc.scrollTop = sc.scrollHeight;      // état « collé en bas »
        const root = document.querySelector('[data-test-selector="chat-scrollable-area__message-container"]');
        for (const h of hs) {
            const holder = document.createElement('div');
            holder.innerHTML = h;
            root.appendChild(holder.firstElementChild);
        }
        sc.scrollTop = sc.scrollHeight;      // Twitch recolle lui-même, avant notre rAF
    }, [].concat(htmls));
    await pg.waitForTimeout(130);
    const apresScript = await ecartAuBas(pg);
    await pg.waitForTimeout(500);
    const apresImages = await ecartAuBas(pg);
    return { apresScript, apresImages };
};

const pageDefilante = await ouvrirPageDefilante(true);
const ordinaire = await arriveeMessage(pageDefilante, LINES.plain);
const longue = await arriveeMessage(pageDefilante, reponse(CITATION_LONGUE));
const emotee = await arriveeMessage(pageDefilante, reponse(CITATION_EMOTES));
const inedite = await arriveeMessage(pageDefilante,
    [messageEmoteInedite, reponse(`@MentionUser01 ${EMOTE_INEDITE} ${EMOTE_INEDITE} fin`)]);

// Le recollage remet le message en vue, mais une citation qui se re-découpe sous les
// yeux au moment où les images arrivent reste désagréable. La place réservée d'avance
// grâce aux proportions mémorisées doit rendre sa hauteur stable dès le premier rendu.
const stabilite = await (async () => {
    await pageDefilante.evaluate((h) => {
        const sc = document.querySelector('#defilement');
        sc.scrollTop = sc.scrollHeight;
        const root = document.querySelector('[data-test-selector="chat-scrollable-area__message-container"]');
        const holder = document.createElement('div');
        holder.innerHTML = h;
        holder.firstElementChild.id = 'stable';
        root.appendChild(holder.firstElementChild);
        sc.scrollTop = sc.scrollHeight;
    }, reponse(CITATION_EMOTES));
    const hauteur = () => pageDefilante.evaluate(() => {
        const q = document.querySelector('#stable .btc-reply-quote');
        return q ? Math.round(q.getBoundingClientRect().height) : null;
    });
    await pageDefilante.waitForTimeout(60);      // avant que le CDN ne réponde
    const avant = await hauteur();
    await pageDefilante.waitForTimeout(600);     // après
    return { avant, apres: await hauteur() };
})();

// Quelqu'un qui a remonté l'historique ne doit jamais être ramené en bas de force.
const remonte = await pageDefilante.evaluate(async (h) => {
    const sc = document.querySelector('#defilement');
    sc.scrollTop = sc.scrollHeight - sc.clientHeight - 200;
    await new Promise(res => setTimeout(res, 80));   // laisse partir l'événement scroll
    const avant = Math.round(sc.scrollTop);
    const root = document.querySelector('[data-test-selector="chat-scrollable-area__message-container"]');
    const holder = document.createElement('div');
    holder.innerHTML = h;
    root.appendChild(holder.firstElementChild);
    await new Promise(res => setTimeout(res, 500));
    return { avant, apres: Math.round(sc.scrollTop) };
}, reponse(CITATION_LONGUE));

const pageSansAncre = await ouvrirPageDefilante(false);
const sansAncre = await arriveeMessage(pageSansAncre, reponse(CITATION_LONGUE));

check('message ordinaire : aucun décalage à compenser', ordinaire.apresScript, (v) => v <= EPSILON);
check('réponse déroulée entièrement visible', longue.apresImages, (v) => v <= EPSILON);
check('réponse chargée d\'emotes entièrement visible', emotee.apresImages, (v) => v <= EPSILON);
check('emote aux proportions inconnues : décalage rattrapé au chargement',
    inedite.apresImages, (v) => v <= EPSILON);
check('citation stable pendant le chargement des emotes', stabilite,
    (v) => v.avant !== null && v.avant === v.apres);
check('chat remonté : la position de lecture est préservée',
    remonte, (v) => v.avant === v.apres);
check('scroller retrouvé sans l\'attribut data-a-target', sansAncre.apresImages, (v) => v <= EPSILON);

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
