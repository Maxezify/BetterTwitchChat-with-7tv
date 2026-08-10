# BetterTwitchChat (+ 7TV)

Userscript Tampermonkey qui rend le chat de Twitch plus lisible, compatible avec la
**nouvelle extension 7TV**.

## Ce que fait la v15

| | |
|---|---|
| **Réponses mises en valeur** | Le message qui répond à quelqu'un reçoit un fond légèrement plus clair, et la citation est encadrée dans un bloc à part. |
| **Citation lisible en entier** | Twitch tronque la citation à une seule ligne avec des points de suspension. Elle est désormais affichée intégralement, en police un peu plus petite et en gris. |
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
reply.lineTint      // fond du message qui répond
reply.blockTint     // fond du bloc de citation
reply.color         // couleur du texte cité
reply.fontScale     // taille de la citation (0.92 = 92 % du texte normal)
reply.hidePrefix    // retire « Répond à », garde « @pseudo : texte »
reply.showIcon      // garde la bulle SVG à gauche de la citation
reply.renderEmotes  // reconstruit les emotes dans la citation

compact.enabled        // compactage des notices sub/prime/gift
compact.aggregateGifts // regroupement des gifts multiples
compact.giftWindowMs   // délai d'attente des gifts individuels

separators   // trait de séparation entre les messages
translate    // traduit les notices restées en anglais
debug        // journalise les détections dans la console
```

Depuis la console du navigateur, `window.__BTC` expose `config`, `reload()`,
`emotes` et `gifts` pour ajuster en direct.

## Note sur les couleurs de grade

7TV ne colore pas les messages des modérateurs et des VIP par défaut. C'est une
fonctionnalité à activer dans les réglages de l'extension : **Custom Highlights**, puis
une règle par badge (Modérateur, VIP…). Sans règle configurée, la barre latérale de la
citation garde la couleur neutre par défaut (`reply.accentFallback`).

Le script ne code en dur aucune couleur de grade : il lit le style réellement calculé
sur la ligne de message. N'importe quelle couleur choisie dans 7TV est donc reprise
automatiquement, et le mécanisme survit aux changements internes de l'extension.

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
- [`tools/tests/run.mjs`](tools/tests/run.mjs) — 28 vérifications du script contre du
  DOM Twitch réellement capturé, exécutées dans Chromium.

Voir [`tools/README.md`](tools/README.md).
