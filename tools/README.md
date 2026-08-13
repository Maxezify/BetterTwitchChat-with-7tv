# Outils

## `tests/run.mjs` — suite de tests

85 vérifications du rendu de `BetterTwitchChat.js`, exécutées dans Chromium via
Playwright, contre du DOM Twitch **réellement capturé** (`tests/fixtures/lines.json`,
pseudos remplacés par des placeholders).

```bash
node tools/tests/run.mjs
```

Les assertions portent sur le style calculé, pas sur la simple présence de classes :
troncature réellement annulée, police et couleur effectives de la citation, emote
servie par le CDN 7TV, taille de l'illustration « cadeau mystère », épaisseur de la barre
gauche identique avec et sans couleur de grade, calage vertical de la bulle sur la
première ligne, absence de débordement horizontal, idempotence après plusieurs passes,
comportement après navigation SPA, et bon fonctionnement des trois présentations de
citation.

Une seconde page, réellement défilante, vérifie qu'un nouveau message reste entièrement
visible après nos transformations et après le chargement des emotes, que la position de
lecture de quelqu'un qui a remonté l'historique n'est jamais touchée, et que l'élément
qui défile est retrouvé même privé de son attribut `data-a-target`.

Prérequis : Playwright avec Chromium (`npm i -D playwright && npx playwright install
chromium`, ou une installation globale — le script résout les deux).

## `7tv-dom-recorder.user.js` — enregistreur DOM

Sert à capturer la structure DOM **réelle** du chat pour reconstruire le script sur des
sélecteurs vérifiés plutôt que devinés. C'est ce qui a servi à écrire la v15 ; à
ressortir si une future mise à jour de Twitch ou de 7TV casse à nouveau quelque chose.

### Ce que la capture d'août 2026 a établi

7TV a publié une **nouvelle extension** (ID Chrome `lppmekppnliemjclknbagdhoocikieoi`),
distincte de l'ancienne (`ammjkodgmmoknidbanneddgankgfejfh` / dépôt `SevenTV/Extension`).
Elle ne remplace plus le moteur de rendu du chat : elle décore le chat natif de Twitch.

| | Ancienne extension | Nouvelle extension |
|---|---|---|
| Conteneur | `.seventv-chat-list` | `[data-test-selector="chat-scrollable-area__message-container"]` (Twitch natif) |
| Message | `.seventv-message` | `.chat-line__message` (Twitch natif) |
| Notices sub/gift | `.seventv-sub-message-container` | `[data-test-selector="user-notice-line"]` (Twitch natif) |
| Highlight | `.seventv-user-message.has-highlight` | `.seventv-chat-message-custom-highlight` / `-first-highlight` sur la ligne Twitch |
| Emotes | `.seventv-emote` avec `src` | `img[data-emote-name]` avec `srcset` + `data-fallback-image-url`, **sans `src`** |
| Marqueurs | classes `seventv-*` | attributs `data-seventv-*` sur `.chat-line__message` |
| Techno | Vue | Svelte (classes `.svelte-xxxxx`) |

Autres constats utiles :

- Le bloc « réponse » n'a **aucune classe stable**. Twitch place toujours un `<div>` vide
  en premier enfant de `.chat-line__message-container` ; quand le message est une
  réponse, ce div contient l'icône et un `<p title="texte d'origine">`. C'est la seule
  ancre fiable.
- Les classes `Layout-sc-1xcs6mc-0`, `kBZhWz`, `glFavL`… sont des hachages
  styled-components : elles changent à chaque build de Twitch, ne jamais s'en servir.
- `chat-line__reply-icon` est le **bouton de réponse au survol**, présent sur tous les
  messages. Ce n'est pas un indicateur de réponse.
- Les notices Twitch sont rendues dans la langue de l'interface (ici le français). Les
  notices système de 7TV restent en anglais.
- 7TV ne colore pas les modos/VIP par défaut : c'est une règle « Custom Highlights » par
  badge, à configurer dans l'extension. Une fois la règle créée, il pose la couleur en
  variables inline sur `.chat-line__message` :
  `--seventv-chat-custom-highlight-color`, `-border-color`, `-bg`, plus un attribut
  `data-seventv-custom-highlight-label` qui porte le nom de la règle (souvent un emoji).
  7TV affiche cette étiquette en bout de message depuis une feuille de style d'extension
  que la page ne peut pas lire : impossible donc de cibler sa règle. Le script retire
  l'attribut, ce qui la fait disparaître quel que soit le sélecteur employé en face —
  et sans toucher au séparateur que 7TV dessine sur la même ligne.
- Dans une notice, le porte-icône et le bloc de texte vivent dans un même flux en
  ligne : la première ligne démarre après l'icône, les suivantes reviennent sous elle.
  La profondeur du porte-icône varie selon le type de notice (un abonnement l'enveloppe
  d'un div de plus qu'un watch streak), donc les rôles sont étiquetés en JS en remontant
  depuis l'icône jusqu'au premier ancêtre à deux enfants — un sélecteur CSS unique se
  trompait de cible.
- Dans les notices, Twitch enveloppe le pseudo dans des conteneurs rendus en bloc
  (`span > .chatter-name`), ce qui le pousse sur sa propre ligne au-dessus du texte.
  Le bloc texte du gift multiple est en plus une colonne flex. Les deux sont remis en
  ligne, ciblés par leur structure (`span:has(> .chatter-name)`) et non par leurs
  classes hachées.
- Les annonces (`.announcement-line`) enveloppent une `.chat-line__message` ordinaire ;
  elles ne passent pas par `user-notice-line` et ne sont donc pas compactées.
- Sur une réponse, 7TV pose `data-seventv-reply-parent-login` et
  `-display-name` sur la ligne : le login exact de la personne citée, sans avoir à
  analyser le texte de la citation.
- Twitch stylise la citation via une classe styled-components hachée (`.OLUUU` au
  moment où ceci est écrit) qui déclare `font-size: var(--font-size-5)` **en
  `!important`**. Nos règles doivent donc dépasser (0,1,0) en spécificité : à égalité,
  c'est l'ordre du document qui tranche et styled-components injecte ses feuilles après
  la nôtre. D'où les sélecteurs à classe doublée dans le script.
- Le réglage « Chat Font Size » de 7TV n'agit que si la classe
  `seventv-twitch-chat-font-size-enabled` est posée sur `<html>` ; il applique alors
  `font-size: var(--seventv-twitch-chat-font-size)` sur `[data-a-target="chat-line-message"]`,
  donc sur la ligne et non sur la citation. Laissé à sa valeur par défaut, il n'ajoute
  ni la classe ni la variable et n'a aucun effet.
- 7TV trace déjà ses propres séparateurs entre messages
  (`seventv-chat-lines-separator-twitch`) : en ajouter doublait le trait.
- Sa bordure de highlight fait 2 px, et elle s'**additionne** à tout filet posé par-dessus :
  un `box-shadow` interne de 2 px sur une ligne déjà bordée donne 4 px visibles, soit un
  trait deux fois trop épais sur les messages de grade. Le filet doit donc être retiré là
  où 7TV en trace déjà un — et cette présence se **mesure** (`borderLeftWidth` du style
  calculé), elle ne se déduit pas des variables inline : le highlight « premier message »
  (`seventv-chat-message-first-highlight`) dessine sa bordure depuis la feuille de style,
  sans poser aucune variable.
- Le défilement du chat est porté par `.scrollable-area[data-a-target="chat-scroller"]`,
  **au-dessus** du conteneur de messages. Ancre déclarée et non devinée : 7TV stylise
  lui-même la scrollbar de ce sélecteur
  (`.seventv-twitch-chat-scrollbar-hidden .scrollable-area[data-a-target="chat-scroller"]`).
  Le script garde malgré tout un repli structurel — il remonte depuis la racine du chat
  jusqu'au premier ancêtre qui déborde réellement.
- Twitch recolle le chat en bas dans son effet de layout, c'est-à-dire **avant** la frame
  où notre observateur traite le message. Toute transformation qui agrandit la ligne
  (citation déroulée, espaces ajoutés) laisse donc le bas du message sous le pli si l'on
  ne recolle pas soi-même après coup.
- Une image sans dimensions connues naît à zéro de large puis s'élargit d'un coup à son
  chargement, ce qui re-découpe le texte autour. Les emotes reconstruites dans les
  citations portent donc un `aspect-ratio` mémorisé lors de leur passage dans le chat.
  Attention en banc d'essai : les badges Twitch, s'ils ne sont pas dimensionnés par la
  CSS de la fixture, produisent exactement le même décalage et font accuser le script à
  tort.
- Les réglages actifs sont lisibles dans la liste de classes de `<html>`
  (`seventv-chat-message-style-full-width`, `seventv-chat-mention-highlight-enabled`…).
- 7TV applique aux emotes un `style` inline `width/max-width/max-height` en `!important`.
  Un style inline important l'emporte sur une feuille d'auteur : ne pas compter sur du
  CSS pour redimensionner *ses* emotes (celles reconstruites dans les citations portent
  notre propre classe et ne sont pas concernées).

### Utilisation

1. **Désactive `BetterTwitchChat.js`** dans Tampermonkey. Sinon tu enregistres un DOM déjà
   modifié par le script et le résultat est inexploitable.
2. Installe ce fichier dans Tampermonkey (ou colle-le entier dans la console DevTools d'un
   onglet `twitch.tv` — sous Firefox, tape d'abord `allow pasting`).
3. Ouvre une **grosse chaîne bien active** : il faut des subs, des gifts, des raids, des
   messages de modos et de VIP pour que tout soit capturé.
4. Un panneau apparaît en haut à droite avec un compteur par catégorie :
   - gris = rien capturé, orange = partiel, vert = complet (3 échantillons).
5. Laisse tourner **5 à 15 minutes**. Les catégories `gift_mass`, `raid`, `watch_streak`
   sont les plus rares.
6. Clique **« Exporter JSON »** → `btc-dom-dump-<timestamp>.json` est téléchargé.

En console, trois raccourcis sont exposés :

```js
__BTC_STATUS()   // compteurs actuels
__BTC_DUMP()     // export + téléchargement du JSON
__BTC_RESET()    // vide les échantillons
```

### Ce que le dump contient

| Clé | Contenu |
|---|---|
| `environment` | URL, user-agent, sélecteur du conteneur de chat trouvé, présence des classes `seventv-*`, URLs des assets `chrome-extension://`, variables CSS de `:root` |
| `samples` | Par catégorie : `outerHTML`, classes, `dataset`, styles calculés, variables CSS, chaîne d'ancêtres, descendants qui peignent un fond/bordure, et les sous-parties clés (réponse, corps, pseudo, badges, emotes) |
| `classCensus` | Toutes les classes présentes sous le conteneur de chat, triées par fréquence — révèle immédiatement le nouveau schéma de nommage |
| `css` | Les règles CSS lisibles qui mentionnent `seventv`/`chat-line`/`reply`/`highlight`, plus la liste des feuilles inaccessibles (CORS) |

### Vie privée

Rien n'est envoyé sur le réseau : le script n'ouvre aucune connexion, l'export est un
téléchargement local déclenché à la main. Le dump contient des pseudos et des messages de
chat public. Aucun cookie, token, e-mail ni donnée de compte n'est lu.

### Si des feuilles de style sont marquées « inaccessibles »

Le champ `css.inaccessible` liste des URLs `chrome-extension://…/xxx.css` que la page ne
peut pas lire (CORS). Ouvre ces URLs dans un onglet et enregistre le contenu : c'est là que
se trouvent les règles de couleur de grade (modo / VIP / broadcaster) de la nouvelle
extension.
