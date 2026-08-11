/* Steal a Chicken — shared constants & layout */
'use strict';

const WORLD_W = 640;
const WORLD_H = 420;
const AVATAR_R = 9;
const MOVE_SPEED = 148; // px / second
const MAX_PLAYERS = 6;

const SLOTS_PER_PLOT = 4;
const PLOT_W = 96;
const PLOT_H = 100;
const SLOT_SIZE = 32;
const SLOT_LOCAL = [
  { x: 8, y: 24 },
  { x: 46, y: 24 },
  { x: 8, y: 62 },
  { x: 46, y: 62 }
];

const PLOT_ORIGINS = [
  { x: 8, y: 8 },
  { x: 272, y: 8 },
  { x: 536, y: 8 },
  { x: 8, y: 312 },
  { x: 272, y: 312 },
  { x: 536, y: 312 }
];

const EGG_HATCH_MS = 22000;      // time for an egg to hatch
const EGG_SPAWN_MS = 11000;      // time between egg spawn attempts per plot
const STEAL_RANGE = 30;          // px, distance avatar can be from a slot to steal it
const STEAL_COOLDOWN_MS = 700;
const COIN_TICK_MS = 4000;       // passive income interval
const COIN_PER_CHICKEN = 1;
const STEAL_FULL_COOP_BONUS = 6; // coins awarded if your coop is full when you steal
const TICK_MS = 100;             // host simulation tick
const STATE_BROADCAST_EVERY = 2; // broadcast every N ticks
const INPUT_SEND_MS = 66;        // client -> host input rate

const PLAYER_COLORS = [
  '#e6533c', '#3c9ee6', '#4fb35a', '#e6b03c',
  '#a463d6', '#e373b0', '#3cc7c2', '#c98a3c'
];

function plotOrigin(index) {
  return PLOT_ORIGINS[index % PLOT_ORIGINS.length];
}

function slotWorldPos(plotIndex, slotIndex) {
  const o = plotOrigin(plotIndex);
  const s = SLOT_LOCAL[slotIndex];
  return { x: o.x + s.x, y: o.y + s.y };
}

function randCode(len) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function makeEmptySlot() {
  return { state: 'empty', hatchStart: 0 };
}

function freshPlayerState(id, name, color, plotIndex, saved) {
  const p = {
    id, name, color, plotIndex,
    x: plotOrigin(plotIndex).x + PLOT_W / 2,
    y: plotOrigin(plotIndex).y + PLOT_H + 22,
    coins: 8,
    connected: true,
    slots: [makeEmptySlot(), makeEmptySlot(), makeEmptySlot(), makeEmptySlot()],
    lastEggSpawn: Date.now(),
    lastCoinTick: Date.now()
  };
  if (saved && typeof saved === 'object') {
    if (typeof saved.coins === 'number' && isFinite(saved.coins) && saved.coins >= 0) {
      p.coins = Math.floor(saved.coins);
    }
    if (Array.isArray(saved.slots) && saved.slots.length === SLOTS_PER_PLOT) {
      p.slots = saved.slots.map(s => {
        if (s && (s.state === 'egg' || s.state === 'chicken')) {
          return { state: s.state, hatchStart: typeof s.hatchStart === 'number' ? s.hatchStart : Date.now() };
        }
        return makeEmptySlot();
      });
    }
    if (typeof saved.lastEggSpawn === 'number') p.lastEggSpawn = saved.lastEggSpawn;
    if (typeof saved.lastCoinTick === 'number') p.lastCoinTick = saved.lastCoinTick;
  }
  return p;
}