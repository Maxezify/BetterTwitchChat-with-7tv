# Outils

## `tests/run.mjs` — suite de tests

131 vérifications du rendu de `BetterTwitchChat.js`, exécutées dans Chromium via
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
- La notice « série de visionnage » est la plus découpée de toutes : le pseudo et les
  points de chaîne vivent dans une **rangée séparée**, au-dessus du texte, et cette
  rangée contient elle-même des `<p>` (le « + », l'icône, le nombre). Cinq lignes pour
  une seule notice. Énumérer ces structures ne tient pas dans le temps : tout ce qui vit
  dans le bloc de texte d'une notice est remis en ligne, avec deux exceptions déclarées
  (le message personnalisé d'un resub, l'illustration du gift multiple).
- Deux pièges viennent avec cette mise en ligne. D'abord, Twitch séparait ces fragments
  par des sauts de bloc et **non par des espaces** : mis bout à bout ils se recollent
  (« 450Série de visionnage atteinte ! »). Ensuite, une boîte rendue en ligne **ignore
  `width` et `height`** : l'icône de points de chaîne, que Twitch dimensionnait par son
  conteneur, repart à sa taille naturelle et fait enfler la ligne. Il faut donc restituer
  les espaces et borner les images soi-même.
- Le texte français de Twitch pour cette notice comporte une **espace manquante** :
  « sur une série de 140visionnages ». C'est sa chaîne, pas notre rendu — le script la
  répare dans la passe de traduction.
- Le message joint à une annonce est une **ligne de chat complète imbriquée** dans la
  notice, avec son remplissage de `5px 20px`. Il vit **hors** du bloc de texte étiqueté :
  les règles visant `.btc-notice-text` ne l'atteignent pas. Surtout, l'enveloppe qui le
  porte **change de `data-a-target` selon le type d'annonce** : un abonnement expose
  `chat-resubscription-message__custom-message`, une série de visionnage non. S'accrocher
  à cet attribut laissait donc la moitié des messages sans mise en forme — badges décalés
  de 8 px par le bouton de Twitch. L'ancre stable est la ligne de chat imbriquée
  elle-même.
- Deux pièges de taille de police dans ce sous-arbre. Twitch enveloppe pseudo et badges
  dans un `<button>`, et la feuille par défaut du navigateur y impose **13.33 px sans
  héritage** : tout ce qui s'exprime en `em` à l'intérieur se résout sur cette taille-là
  et non sur celle de la notice. Il faut rétablir `font-size: inherit` sur le sous-arbre
  avant de dimensionner quoi que ce soit en `em`. Et dans une déclaration `font-size`,
  `1em` désigne la taille **du parent** : réappliquer `calc(1em * 0.78)` à l'intérieur
  d'une notice déjà réduite la réduit une seconde fois (10.92 px → 8.52 px, mesuré).
- La notice de **gift multiple n'a pas d'icône SVG**. Comme le bloc de texte n'est
  étiqueté qu'en remontant depuis `.tw-svg`, elle n'en reçoit aucun : toute règle visant
  `.btc-notice-text` la manque, et elle restait seule en blanc. Les règles de couleur
  visent donc la ligne de notice entière.
- Twitch déclare la taille de police **sur chaque fragment de texte** d'une notice, via
  ses composants `CoreText` hachés et en `!important` — exactement le rapport de force
  déjà rencontré sur la citation avec `.OLUUU`. Poser la taille sur la ligne de notice ne
  suffit donc pas : elle est réécrite fragment par fragment. Il faut un sélecteur de type
  (`.btc-notice-line.btc-notice-line p`, soit (0,2,1)) pour passer devant, et **hériter**
  au lieu de recalculer. Attention en banc d'essai : une règle concurrente déclarée en
  tête de document nous laisse gagner à spécificité égale — c'est l'injection **tardive**
  de styled-components qui fait perdre, et elle seule rend le test probant.
- La barre latérale d'une notice porte la **couleur d'accent de la chaîne**, posée par
  Twitch en style **inline** : `background: rgb(250, 41, 41)` dans la capture, là où le
  violet Twitch par défaut est `#9147ff`. C'est la seule source de cette couleur dans le
  DOM du chat — aucune variable `:root` ne l'expose. Mais toutes les notices n'en portent
  pas : une **série de visionnage** déclare `var(--color-border-quote)`, un gris de thème
  (`#adadb8`). Pour teindre celles-là de la même couleur, il faut mémoriser la dernière
  couleur non neutre rencontrée — et reteindre après coup celles arrivées avant elle,
  rien ne garantissant qu'un abonnement précède une série de visionnage.
- En banc d'essai, les **variables de thème de Twitch doivent être définies** : sans
  `--color-border-quote`, la barre d'une série de visionnage a une couleur invalide, donc
  transparente, et la fixture ne représente plus ce qui s'affiche.
- Le message joint à un abonnement vit **hors de la rangée icône + texte**. Un retrait
  recopié sur ce message le rattrape, mais laisse deux défauts : la rangée s'arrête au
  texte, donc une icône centrée dessus se retrouve trop haut dès qu'un message suit, et
  le bord gauche dépend de deux valeurs à tenir synchronisées. L'icône est donc **sortie
  du flux** (`position: absolute`, centrée sur la notice) et sa place réservée par un
  remplissage sur la ligne de notice : tout le contenu s'aligne alors sur un seul bord.
  Le remplissage est conditionné à la présence d'une icône (`:has(.btc-notice-icon)`) —
  un gift multiple n'en a pas et son texte serait décalé dans le vide.
- Twitch enveloppe pseudo et badges dans un `<button>` **dont il ne réinitialise pas la
  boîte** : la feuille par défaut du navigateur y laisse `padding: 1px 6px` et
  `border: 2px`, soit **8 px** qui décalent les badges vers la droite. Un alignement
  mesuré sur les boîtes conteneurs ne le voit pas — il faut mesurer le bord du badge
  lui-même.
- Twitch **n'applique pas la couleur de chat au pseudo d'une notice** : il sort dans la
  couleur du texte. Une fois la notice grisée, il s'y noie. Le script la retrouve dans
  l'index alimenté par les messages, et met le pseudo en attente quand la personne n'a
  pas encore parlé — cas courant pour une série de visionnage, qui récompense le fait de
  regarder. Seul le message joint à un abonnement porte la couleur en style inline : là,
  elle est lue directement.
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
- La règle qui peint un message relevé par une règle « Custom Highlights », relevée dans
  la feuille injectée par l'extension :

  ```css
  :is([data-a-target="chat-line-message"], .room-message,
      .seventv-ffz-compat-active .chat-line__message).seventv-chat-message-custom-highlight:not(.chat-line--inline):not(.seventv-chat-message-mention-highlight):not(…7 autres :not…) {
      background-color: var(--seventv-chat-custom-highlight-bg);
      padding-top: 1.3rem;
      padding-bottom: 0.75rem;
      border-inline-start: .25rem solid var(--seventv-chat-custom-highlight-border-color, var(--seventv-chat-custom-highlight-color));
      border-inline-end:   .25rem solid var(--seventv-chat-custom-highlight-border-color, var(--seventv-chat-custom-highlight-color));
  }
  ```

  Quatre choses à en retenir. Sa spécificité est de **(0,10,0)** — un `:is()` plus huit
  `:not()` — mais elle n'est **pas** `!important` : une déclaration `!important` de notre
  côté l'emporte sans avoir à rivaliser de sélecteur, et c'est ce qui permet de ramener
  le `padding-top` au niveau du bas. Le `1.3rem` du haut n'a rien d'esthétique : il loge
  l'étiquette de règle. La bordure est déclarée en **`.25rem`**, pas en pixels — sa valeur
  en pixels dépend donc de la taille de police racine, ne jamais la coder en dur. Et elle
  est posée des **deux côtés**, `inline-start` comme `inline-end`.
- Cette bordure s'**additionne** à tout filet posé par-dessus : un `box-shadow` interne
  sur une ligne déjà bordée donne un trait d'apparence double sur les messages de grade.
  Le filet doit donc être retiré là où 7TV en trace déjà un — et cette présence se
  **mesure** (`borderLeftWidth` du style calculé), elle ne se déduit pas des variables
  inline : le highlight « premier message » (`seventv-chat-message-first-highlight`)
  dessine sa bordure depuis la feuille de style, sans poser aucune variable.
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
  tort. Autre piège de banc d'essai : une image dont le chargement échoue et dont l'`alt`
  est vide n'est **pas rendue du tout** par Chrome — sa boîte vaut 0 quelle que soit la
  hauteur imposée. Mesurer la taille d'une image exige donc de la servir pour de bon
  (`withInlineImage`, qui retire aussi le `srcset` — il l'emporte sur `src`).
- Chrome **ancre le défilement** : quand du contenu apparaît, il déplace `scrollTop` de
  lui-même pour garder le même point de lecture. Sur un chat qui révèle ses messages un
  par un, ce mouvement émet un événement `scroll` indiscernable d'un geste humain — et il
  interrompait le glissement dès la première ligne relâchée. `overflow-anchor: none` sur
  l'élément qui défile est la parade. Symptôme caractéristique : chaque fonction marche
  seule, la combinaison des deux échoue.
- Un garde-fou qui compare la position **écrite** à celle relue se fait piéger : le
  navigateur borne et arrondit à sa façon. Il faut relire `scrollTop` après écriture et
  comparer à cette valeur-là.
- 7TV n'expose **aucune classe** sur `<html>` pour « Message Batching » et « Smooth
  scroll chat » : impossible de savoir depuis la page s'ils sont actifs. Deux
  implémentations concurrentes du même défilement ne peuvent donc pas se détecter.
- Une valeur **fractionnaire écrite dans `scrollTop` n'est pas appliquée** : le navigateur
  la rejette. Une animation dont le pas décroît — c'est le cas de toute approche
  exponentielle — finit donc par demander moins d'un pixel et se **fige à quelques
  pixels du but**, en tournant à vide. Mesuré : blocage net à 11 px. Il faut un plancher
  d'un pixel par image.
- `setInterval` à intervalle fixe produit des à-coups visibles : dès qu'un pas tombe à
  côté d'un rafraîchissement, l'image est perdue. `requestAnimationFrame` avec un pas
  proportionnel au temps écoulé donne le même rendu à 60 comme à 144 Hz.
- Planifier une image **depuis l'intérieur** d'un rappel d'animation en fait naître deux
  par image : le rappel se replanifie déjà seul à la fin de son pas. Symptôme mesurable
  uniquement en comptant les demandes, pas à l'œil — d'où le compteur dans la suite.
- Un affichage étalé qui **renonce** au-delà d'un certain retard trahit sa raison d'être :
  sur un chat rapide, la moitié des messages surgit alors sans transition. Il faut
  accélérer — relâcher plusieurs lignes par image, en visant à résorber le retard en un
  temps fixe — et non abandonner.
- 7TV impose `width`/`max-width`/`max-height` en style inline important sur ses emotes,
  mais **pas `vertical-align`** : l'alignement reste accessible depuis une feuille
  d'auteur. Mais il faut viser la bonne boîte : chaque emote est **enveloppée** dans
  `span.seventv-emote-anchor > span.seventv-emote-container` (et, pour une emote native,
  `.chat-line__message--emote-button > … > .chat-image__container`). C'est l'enveloppe la
  plus externe qui est alignée sur la ligne — aligner l'image à l'intérieur ne déplace
  rien à l'écran, alors même que son style calculé confirme la consigne. Une vérification
  portant sur ce style est donc vraie et sans rapport avec le rendu.
- Mesurer un alignement demande deux précautions. Le repère de ligne de base doit être un
  **élément remplacé** — le bas d'une image alignée sur la ligne de base y repose par
  définition ; une boîte vide en `inline-block` se retrouve hors flux et donne des écarts
  qui ne mesurent rien (relevé : repère à y=0). Et l'emote mesurée doit **réellement se
  charger** : sinon Chrome rend son texte alternatif, dont la boîte ne suit pas les règles
  d'un élément remplacé. En cas de doute, une capture d'écran tranche plus vite qu'un
  raisonnement sur les lignes de base.
- Un suiveur à constante de temps fixe **traîne proportionnellement au débit** : en
  régime établi, son retard vaut vitesse × constante. Sur un chat nourri, le bas n'est
  donc jamais rejoint — mesuré à 2355 px de retard sur une fenêtre de 300 px. Il faut
  mesurer la croissance du contenu et resserrer la constante juste assez pour borner ce
  retard ; le glissement accélère alors avec la cadence sans jamais redevenir un saut.
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
