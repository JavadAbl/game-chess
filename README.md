# ♛ GM-3D Chess

3D chess in your browser — rendered with **WebGPU** (automatic **WebGL2** fallback), with an AI opponent (4 strength levels), local hot-seat duels and real-time **online rooms** over Socket.IO.

![stack](https://img.shields.io/badge/Next.js-16-black) ![stack](https://img.shields.io/badge/three.js-WebGPU-blue) ![stack](https://img.shields.io/badge/rules-chess.js-green)

## Features

- **True 3D board** — procedural pieces with PBR ivory/charcoal materials, soft shadows, orbit camera (drag to rotate, scroll to zoom), animated slides/knight arcs, capture bursts, castling + en-passant + promotion animations.
- **Full rules** via [chess.js](https://github.com/jhlywa/chess.js): checkmate, stalemate, insufficient material, threefold repetition, fifty-move rule.
- **AI opponent** — negamax + α-β pruning in a Web Worker (Easy / Medium / Hard / Expert). You play White; undo lands back on your turn.
- **Online multiplayer** — create a room, share the 5-character code, play in real time. Every move is re-validated by the server's own chess.js. Rooms survive a page refresh (rejoin), tolerate a 90 s disconnect, and support a two-flag rematch handshake.
- **Beginner hints** *(optional toggle)* — glows every piece you can legally move, dots for quiet moves and rings for captures on its destination squares. Off by default: a clean board with no move hints (moves still work by clicking).
- **Live arenas** — each match rolls a random HDRI-style environment (6 photographic + 6 procedural abstract panoramas). Downloaded once, cached in the browser, with a progress bar before the game.
- **Synthesized audio** — WebAudio-generated move/capture/castle/check/end cues, no audio files.

## Tech stack

| Layer | Choice |
|---|---|
| App framework | Next.js 16 (App Router, standalone output), React 19, TypeScript |
| 3D | three.js `WebGPURenderer` (WebGL2 fallback), custom scene/store sync |
| Rules & state | chess.js + zustand store |
| Multiplayer | Socket.IO mini-service (`mini-services/chess-server`, port 3003) |
| UI | Tailwind CSS 4 + shadcn/ui, lucide icons |
| Audio | WebAudio synthesis (`src/lib/audio/sfx.ts`) |

---

## Getting started (local development)

**Prerequisites:** [Bun](https://bun.sh) 1.1+ (or Node 20+ with `npx tsx` as the service runner) and a modern browser — WebGPU-capable Chrome/Edge 113+ for the full pipeline, any WebGL2 browser for the fallback.

```bash
# 1. install
bun install        # or: npm install

# 2. run (app on :3000, chess service on :3003)
bun run dev        # or: npm run dev
```

That's it. In dev/preview the app boots the Socket.IO chess service **for you** (`instrumentation.ts` spawns it as a child of the Next dev server), so multiplayer works out of the box. Set `NEXT_SPAWN_SERVICES=0` to disable this and manage the service yourself:

```bash
bun mini-services/chess-server/index.ts     # or: npx tsx mini-services/chess-server/index.ts
```

Open **http://localhost:3000**. Lint with `bun run lint`.

> The `.env` file only carries a scaffold `DATABASE_URL` (Prisma) — the chess game itself needs no database.

---

## How to play

### Starting a game

| Mode | How |
|---|---|
| **vs AI** | Menu → *AI* tab → pick Easy/Medium/Hard/Expert → *Play as White vs AI* |
| **Local duel** | Menu → *Local* tab → *Start local duel* (hot-seat: board flips per turn) |
| **Online** | One player: *Online* tab → *Create a game* → copy the 5-char code. The other: enter the code → *Join* |

### Board controls

| Action | Input |
|---|---|
| Select a piece / make a move | Left-click piece, then left-click destination |
| Deselect | Right-click the selected piece, press **Esc**, or click an empty square |
| Orbit / zoom | Left-drag / scroll wheel (click vs drag is auto-detected) |
| Flip view | *Flip* button in the side panel |
| Undo (local & AI only) | *Undo* button |

### Assistance & extras

- **Beginner hints** — toggle in the menu or the side panel. ON: cyan glow under every piece you can legally move + dots/rings on destinations. OFF: no hints at all. The preference is remembered across visits.
- **Sound** — mute/unmute from the header or side panel.
- **Copy PGN** — export the move list (local & AI modes).
- **Online** — *Resign* ends the game; *Rematch* proposes a new game (both players must agree); a refresh rejoins your seat automatically; "Opponent disconnected — waiting…" marks the 90 s grace window.

---

## Deployment

Two processes make up the whole system:

| Component | Command | Port | Notes |
|---|---|---|---|
| Next.js app (UI + 3D) | `bun run build && bun run start` | `PORT` (default 3000) | standalone output |
| Chess service (Socket.IO) | `bun mini-services/chess-server/index.ts` | 3003 | in-memory rooms — run exactly **one** instance |

### 1. Build and run

```bash
bun install
bun run build          # next build + copies static/public into .next/standalone
PORT=3000 bun run start
bun mini-services/chess-server/index.ts   # keep alive with systemd/pm2/your supervisor
```

`instrumentation.ts` is a no-op in production — it never spawns the service there.

### 2. Front both processes with one reverse proxy

The client intentionally connects to **its own origin**: `io('/?XTransformPort=3003')` (`src/lib/net/socket.ts`). Your gateway routes those requests to port 3003, everything else to the app — same-domain, no CORS, no hardcoded ports in the page.

**Caddy (matches the platform's own setup):**

```caddyfile
yourdomain.com {
    @chess query XTransformPort=3003
    reverse_proxy @chess localhost:3003
    reverse_proxy localhost:3000
}
```

**nginx** (single route, upstream switched by the query marker):

```nginx
# WebSocket-friendly Connection header
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

# Socket.IO requests carry ?EIO=4...&XTransformPort=3003 — send them to :3003
map $args $upstream_port {
    ~XTransformPort=3003 3003;
    default              3000;
}

server {
    listen 443 ssl;
    server_name yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:$upstream_port;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_read_timeout 120s;   # > pingTimeout (60 s) so idle games survive
    }
}
```

> Simpler alternative for self-hosting: edit `src/lib/net/socket.ts` and connect to a dedicated path such as `io('/chess-socket', …)`, then proxy just that path to 3003. The marker-query approach exists so the same build runs on gateways that only allow whole-origin routing.

**Checklist:**

- [ ] WebSocket `Upgrade`/`Connection` headers enabled on the socket route (or let Socket.IO fall back to polling — it still works, with slightly higher latency).
- [ ] Proxy read timeout > 60 s (Socket.IO `pingTimeout`).
- [ ] Exactly one chess-service instance (rooms live in memory).
- [ ] HTTPS in front of both (WebGPU requires a secure context).

### Platform preview (this sandbox)

Nothing to configure: the preview gateway already routes `XTransformPort` requests to the service port, and `instrumentation.ts` boots the service alongside `next dev`.

---

## Project structure

```
src/
  app/                    layout + page (mounts ChessApp)
  components/chess/       ChessApp, ModeSelect, ChessCanvas, GameHUD, dialogs
  lib/chess/
    engine.ts             chess.js wrapper: legal-move cache, apply/undo, status
    store.ts              zustand game store (all modes, promotion, online sync)
    ai/                   worker search (negamax + α-β) & client
  lib/three/              ChessScene, board, pieces, effects, environments
  lib/net/                socket client + server-event bindings
  lib/audio/sfx.ts        synthesized sound cues
mini-services/chess-server/index.ts   Socket.IO rooms, server-side validation
public/env/*.webp        12 equirectangular environments (cached client-side)
instrumentation.ts       dev-only: boots the mini-service with `next dev`
scripts/                 environment preparation pipelines (Python)
PLAN.md                  architecture deep-dive & build milestones
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| "WebGPU unavailable — falling back to WebGL2" | Informational; the game runs on WebGL2. Use Chrome/Edge 113+ for WebGPU. |
| "Could not start the 3D renderer" | Browser lacks WebGPU **and** WebGL2 — update it, or enable hardware acceleration. |
| Join says "Room not found — check the code" | Rooms are in-memory: a service restart clears them; codes are case-insensitive. |
| Online badge shows "offline" | The opponent's tab lost the socket — it auto-reconnects and rejoins; wait out the 90 s grace before the room is reclaimed. |
| Arena download stuck | The environment fetches once into Cache Storage; a hard refresh retries and falls back to the default backdrop on failure. |
