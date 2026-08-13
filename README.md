# BetterTwitchChat (+ 7TV)

Userscript Tampermonkey qui rend le chat de Twitch plus lisible, compatible avec la
**nouvelle extension 7TV**.

## Ce que fait la v15

| | |
|---|---|
| **Réponses mises en valeur** | Le message qui répond à quelqu'un reçoit un fond légèrement plus clair. La citation fait corps avec le message, sans cadre détaché. |
| **Citation lisible en entier** | Twitch tronque la citation à une seule ligne avec des points de suspension. Elle est désormais affichée intégralement. |
| **Citation discrète** | Police à 78 % du texte du chat, gris uni, pseudos soulignés, bulle calée sur la première ligne. Le « @pseudo » cité peut reprendre sa couleur de chat (`reply.colorQuotedName`), désactivé par défaut car trop voyant. |
| **Emotes dans les citations** | Twitch ne met que du texte brut dans la citation. Le script indexe les emotes (7TV et Twitch) qui passent dans le chat et les réaffiche dans les réponses. |
| **Notices compactées** | Subs, Primes, resubs, gifts et raids passent en police réduite avec des marges serrées. Le pseudo, que Twitch place sur sa propre ligne, rejoint le texte pour tenir en un seul paragraphe. L'illustration « cadeau mystère » de 96 px devient une vignette de 26 px. |
| **Gifts multiples regroupés** | « X offre 50 abonnements » absorbe les « X a offert un abonnement à Y » qui suivent et affiche la liste des destinataires sur une seule notice. |
| **Couleurs de grade 7TV** | Si 7TV colore un message (highlight par badge modo/VIP, first-time chatter, règle personnalisée), sa barre de couleur est laissée telle quelle : le script n'en superpose pas une seconde, qui doublerait l'épaisseur du trait. |

## Installation

1. Installer [Tampermonkey](https://www.tampermonkey.net/).
2. Créer un nouveau script et y coller le contenu de [`BetterTwitchChat.js`](BetterTwitchChat.js).
3. Recharger Twitch.

Les mises à jour suivantes sont automatiques : l'en-tête déclare `@updateURL` et
`@downloadURL`, Tampermonkey vérifie périodiquement et propose la nouvelle version.

> Les deux URLs pointent sur la branche `claude/twitch-chat-7tv-userscript-1hh5y8`,
> seule à porter la v15 — `main` en est encore à la v14. **Si cette branche est
> fusionnée dans `main`, remplacer le segment de branche par `main` dans les deux URLs**,
> sinon la mise à jour automatique cassera le jour où la branche disparaîtra.

## Réglages

Tout est regroupé dans le bloc `CONFIG` en haut du fichier :

```js
reply.style           // 'rail' | 'inline' | 'card' — voir ci-dessous
reply.lineTint        // fond du message qui répond
reply.blockTint       // fond du bloc de citation (style 'card' uniquement)
reply.color           // couleur du texte cité
reply.fontScale       // taille de la citation (0.78 = 78 % du texte normal)
reply.lineHeight      // interligne de la citation, sert aussi à caler la bulle
reply.gap             // espace au-dessus et en dessous de la citation
reply.hidePrefix      // retire « Répond à », garde « @pseudo : texte »
reply.showIcon        // garde la bulle SVG à gauche de la citation
reply.renderEmotes    // reconstruit les emotes dans la citation
reply.underlineNames  // souligne les pseudos cités
reply.colorQuotedName // recolore le « @pseudo » cité (désactivé par défaut)

compact.enabled        // compactage des notices sub/prime/gift
compact.textIndent     // espace entre la barre de couleur et le contenu
compact.aggregateGifts // regroupement des gifts multiples
compact.giftWindowMs   // délai d'attente des gifts individuels

separators   // trait de séparation entre les messages (désactivé : 7TV en pose un)
translate    // traduit les notices restées en anglais
debug        // journalise les détections dans la console
```

Depuis la console du navigateur, `window.__BTC` expose `config`, `reload()`,
`emotes` et `gifts` pour ajuster en direct. Par exemple, pour essayer une autre
présentation de citation sans recharger :

```js
__BTC.config.reply.style = 'inline'; __BTC.reload();
```

### Diagnostic

```js
__BTC.check()        // version en place, style actif, tailles calculées
__BTC.selfCheck()    // état de chaque point d'accroche dans le DOM
__BTC.whyFontSize()  // toutes les règles CSS qui visent la citation, dans l'ordre
                     // de la cascade — pour savoir qui impose une taille
```

Un auto-diagnostic se lance seul 20 secondes après le démarrage. Si un point
d'accroche ne correspond plus au DOM, il écrit un avertissement en console nommant
l'ancre fautive et renvoyant vers l'enregistreur. La v14 était morte en silence faute
d'un tel contrôle.

Il distingue deux cas. Pour les ancres structurelles (conteneur du chat, ligne,
pseudo…), l'absence suffit à conclure. Pour la citation, non : un chat sans réponse
n'est pas un chat cassé. Le signal retenu est donc positif — Twitch annonce une réponse
dans l'`aria-label` de la ligne, et nous n'avons pas su y trouver la citation.

### Présentation de la citation (`reply.style`)

| Valeur | Rendu |
|---|---|
| `rail` *(défaut retenu)* | La citation fait corps avec le message : aucun cadre, aucun fond propre. Un filet vertical de 2 px — la même épaisseur que celui de 7TV — court le long de l'ensemble, en gris neutre, donc toutes les réponses sont marquées. Là où 7TV trace déjà sa barre de grade (modo, VIP, premier message), le filet s'efface au lieu de s'y ajouter : la barre garde la même épaisseur partout. |
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

Le script ne code en dur aucune couleur de grade et n'en repeint aucune. Une fois la
règle créée, 7TV trace lui-même une bordure de 2 px sur la ligne : le script la mesure
et retire son propre filet, sinon les deux s'additionneraient et le trait paraîtrait
deux fois trop épais. C'est bien la mesure du style calculé qui décide, pas la lecture
des variables `--seventv-chat-custom-highlight-*` — le highlight « premier message »
dessine sa bordure sans en poser aucune. Les variables ne servent qu'à teinter le filet
dans les cas résiduels où 7TV colore sans border.

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
- [`tools/tests/run.mjs`](tools/tests/run.mjs) — 75 vérifications du script contre du
  DOM Twitch réellement capturé, exécutées dans Chromium.

Voir [`tools/README.md`](tools/README.md).
