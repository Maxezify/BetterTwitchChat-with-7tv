# Outils de diagnostic

## `7tv-dom-recorder.user.js`

7TV a publié une **nouvelle extension** (ID Chrome `lppmekppnliemjclknbagdhoocikieoi`),
distincte de l'ancienne (`ammjkodgmmoknidbanneddgankgfejfh` / dépôt `SevenTV/Extension`).
`BetterTwitchChat.js` était écrit à 100 % contre le DOM de l'**ancienne** extension
(`.seventv-chat-list`, `.seventv-message`, `.seventv-chat-message-background`,
`.seventv-sub-message-container`, `.seventv-user-message.has-highlight`…). Si ces classes
n'existent plus, absolument rien du script ne s'accroche — d'où la casse totale.

Ce recorder sert à capturer la structure DOM **réelle** de ton chat pour reconstruire le
script sur des sélecteurs justes plutôt que devinés.

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
