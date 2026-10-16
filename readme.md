# Seren Alert

An Alt1 toolkit app for RuneScape 3. It reads your chatbox and:

- alerts you (sound + on-screen overlay + 30s countdown) when a Seren spirit appears
- tracks every reward the spirits give you, with totals and estimated GE value (prices from Weird Gloop, refreshed every 15 min)
- counts spawns and spirits you missed

Everything is stored locally in the app. For best results keep the Game chat visible and interface scaling at 100%. Press **Re-find chat** after moving the chatbox or resizing the client.

## Install

In Alt1, open `alt1://addapp/<your GitHub Pages url>/appconfig.json`, or open the page in the Alt1 browser and click the add app link.

## Develop

```sh
npm i
npm run build   # or: npm run watch
```

You can test detection without the game from the browser console, e.g.
`SerenAlert.simulate("[12:00:05] The Seren spirit gifts you: 1 x Crystal key. The gift is sent to your bank.")`
