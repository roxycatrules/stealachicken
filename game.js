/* Steal a Chicken — game simulation (host-authoritative) */
'use strict';

const Game = {
  isHost: false,
  localId: null,
  localName: '',
  localColor: PLAYER_COLORS[0],

  world: null,          // authoritative on host, latest snapshot on client
  order: [],             // join order of player ids

  hostInputs: {},        // host only: id -> {x,y}
  hostStealFlags: {},    // host only: id -> bool
  hostLastSteal: {},     // host only: id -> ts

  inputVec: { x: 0, y: 0 },
  keys: {},

  predicted: { x: 0, y: 0 },
  prevSnap: null,
  lastSnap: null,

  tickHandle: null,
  rafHandle: null,
  tickCount: 0,

  callbacks: {},
  on(ev, fn) { this.callbacks[ev] = fn; },
  _emit(ev, ...a) { if (this.callbacks[ev]) this.callbacks[ev](...a); },

  // ---------------- host lifecycle ----------------

  startAsHost(id, name, color, saved) {
    this.isHost = true;
    this.localId = id;
    this.localName = name;
    this.localColor = color;

    this.world = { players: {} };
    this.order = [];
    this._hostAddPlayer(id, name, color, saved);

    this.hostInputs[id] = { x: 0, y: 0 };
    this.hostStealFlags[id] = false;

    Net.on('client-message', (peerId, msg) => this._hostHandleMessage(peerId, msg));
    Net.on('peer-disconnected', (peerId) => this._hostHandleDisconnect(peerId));

    this._bindInput();
    this.tickHandle = setInterval(() => this._hostTick(), TICK_MS);
    this._startRenderLoop();
  },

  _hostAddPlayer(id, name, color, saved) {
    const plotIndex = this.order.length;
    this.world.players[id] = freshPlayerState(id, name, color, plotIndex, saved);
    this.order.push(id);
    return plotIndex;
  },

  _hostHandleMessage(peerId, msg) {
    if (msg.t === 'join') {
      if (this.order.length >= MAX_PLAYERS) {
        Net.connections[peerId] && Net.connections[peerId].send({ t: 'full' });
        return;
      }
      const saved = {
        coins: msg.coins, slots: msg.slots,
        lastEggSpawn: msg.lastEggSpawn, lastCoinTick: msg.lastCoinTick
      };
      this._hostAddPlayer(peerId, msg.name || 'Farmer', msg.color || PLAYER_COLORS[this.order.length % PLAYER_COLORS.length], saved);
      this.hostInputs[peerId] = { x: 0, y: 0 };
      this.hostStealFlags[peerId] = false;

      const conn = Net.connections[peerId];
      if (conn) conn.send({ t: 'welcome', world: this.world, order: this.order });
      Net.broadcast({ t: 'state', world: this.world, order: this.order, ts: Date.now() });
      this._emit('roster-changed');
    } else if (msg.t === 'input') {
      if (this.hostInputs[peerId]) { this.hostInputs[peerId].x = msg.dx; this.hostInputs[peerId].y = msg.dy; }
    } else if (msg.t === 'steal') {
      this.hostStealFlags[peerId] = true;
    }
  },

  _hostHandleDisconnect(peerId) {
    const p = this.world.players[peerId];
    if (p) p.connected = false;
    delete this.hostInputs[peerId];
    Net.broadcast({ t: 'state', world: this.world, order: this.order, ts: Date.now() });
    this._emit('roster-changed');
  },

  _hostTick() {
    const now = Date.now();
    const dt = TICK_MS / 1000;

    // the host's own keyboard input never comes over the network — sync it
    // into the same input map that drives everyone else's movement.
    if (this.hostInputs[this.localId]) {
      this.hostInputs[this.localId].x = this.inputVec.x;
      this.hostInputs[this.localId].y = this.inputVec.y;
    }

    for (const id of this.order) {
      const p = this.world.players[id];
      if (!p || !p.connected) continue;
      const input = this.hostInputs[id] || { x: 0, y: 0 };
      const len = Math.hypot(input.x, input.y);
      const nx = len > 0 ? input.x / len : 0;
      const ny = len > 0 ? input.y / len : 0;
      p.x = clamp(p.x + nx * MOVE_SPEED * dt, AVATAR_R, WORLD_W - AVATAR_R);
      p.y = clamp(p.y + ny * MOVE_SPEED * dt, AVATAR_R, WORLD_H - AVATAR_R);

      if (this.hostStealFlags[id]) {
        this.hostStealFlags[id] = false;
        this._attemptSteal(id, now);
      }

      if (now - p.lastEggSpawn >= EGG_SPAWN_MS) {
        p.lastEggSpawn = now;
        const empty = p.slots.findIndex(s => s.state === 'empty');
        if (empty !== -1) { p.slots[empty] = { state: 'egg', hatchStart: now }; }
      }

      for (const slot of p.slots) {
        if (slot.state === 'egg' && now - slot.hatchStart >= EGG_HATCH_MS) {
          slot.state = 'chicken';
          slot.hatchStart = 0;
        }
      }

      if (now - p.lastCoinTick >= COIN_TICK_MS) {
        p.lastCoinTick = now;
        const chickens = p.slots.filter(s => s.state === 'chicken').length;
        p.coins += chickens * COIN_PER_CHICKEN;
      }
    }

    this.tickCount++;
    if (this.tickCount % STATE_BROADCAST_EVERY === 0) {
      Net.broadcast({ t: 'state', world: this.world, order: this.order, ts: now });
    }
  },

  _attemptSteal(actorId, now) {
    const last = this.hostLastSteal[actorId] || 0;
    if (now - last < STEAL_COOLDOWN_MS) return;
    const actor = this.world.players[actorId];
    if (!actor) return;

    let best = null, bestDist = Infinity;
    for (const id of this.order) {
      if (id === actorId) continue;
      const owner = this.world.players[id];
      if (!owner) continue;
      owner.slots.forEach((slot, slotIndex) => {
        if (slot.state !== 'chicken') return;
        const pos = slotWorldPos(owner.plotIndex, slotIndex);
        const d = Math.hypot(pos.x - actor.x, pos.y - actor.y);
        if (d <= STEAL_RANGE && d < bestDist) { bestDist = d; best = { owner, slotIndex, pos }; }
      });
    }
    if (!best) return;

    this.hostLastSteal[actorId] = now;
    best.owner.slots[best.slotIndex] = makeEmptySlot();

    const events = [{ x: best.pos.x, y: best.pos.y, text: 'stolen!', color: '#ffb3b3' }];

    const freeSlot = actor.slots.findIndex(s => s.state === 'empty');
    if (freeSlot !== -1) {
      actor.slots[freeSlot] = { state: 'chicken', hatchStart: 0 };
      events.push({ x: actor.x, y: actor.y - 16, text: '+1 chicken', color: '#c8f2c0' });
    } else {
      actor.coins += STEAL_FULL_COOP_BONUS;
      events.push({ x: actor.x, y: actor.y - 16, text: '+' + STEAL_FULL_COOP_BONUS + ' coins (coop full)', color: '#ffe38a' });
    }

    Net.broadcast({ t: 'toast', events });
    this._renderToastEvents(events);
  },

  // ---------------- client lifecycle ----------------

  startAsClient(id, name, color, saved) {
    this.isHost = false;
    this.localId = id;
    this.localName = name;
    this.localColor = color;

    Net.on('host-message', (msg) => this._clientHandleMessage(msg));
    Net.on('host-disconnected', () => this._emit('host-lost'));

    const payload = { t: 'join', name, color };
    if (saved && typeof saved === 'object') {
      payload.coins = saved.coins;
      payload.slots = saved.slots;
      payload.lastEggSpawn = saved.lastEggSpawn;
      payload.lastCoinTick = saved.lastCoinTick;
    }
    Net.sendToHost(payload);
  },

  _clientHandleMessage(msg) {
    if (msg.t === 'welcome') {
      this.world = msg.world;
      this.order = msg.order;
      const me = this.world.players[this.localId];
      if (me) { this.predicted.x = me.x; this.predicted.y = me.y; }
      this._bindInput();
      this._startInputSender();
      this._startRenderLoop();
      this._emit('joined');
    } else if (msg.t === 'state') {
      this.prevSnap = this.lastSnap;
      this.lastSnap = { world: msg.world, order: msg.order, ts: msg.ts, recvTs: Date.now() };
      this.world = msg.world;
      this.order = msg.order;
      this._emit('roster-changed');
    } else if (msg.t === 'toast') {
      this._renderToastEvents(msg.events);
    } else if (msg.t === 'full') {
      this._emit('room-full');
    }
  },

  _startInputSender() {
    setInterval(() => {
      if (!this.isHost) Net.sendToHost({ t: 'input', dx: this.inputVec.x, dy: this.inputVec.y });
    }, INPUT_SEND_MS);
  },

  // ---------------- shared input ----------------

  _bindInput() {
    if (this._inputBound) return;
    this._inputBound = true;
    document.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(k)) e.preventDefault();
      if (this.keys[k]) { if (k === 'e') return; }
      this.keys[k] = true;
      this._recomputeInputVec();
      if (k === 'e') this._handleStealKey();
    });
    document.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      this.keys[k] = false;
      this._recomputeInputVec();
    });
  },

  _recomputeInputVec() {
    let x = 0, y = 0;
    if (this.keys['arrowleft'] || this.keys['a']) x -= 1;
    if (this.keys['arrowright'] || this.keys['d']) x += 1;
    if (this.keys['arrowup'] || this.keys['w']) y -= 1;
    if (this.keys['arrowdown'] || this.keys['s']) y += 1;
    this.inputVec.x = x; this.inputVec.y = y;
  },

  _handleStealKey() {
    if (this.isHost) {
      this._attemptSteal(this.localId, Date.now());
    } else {
      Net.sendToHost({ t: 'steal' });
    }
  },

  // ---------------- render loop ----------------

  _startRenderLoop() {
    if (this.rafHandle) return;
    let lastT = performance.now();
    const loop = (t) => {
      const dt = Math.min(0.05, (t - lastT) / 1000);
      lastT = t;
      this._frame(dt);
      this.rafHandle = requestAnimationFrame(loop);
    };
    this.rafHandle = requestAnimationFrame(loop);
  },

  stopLoops() {
    if (this.tickHandle) clearInterval(this.tickHandle);
    if (this.rafHandle) cancelAnimationFrame(this.rafHandle);
    this.tickHandle = null; this.rafHandle = null;
  },

  _frame(dt) {
    const now = Date.now();
    if (!this.world) return;

    if (!this.isHost) {
      const len = Math.hypot(this.inputVec.x, this.inputVec.y);
      if (len > 0) {
        this.predicted.x = clamp(this.predicted.x + (this.inputVec.x / len) * MOVE_SPEED * dt, AVATAR_R, WORLD_W - AVATAR_R);
        this.predicted.y = clamp(this.predicted.y + (this.inputVec.y / len) * MOVE_SPEED * dt, AVATAR_R, WORLD_H - AVATAR_R);
      }
      const me = this.world.players[this.localId];
      if (me) {
        this.predicted.x += (me.x - this.predicted.x) * 0.18;
        this.predicted.y += (me.y - this.predicted.y) * 0.18;
      }
    }

    // ---- update plots ----
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const id = this.order[i];
      const p = id ? this.world.players[id] : null;
      Render.updatePlot(i, p, id === this.localId, now);
    }

    // ---- update avatars ----
    const seen = new Set();
    for (const id of this.order) {
      const p = this.world.players[id];
      if (!p || !p.connected) continue;
      seen.add(id);
      Render.ensureAvatar(id, p.name, p.color, id === this.localId);

      let x = p.x, y = p.y;
      if (id === this.localId && !this.isHost) { x = this.predicted.x; y = this.predicted.y; }
      else if (!this.isHost && this.prevSnap && this.prevSnap.world.players[id]) {
        const interval = STATE_BROADCAST_EVERY * TICK_MS;
        const t = clamp((now - this.lastSnap.recvTs + interval) / interval, 0, 1);
        const prevP = this.prevSnap.world.players[id];
        x = prevP.x + (p.x - prevP.x) * t;
        y = prevP.y + (p.y - prevP.y) * t;
      }
      Render.positionAvatar(id, x, y);
    }
    for (const id of Object.keys(Render.playerEls)) {
      if (!seen.has(id)) Render.removeAvatar(id);
    }

    // ---- HUD ----
    const me = this.world.players[this.localId];
    if (me) {
      const coinEl = document.getElementById('coin-count');
      const chickEl = document.getElementById('chicken-count');
      if (coinEl) coinEl.textContent = me.coins;
      if (chickEl) chickEl.textContent = me.slots.filter(s => s.state === 'chicken').length;
    }
  },

  _renderToastEvents(events) {
    events.forEach(ev => Render.toast(ev.x, ev.y, ev.text, ev.color));
  },

  getLocalProgress() {
    if (!this.world || !this.localId) return null;
    const p = this.world.players[this.localId];
    if (!p) return null;
    return {
      coins: p.coins,
      slots: p.slots.map(s => ({ state: s.state, hatchStart: s.hatchStart })),
      lastEggSpawn: p.lastEggSpawn,
      lastCoinTick: p.lastCoinTick
    };
  },

  teardown() {
    this.stopLoops();
    this.world = null;
    this.order = [];
    this.hostInputs = {};
    this.hostStealFlags = {};
    this.hostLastSteal = {};
    this.keys = {};
    this.inputVec = { x: 0, y: 0 };
    this.prevSnap = null;
    this.lastSnap = null;
  }
};