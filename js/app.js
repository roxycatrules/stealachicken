/* Steal a Chicken — app bootstrap */
'use strict';

(function () {
  const lobbyScreen = document.getElementById('lobby-screen');
  const gameScreen = document.getElementById('game-screen');
  const nameInput = document.getElementById('name-input');
  const colorPicker = document.getElementById('color-picker');
  const hostBtn = document.getElementById('host-btn');
  const joinBtn = document.getElementById('join-btn');
  const joinCodeInput = document.getElementById('join-code-input');
  const statusEl = document.getElementById('lobby-status');
  const roomCodeDisplay = document.getElementById('room-code-display');
  const playersToggle = document.getElementById('players-toggle');
  const playersPanel = document.getElementById('players-panel');
  const leaveBtn = document.getElementById('leave-btn');
  const worldSvg = document.getElementById('world');

  let selectedColor = PLAYER_COLORS[0];
  let savedProgress = null; // {coins, slots, lastEggSpawn, lastCoinTick} restored from chrome.storage.local
  let saveIntervalHandle = null;

  function buildColorPicker() {
    colorPicker.innerHTML = '';
    PLAYER_COLORS.forEach((c, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch' + (i === 0 ? ' selected' : '');
      b.style.background = c;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', i === 0 ? 'true' : 'false');
      b.addEventListener('click', () => {
        selectedColor = c;
        [...colorPicker.children].forEach(ch => { ch.classList.remove('selected'); ch.setAttribute('aria-checked', 'false'); });
        b.classList.add('selected');
        b.setAttribute('aria-checked', 'true');
        persistPrefs();
      });
      colorPicker.appendChild(b);
    });
  }

  function persistPrefs() {
    const prefs = { name: nameInput.value.trim(), color: selectedColor };
    try { chrome.storage && chrome.storage.local.set({ sacPrefs: prefs }); } catch (e) { /* ignore */ }
  }

  function loadPrefs() {
    try {
      chrome.storage && chrome.storage.local.get(['sacPrefs', 'sacProgress'], (res) => {
        const prefs = res && res.sacPrefs;
        if (prefs && prefs.name) nameInput.value = prefs.name;
        if (prefs && prefs.color) {
          selectedColor = prefs.color;
          const idx = PLAYER_COLORS.indexOf(prefs.color);
          if (idx >= 0) {
            [...colorPicker.children].forEach((ch, i) => {
              ch.classList.toggle('selected', i === idx);
              ch.setAttribute('aria-checked', i === idx ? 'true' : 'false');
            });
          }
        }
        if (res && res.sacProgress) {
          savedProgress = res.sacProgress;
          const chickens = (savedProgress.slots || []).filter(s => s.state === 'chicken').length;
          if (savedProgress.coins || chickens) {
            setStatus(`Welcome back — ${savedProgress.coins} coins, ${chickens} chicken${chickens === 1 ? '' : 's'} saved.`, 'ok');
          }
        }
      });
    } catch (e) { /* storage unavailable, ignore */ }
  }

  function saveProgressNow() {
    const progress = Game.getLocalProgress();
    if (!progress) return;
    savedProgress = progress;
    try { chrome.storage && chrome.storage.local.set({ sacProgress: progress }); } catch (e) { /* ignore */ }
  }

  function setStatus(msg, type) {
    statusEl.textContent = msg || '';
    statusEl.className = 'status' + (type ? ' ' + type : '');
  }

  function currentName() {
    const v = nameInput.value.trim();
    return v ? v.slice(0, 14) : 'Farmer' + Math.floor(Math.random() * 90 + 10);
  }

  function showGameScreen(roomCode) {
    lobbyScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    roomCodeDisplay.textContent = roomCode;
    Render.init(worldSvg);
    const worldWrap = document.getElementById('world-wrap');
    if (worldWrap) worldWrap.focus();
    if (saveIntervalHandle) clearInterval(saveIntervalHandle);
    saveIntervalHandle = setInterval(saveProgressNow, 3000);
  }

  function showLobbyScreen() {
    if (saveIntervalHandle) { clearInterval(saveIntervalHandle); saveIntervalHandle = null; }
    gameScreen.classList.add('hidden');
    lobbyScreen.classList.remove('hidden');
    playersPanel.classList.add('hidden');
    hostBtn.disabled = false;
    joinBtn.disabled = false;
  }

  function refreshPlayersPanel() {
    if (!Game.world) return;
    const rows = Game.order.map(id => {
      const p = Game.world.players[id];
      if (!p) return '';
      const count = p.slots.filter(s => s.state === 'chicken').length;
      const eggCount = p.slots.filter(s => s.state === 'egg').length;
      return `<div class="player-row">
        <span class="player-dot" style="background:${p.color}"></span>
        <span class="pname">${escapeHtml(p.name)}${p.connected ? '' : ' (left)'}</span>
        <span class="pcount">${count}/${eggCount}</span>
      </div>`;
    }).join('');
    playersPanel.innerHTML = '<h4>Flock / eggs</h4>' + rows;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function bindGameCallbacks() {
    Game.on('roster-changed', refreshPlayersPanel);
    Game.on('joined', () => refreshPlayersPanel());
    Game.on('room-full', () => {
      teardownAll();
      setStatus('That room is full (max 6 farmers).', 'error');
    });
    Game.on('host-lost', () => {
      teardownAll();
      setStatus('Lost connection to the host.', 'error');
    });
  }

  function teardownAll() {
    saveProgressNow();
    Game.teardown();
    Net.teardown();
    showLobbyScreen();
  }

  hostBtn.addEventListener('click', () => {
    persistPrefs();
    hostBtn.disabled = true;
    setStatus('Opening room...', '');
    Net.host((roomCode, id) => {
      Game.startAsHost(id, currentName(), selectedColor, savedProgress);
      bindGameCallbacks();
      showGameScreen(roomCode);
      setStatus('', '');
      hostBtn.disabled = false;
    }, (err) => {
      hostBtn.disabled = false;
      setStatus('Could not open a room: ' + (err && err.message ? err.message : 'network error'), 'error');
    });
  });

  joinBtn.addEventListener('click', () => {
    const code = joinCodeInput.value.trim();
    if (code.length < 4) { setStatus('Enter the 5-character room code.', 'error'); return; }
    persistPrefs();
    joinBtn.disabled = true;
    setStatus('Joining room...', '');
    Net.join(code, () => {
      Game.startAsClient(Net.selfId, currentName(), selectedColor, savedProgress);
      bindGameCallbacks();
      Game.on('joined', () => {
        showGameScreen(Net.roomCode);
        setStatus('', '');
        refreshPlayersPanel();
      });
      joinBtn.disabled = false;
    }, (err) => {
      joinBtn.disabled = false;
      setStatus('Could not join: ' + (err && err.message ? err.message : 'room not found'), 'error');
    });
  });

  joinCodeInput.addEventListener('input', () => {
    joinCodeInput.value = joinCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  playersToggle.addEventListener('click', () => {
    playersPanel.classList.toggle('hidden');
    if (!playersPanel.classList.contains('hidden')) refreshPlayersPanel();
  });

  leaveBtn.addEventListener('click', () => {
    teardownAll();
    setStatus('You left the room.', 'ok');
  });

  document.getElementById('world-wrap').addEventListener('click', () => {
    document.getElementById('world-wrap').focus();
  });

  // best-effort save the instant the popup loses visibility/closes
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveProgressNow();
  });
  window.addEventListener('pagehide', saveProgressNow);

  buildColorPicker();
  loadPrefs();
  setInterval(() => { if (!gameScreen.classList.contains('hidden')) refreshPlayersPanel(); }, 2000);
})();
