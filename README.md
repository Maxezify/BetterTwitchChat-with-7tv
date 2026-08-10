# BetterTwitchChat (+ 7TV)

Userscript Tampermonkey qui rend le chat de Twitch plus lisible, compatible avec la
**nouvelle extension 7TV**.

## Ce que fait la v15

| | |
|---|---|
| **Réponses mises en valeur** | Le message qui répond à quelqu'un reçoit un fond légèrement plus clair. La citation fait corps avec le message, sans cadre détaché. |
| **Citation lisible en entier** | Twitch tronque la citation à une seule ligne avec des points de suspension. Elle est désormais affichée intégralement. |
| **Citation discrète** | Police à 78 % du texte du chat, gris uni, bulle calée sur la première ligne. Le « @pseudo » cité peut reprendre sa couleur de chat (`reply.colorQuotedName`), désactivé par défaut car trop voyant. |
| **Emotes dans les citations** | Twitch ne met que du texte brut dans la citation. Le script indexe les emotes (7TV et Twitch) qui passent dans le chat et les réaffiche dans les réponses. |
| **Notices compactées** | Subs, Primes, resubs, gifts et raids passent en police réduite avec des marges serrées. L'illustration « cadeau mystère » de 96 px devient une vignette de 26 px. |
| **Gifts multiples regroupés** | « X offre 50 abonnements » absorbe les « X a offert un abonnement à Y » qui suivent et affiche la liste des destinataires sur une seule notice. |
| **Couleurs de grade 7TV** | Si 7TV colore un message (highlight par badge modo/VIP, first-time chatter, règle personnalisée), la citation reprend cette couleur sur sa barre latérale. |

## Installation

1. Installer [Tampermonkey](https://www.tampermonkey.net/).
2. Créer un nouveau script et y coller le contenu de [`BetterTwitchChat.js`](BetterTwitchChat.js).
3. Recharger Twitch.

## Réglages

Tout est regroupé dans le bloc `CONFIG` en haut du fichier :

```js
reply.style           // 'rail' | 'inline' | 'card' — voir ci-dessous
reply.lineTint        // fond du message qui répond
reply.blockTint       // fond du bloc de citation (style 'card' uniquement)
reply.color           // couleur du texte cité
reply.fontScale       // taille de la citation (0.78 = 78 % du texte normal)
reply.lineHeight      // interligne de la citation, sert aussi à caler la bulle
reply.hidePrefix      // retire « Répond à », garde « @pseudo : texte »
reply.showIcon        // garde la bulle SVG à gauche de la citation
reply.renderEmotes    // reconstruit les emotes dans la citation
reply.colorQuotedName // recolore le « @pseudo » cité (désactivé par défaut)

compact.enabled        // compactage des notices sub/prime/gift
compact.aggregateGifts // regroupement des gifts multiples
compact.giftWindowMs   // délai d'attente des gifts individuels

separators   // trait de séparation entre les messages
translate    // traduit les notices restées en anglais
debug        // journalise les détections dans la console
```

Depuis la console du navigateur, `window.__BTC` expose `config`, `reload()`,
`emotes` et `gifts` pour ajuster en direct. Par exemple, pour essayer une autre
présentation de citation sans recharger :

```js
__BTC.config.reply.style = 'inline'; __BTC.reload();
```

### Présentation de la citation (`reply.style`)

| Valeur | Rendu |
|---|---|
| `rail` *(défaut retenu)* | La citation fait corps avec le message : aucun cadre, aucun fond propre. Un filet vertical de 4 px court le long de l'ensemble, dans la couleur de grade 7TV quand il y en a une, en gris neutre sinon — donc toutes les réponses sont marquées. |
| `inline` | Identique, mais sans filet neutre : seule la couleur posée par 7TV apparaît. Les réponses de gens sans grade ne se distinguent que par leur fond éclairci. Équivaut à `rail` avec `accentFallback: 'transparent'`. |
| `card` | La citation est un bloc détaché avec son propre fond et sa bordure. |

Si le filet gris te paraît trop marqué à l'usage, `reply.accentFallback` le règle sans
changer de style : `'transparent'` le supprime sur les réponses non colorées,
`'hsla(0, 0%, 100%, 0.25)'` l'atténue.

## Note sur les couleurs de grade

7TV ne colore pas les messages des modérateurs et des VIP par défaut. C'est une
fonctionnalité à activer dans les réglages de l'extension : **Custom Highlights**, puis
une règle par badge (Modérateur, VIP…). Sans règle configurée, la barre latérale de la
citation garde la couleur neutre par défaut (`reply.accentFallback`).

Le script ne code en dur aucune couleur de grade. Une fois la règle créée, 7TV pose la
couleur en variables inline sur la ligne
(`--seventv-chat-custom-highlight-border-color`, `-color`, `-bg`) : le script lit ces
variables en priorité, et retombe sur le style calculé si elles sont absentes. N'importe
quelle couleur choisie dans 7TV est donc reprise automatiquement, et le mécanisme
survit à un changement de sa façon de peindre.

## Pourquoi une réécriture complète

La v14 ciblait le DOM de l'**ancienne** extension 7TV, qui remplaçait entièrement le
moteur de rendu du chat (`.seventv-chat-list`, `.seventv-message`,
`.seventv-sub-message-container`…). La nouvelle extension
(ID Chrome `lppmekppnliemjclknbagdhoocikieoi`) ne fait plus ça : elle décore le chat
natif de Twitch. Aucun de ces sélecteurs n'existe plus, donc le script ne s'accrochait
plus à rien.

La v15 cible le DOM Twitch natif et lit les marqueurs 7TV là où ils existent. Elle
n'utilise jamais les classes en `Layout-sc-…` / `kBZhWz`, qui sont des hachages
styled-components changeant à chaque build de Twitch.

## Outils

- [`tools/7tv-dom-recorder.user.js`](tools/7tv-dom-recorder.user.js) — capture la
  structure réelle du chat pour diagnostiquer une future casse.
- [`tools/tests/run.mjs`](tools/tests/run.mjs) — 39 vérifications du script contre du
  DOM Twitch réellement capturé, exécutées dans Chromium.

Voir [`tools/README.md`](tools/README.md).
