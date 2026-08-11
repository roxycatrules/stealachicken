/* Steal a Chicken — SVG renderer */
'use strict';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

const Render = {
  svg: null,
  layers: {},
  plotEls: [],   // per plot: { fence, label, slots:[{frame, egg, chicken, cracks}] }
  playerEls: {}, // id -> { g, body, head, comb, wing, label, ring }

  init(svgEl_) {
    this.svg = svgEl_;
    this.svg.innerHTML = '';
    this.layers.ground = svgEl('g', { id: 'layer-ground' });
    this.layers.plots = svgEl('g', { id: 'layer-plots' });
    this.layers.players = svgEl('g', { id: 'layer-players' });
    this.svg.append(this.layers.ground, this.layers.plots, this.layers.players);

    this._drawGround();
    for (let i = 0; i < MAX_PLAYERS; i++) this._drawPlot(i);
  },

  _drawGround() {
    const g = this.layers.ground;
    g.appendChild(svgEl('rect', { x: 0, y: 0, width: WORLD_W, height: WORLD_H, fill: '#8fc74b' }));
    // scattered dirt / clover patches for texture, deterministic pseudo-random
    let seed = 42;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed % 1000) / 1000; };
    for (let i = 0; i < 26; i++) {
      const x = rnd() * WORLD_W, y = 108 + rnd() * 198;
      const r = 6 + rnd() * 10;
      g.appendChild(svgEl('ellipse', {
        cx: x, cy: y, rx: r, ry: r * 0.55,
        fill: '#7fb742', opacity: 0.55
      }));
    }
    for (let i = 0; i < 10; i++) {
      const x = rnd() * WORLD_W, y = 108 + rnd() * 198;
      g.appendChild(svgEl('circle', { cx: x, cy: y, r: 1.6 + rnd() * 1.4, fill: '#fff', opacity: 0.85 }));
      g.appendChild(svgEl('circle', { cx: x + 3, cy: y - 3, r: 1.2, fill: '#ffe45a', opacity: 0.9 }));
    }
  },

  _drawPlot(index) {
    const o = plotOrigin(index);
    const g = svgEl('g', { class: 'plot', 'data-plot': index });

    const fence = svgEl('rect', {
      x: o.x - 3, y: o.y - 3, width: PLOT_W + 6, height: PLOT_H + 6,
      rx: 8, fill: 'rgba(255,255,255,0.10)', stroke: '#9c9c9c',
      'stroke-width': 3, 'stroke-dasharray': '3 4'
    });
    g.appendChild(fence);

    const label = svgEl('text', {
      x: o.x + PLOT_W / 2, y: o.y + 13, 'text-anchor': 'middle',
      'font-size': 10, 'font-weight': 700, fill: '#5a4526'
    });
    label.textContent = 'Open plot';
    g.appendChild(label);

    const slots = [];
    for (let s = 0; s < SLOTS_PER_PLOT; s++) {
      const p = slotWorldPos(index, s);
      const sg = svgEl('g', { class: 'slot', 'data-plot': index, 'data-slot': s });

      const frame = svgEl('rect', {
        x: p.x, y: p.y, width: SLOT_SIZE, height: SLOT_SIZE, rx: 5,
        fill: 'rgba(120,80,30,0.18)', stroke: '#6b4a1f', 'stroke-width': 1.4,
        'stroke-dasharray': '2.5 2.5'
      });
      sg.appendChild(frame);

      const egg = this._buildEgg(p.x + SLOT_SIZE / 2, p.y + SLOT_SIZE / 2 + 1);
      egg.setAttribute('display', 'none');
      sg.appendChild(egg);

      const chicken = this._buildChicken(p.x + SLOT_SIZE / 2, p.y + SLOT_SIZE / 2 + 2, '#ffffff');
      chicken.setAttribute('display', 'none');
      sg.appendChild(chicken);

      g.appendChild(sg);
      slots.push({ frame, egg, chicken, cracks: egg._cracks });
    }

    this.layers.plots.appendChild(g);
    this.plotEls[index] = { root: g, fence, label, slots };
  },

  _buildEgg(cx, cy) {
    const g = svgEl('g', { class: 'egg' });
    const body = svgEl('ellipse', {
      cx, cy, rx: 8.5, ry: 11, fill: '#fdf3d9', stroke: '#c9a35a', 'stroke-width': 1.3
    });
    g.appendChild(body);
    const speck = (dx, dy, r) => svgEl('circle', { cx: cx + dx, cy: cy + dy, r, fill: '#e8cf95', opacity: 0.6 });
    g.appendChild(speck(-3, -2, 1.1));
    g.appendChild(speck(3, 3, 1.3));
    g.appendChild(speck(1, -5, 0.9));

    const cracks = [];
    for (let i = 0; i < 3; i++) {
      const c = svgEl('path', {
        d: '', stroke: '#8a6a2e', 'stroke-width': 1.1, fill: 'none',
        'stroke-linecap': 'round', opacity: 0
      });
      g.appendChild(c);
      cracks.push(c);
    }
    g._cracks = cracks;
    g._cx = cx; g._cy = cy;
    return g;
  },

  _crackPaths(cx, cy) {
    return [
      `M ${cx - 4} ${cy - 8} l 2 4 l -2.5 3 l 3 3`,
      `M ${cx + 5} ${cy - 6} l -2 4 l 2.5 3`,
      `M ${cx - 1} ${cy + 3} l 2.5 3 l -2 3.5`
    ];
  },

  setEggProgress(eggGroup, progress) {
    // progress 0..1 — reveal crack lines progressively
    const thresholds = [0.35, 0.65, 0.88];
    const paths = this._crackPaths(eggGroup._cx, eggGroup._cy);
    eggGroup._cracks.forEach((c, i) => {
      if (progress >= thresholds[i]) {
        c.setAttribute('d', paths[i]);
        c.setAttribute('opacity', 1);
      } else {
        c.setAttribute('opacity', 0);
      }
    });
    const wobble = progress > 0.75 ? (progress > 0.92 ? 1.4 : 0.7) : 0;
    eggGroup.style.transform = wobble ? `rotate(${wobble}deg)` : '';
    eggGroup.style.transformOrigin = `${eggGroup._cx}px ${eggGroup._cy}px`;
  },

  _buildChicken(cx, cy, color, scale) {
    scale = scale || 1;
    const g = svgEl('g', { class: 'chicken' });
    const wrap = svgEl('g', { transform: `translate(${cx} ${cy}) scale(${scale})` });
    g.appendChild(wrap);

    wrap.appendChild(svgEl('ellipse', { cx: 1, cy: 8, rx: 8, ry: 3, fill: 'rgba(0,0,0,0.15)' }));
    // legs
    wrap.appendChild(svgEl('line', { x1: -3, y1: 6, x2: -3, y2: 10, stroke: '#e08a1e', 'stroke-width': 1.6 }));
    wrap.appendChild(svgEl('line', { x1: 3, y1: 6, x2: 3, y2: 10, stroke: '#e08a1e', 'stroke-width': 1.6 }));
    // body
    const body = svgEl('ellipse', { cx: 0, cy: 1, rx: 9, ry: 7.2, fill: color, stroke: '#33302a', 'stroke-width': 1.1 });
    wrap.appendChild(body);
    // wing
    wrap.appendChild(svgEl('ellipse', { cx: -2, cy: 2, rx: 4.6, ry: 3.4, fill: 'rgba(0,0,0,0.08)' }));
    // tail
    wrap.appendChild(svgEl('path', { d: 'M -8 -2 q -5 -4 -1 -7 q 4 1 3 6 Z', fill: color, stroke: '#33302a', 'stroke-width': 1 }));
    // head
    wrap.appendChild(svgEl('circle', { cx: 7, cy: -4, r: 4.6, fill: color, stroke: '#33302a', 'stroke-width': 1.1 }));
    // comb
    wrap.appendChild(svgEl('path', { d: 'M 4 -8 q 1 -3 2.4 -1 q 0.6 -3 2.2 -1 q 1 -2.6 2 -0.6', fill: '#d22828', stroke: '#8a1717', 'stroke-width': 0.6 }));
    // beak
    wrap.appendChild(svgEl('polygon', { points: '11,-4 15,-3 11,-1.6', fill: '#f0a414', stroke: '#8a5d00', 'stroke-width': 0.5 }));
    // wattle
    wrap.appendChild(svgEl('path', { d: 'M 9.5 -1 q 0.5 2.4 -1 3', fill: 'none', stroke: '#d22828', 'stroke-width': 1.4, 'stroke-linecap': 'round' }));
    // eye
    wrap.appendChild(svgEl('circle', { cx: 8.4, cy: -4.6, r: 0.9, fill: '#221a10' }));

    g._wrap = wrap;
    return g;
  },

  _buildAvatar(id, name, color, isSelf) {
    const g = svgEl('g', { class: 'avatar', 'data-id': id });

    if (isSelf) {
      const ring = svgEl('circle', { cx: 0, cy: 0, r: AVATAR_R + 4, fill: 'none', stroke: '#fff', 'stroke-width': 1.6, 'stroke-dasharray': '3 3', opacity: 0.85 });
      g.appendChild(ring);
    }
    g.appendChild(svgEl('ellipse', { cx: 0, cy: AVATAR_R * 0.75, rx: AVATAR_R + 2, ry: 3.4, fill: 'rgba(0,0,0,0.22)' }));
    const body = svgEl('circle', { cx: 0, cy: 0, r: AVATAR_R, fill: color, stroke: '#2b2417', 'stroke-width': 1.4 });
    g.appendChild(body);
    // little cap brim to read as a "farmer" silhouette
    g.appendChild(svgEl('path', {
      d: `M ${-AVATAR_R} ${-AVATAR_R * 0.15} a ${AVATAR_R} ${AVATAR_R} 0 0 1 ${AVATAR_R * 2} 0`,
      fill: 'none', stroke: 'rgba(255,255,255,0.55)', 'stroke-width': 2
    }));
    const label = svgEl('text', {
      x: 0, y: -AVATAR_R - 6, 'text-anchor': 'middle', 'font-size': 9.5,
      'font-weight': 700, fill: '#2b2417', stroke: '#fff', 'stroke-width': 3,
      'paint-order': 'stroke'
    });
    label.textContent = name;
    g.appendChild(label);

    this.layers.players.appendChild(g);
    return { g, body };
  },

  ensureAvatar(id, name, color, isSelf) {
    if (!this.playerEls[id]) {
      this.playerEls[id] = this._buildAvatar(id, name, color, isSelf);
    }
    return this.playerEls[id];
  },

  removeAvatar(id) {
    const e = this.playerEls[id];
    if (e) { e.g.remove(); delete this.playerEls[id]; }
  },

  positionAvatar(id, x, y) {
    const e = this.playerEls[id];
    if (e) e.g.setAttribute('transform', `translate(${x} ${y})`);
  },

  updatePlot(index, playerState, isSelf, now) {
    const pe = this.plotEls[index];
    if (!playerState) {
      pe.fence.setAttribute('stroke', '#9c9c9c');
      pe.fence.setAttribute('fill', 'rgba(255,255,255,0.10)');
      pe.label.textContent = 'Open plot';
      pe.label.setAttribute('fill', '#5a4526');
      for (const s of pe.slots) { s.egg.setAttribute('display', 'none'); s.chicken.setAttribute('display', 'none'); }
      return;
    }
    pe.fence.setAttribute('stroke', playerState.color);
    pe.fence.setAttribute('fill', playerState.connected ? 'rgba(255,255,255,0.14)' : 'rgba(120,120,120,0.18)');
    pe.label.textContent = (isSelf ? 'Your coop — ' : '') + playerState.name + (playerState.connected ? '' : ' (left)');
    pe.label.setAttribute('fill', playerState.color);

    playerState.slots.forEach((slot, i) => {
      const s = pe.slots[i];
      if (slot.state === 'empty') {
        s.egg.setAttribute('display', 'none');
        s.chicken.setAttribute('display', 'none');
      } else if (slot.state === 'egg') {
        s.egg.setAttribute('display', '');
        s.chicken.setAttribute('display', 'none');
        const progress = clamp((now - slot.hatchStart) / EGG_HATCH_MS, 0, 1);
        this.setEggProgress(s.egg, progress);
      } else if (slot.state === 'chicken') {
        s.egg.setAttribute('display', 'none');
        s.chicken.setAttribute('display', '');
      }
    });
  },

  toast(x, y, text, color) {
    const layer = document.getElementById('toast-layer');
    if (!layer) return;
    const wrap = document.getElementById('world-wrap');
    const rect = this.svg.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const scaleX = rect.width / WORLD_W;
    const scaleY = rect.height / WORLD_H;
    const px = (rect.left - wrapRect.left) + x * scaleX;
    const py = (rect.top - wrapRect.top) + y * scaleY;

    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    el.style.left = px + 'px';
    el.style.top = py + 'px';
    el.style.color = color || '#fff';
    layer.appendChild(el);
    setTimeout(() => el.remove(), 1150);
  }
};
