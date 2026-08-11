/* Steal a Chicken — networking (WebRTC via PeerJS, room-code signaling) */
'use strict';

const ROOM_PREFIX = 'steal-a-chicken-';

const Net = {
  peer: null,
  role: null,           // 'host' | 'client'
  roomCode: null,
  selfId: null,
  connections: {},       // host: peerId -> DataConnection
  hostConn: null,        // client: DataConnection to host
  handlers: {},

  on(event, fn) { this.handlers[event] = fn; },
  _emit(event, ...args) { if (this.handlers[event]) this.handlers[event](...args); },

  host(onReady, onError) {
    this.role = 'host';
    this.roomCode = randCode(5);
    const id = ROOM_PREFIX + this.roomCode;

    this.peer = new Peer(id, { debug: 0 });

    this.peer.on('open', (pid) => {
      this.selfId = pid;
      onReady(this.roomCode, pid);
    });

    this.peer.on('connection', (conn) => {
      conn.on('open', () => {
        this.connections[conn.peer] = conn;
        this._emit('peer-connected', conn.peer);
      });
      conn.on('data', (data) => this._emit('client-message', conn.peer, data));
      conn.on('close', () => {
        delete this.connections[conn.peer];
        this._emit('peer-disconnected', conn.peer);
      });
      conn.on('error', () => {
        delete this.connections[conn.peer];
        this._emit('peer-disconnected', conn.peer);
      });
    });

    this.peer.on('error', (err) => onError(err));
  },

  join(code, onReady, onError) {
    this.role = 'client';
    this.roomCode = code.toUpperCase();
    const hostId = ROOM_PREFIX + this.roomCode;

    this.peer = new Peer({ debug: 0 });

    this.peer.on('open', (pid) => {
      this.selfId = pid;
      const conn = this.peer.connect(hostId, { reliable: true });
      this.hostConn = conn;

      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) { settled = true; onError(new Error('No response from that room code.')); }
      }, 9000);

      conn.on('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        onReady(pid);
      });
      conn.on('data', (data) => this._emit('host-message', data));
      conn.on('close', () => this._emit('host-disconnected'));
      conn.on('error', (err) => {
        if (!settled) { settled = true; clearTimeout(timeout); onError(err); }
        else this._emit('host-disconnected');
      });
    });

    this.peer.on('error', (err) => onError(err));
  },

  broadcast(msg) {
    for (const id in this.connections) {
      const c = this.connections[id];
      if (c && c.open) c.send(msg);
    }
  },

  sendToHost(msg) {
    if (this.hostConn && this.hostConn.open) this.hostConn.send(msg);
  },

  teardown() {
    try {
      for (const id in this.connections) this.connections[id].close();
      if (this.hostConn) this.hostConn.close();
      if (this.peer) this.peer.destroy();
    } catch (e) { /* ignore */ }
    this.peer = null; this.role = null; this.roomCode = null;
    this.connections = {}; this.hostConn = null; this.selfId = null;
  }
};
