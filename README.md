# Steal a Chicken

A tiny multiplayer farm-raiding game that runs entirely inside a Chrome
extension popup. Hatch eggs into chickens, then sneak into other players'
coops and steal the ones that have already hatched — eggs themselves can
never be taken.

## Install (load unpacked)

1. Unzip this folder somewhere permanent (don't delete it after installing —
   Chrome loads the extension straight from these files).
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the `steal-a-chicken` folder.
5. Pin the chicken icon to your toolbar and click it to open the game.

## How to play

- One player clicks **Host a room** — you'll get a 5-character room code.
- Everyone else clicks **Join**, types that code, and connects directly to
  the host over WebRTC (peer-to-peer — the host's machine runs the game
  simulation, everyone else just sends input).
- **WASD / arrow keys** to walk around the shared field.
- Every player has their own coop (4 slots) in a corner of the map. Empty
  slots occasionally fill with an **egg**. Eggs slowly crack and **hatch**
  into a chicken on their own — you can't speed this up, and eggs can't be
  stolen by anyone.
- Walk up to another player's **hatched** chicken and press **E** to steal
  it. It moves straight into an empty slot in your own coop. If your coop
  is already full, you get a coin bonus instead.
- Coins tick up passively for every chicken you own — bragging rights only,
  for now.

## Notes on how the networking works

Room codes are just short human-friendly names for a WebRTC peer ID. The
extension uses PeerJS's free public broker (`peerjs.com`) only to help two
browsers find each other and agree on a direct connection — once connected,
all game traffic (movement, steals, coop state) flows peer-to-peer, not
through any server of ours. No accounts, no backend, nothing stored outside
your own browser.

Because it's a genuine browser-extension **popup**, the game (and your
connection) pauses if the popup loses focus or is closed, exactly like any
other extension popup — reopen it and rejoin with the same room code to
continue.

## Files

```
manifest.json         Chrome MV3 manifest
popup.html / css       Popup UI shell
js/state.js             Shared constants + world/plot layout
js/render.js            All visuals — pure SVG, hand-drawn, no images/emoji
js/net.js               WebRTC/PeerJS room-code networking
js/game.js               Host-authoritative simulation + client prediction
js/app.js                Lobby wiring, screen switching, saved name/color
js/peerjs.min.js        Vendored PeerJS (WebRTC wrapper) — MIT licensed
icons/                  Generated toolbar icons
```
