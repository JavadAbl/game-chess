# GM-3D Chess — WebGPU Chess Game Build Plan

> A browser chess game rendered with **Three.js WebGPURenderer** (WebGL2 fallback), full
> FIDE rules via **chess.js**, three game modes (**vs AI**, **local 2-player**, **online
> 2-player** over Socket.IO), procedural 3D Staunton pieces, and WebAudio sound effects.

---

## 1. Goals & Success Criteria

| # | Goal | Success Criterion |
|---|------|-------------------|
| G1 | Real 3D chess on WebGPU | Scene renders through `WebGPURenderer`; badge shows active backend; automatic WebGL2 fallback when WebGPU is unavailable |
| G2 | Correct chess rules | Castling, en passant, promotion, check/checkmate/stalemate/draw all enforced by chess.js — illegal moves impossible |
| G3 | Three modes | Hot-seat local play; AI with 4 difficulty levels; online rooms with 6-char codes, move sync, rematch |
| G4 | Tactile feel | Smooth move/capture animations, square highlights, capture particle bursts, synthesized wood-tap sounds |
| G5 | Responsive | Playable on desktop (canvas + side HUD) and mobile (stacked layout, touch = click) |

## 2. Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | Next.js 16 (App Router) + TypeScript | Required stack; client-only canvas via `dynamic(ssr:false)` |
| Rendering | Three.js `WebGPURenderer` (`three/webgpu`), OrbitControls, RoomEnvironment PMREM | WebGPU pipeline with auto-fallback; PBR materials, PCF shadows, ACES tonemapping |
| Rules | chess.js 1.4 | Battle-tested move gen/validation, SAN history, FEN sync |
| AI | Custom negamax + alpha-beta + MVV-LVA ordering, iterative deepening in a **Web Worker** | Self-contained, no server cost; time-budgeted so the UI never blocks |
| Multiplayer | Socket.IO mini-service (port 3003, behind gateway `XTransformPort=3003`) | Matches scaffold websocket pattern; server re-validates every move |
| State | Zustand store | Single source of truth bridging React UI ⇄ 3D scene ⇄ socket ⇄ worker |
| Styling | Tailwind 4 + shadcn/ui (New York) | Dialogs, inputs, toasts out of the box; warm amber/wood palette (no blue/indigo) |
| Audio | WebAudio API, procedurally synthesized | Zero asset files; move/capture/castle/check/promote/game-end cues |

## 3. Architecture

```
┌──────────────────────────── Browser ────────────────────────────┐
│                                                                  │
│  React UI                    Zustand store          3D Scene     │
│  ┌──────────────┐  actions  ┌──────────────┐  subscribe ┌─────┐ │
│  │ ModeSelect   │──────────▶│ fen, turn,   │───────────▶│Three│ │
│  │ GameHUD      │◀──────────│ lastMove,    │            │WebGPU│ │
│  │ Dialogs/Toast│  state    │ selected,    │            │Scene │ │
│  └──────────────┘           │ history…     │            └──┬───┘ │
│        │                    └──────┬───────┘               │raycast
│        │ emit/on                   │                        ▼
│  ┌─────▼────────┐          ┌───────▼────────┐        squares/pieces
│  │ Socket client│          │ chess.js engine│        (64 meshes +   │
│  │ (XTransPort  │          │ (module single)│         piece groups) │
│  │  3003)       │          └───────┬────────┘                       │
│  └─────┬────────┘                  │ FEN                            │
└────────┼───────────────────────────┼────────────────────────────────┘
         │ WebSocket                 │ postMessage
┌────────▼─────────────┐   ┌─────────▼──────────┐
│ chess-server (3003)  │   │ ai.worker.ts       │
│ rooms, tokens,       │   │ negamax + α-β +    │
│ chess.js validation, │   │ iterative deepen.  │
│ rematch, rejoin      │   │ 4 difficulty tiers │
└──────────────────────┘   └────────────────────┘
```

**Data flow of a move (local/AI):** click square → store.onSquareClick → engine
validates against cached legal moves → chess.js `move()` → store updates
(`fen`, verbose `lastMoveDetail`, `moveSeq++`) → scene animates the diff →
SFX fires → if AI's turn, FEN is posted to the worker → best move comes back →
same store path.

**Data flow (online):** identical, but `game:move` first goes to the server,
which re-validates with its own chess.js instance and fans out to both
clients. Rooms are in-memory with player tokens (rejoin supported), 90 s
disconnect grace, and a two-flag rematch handshake.

## 4. Module Breakdown

| Module | Path | Responsibility |
|--------|------|----------------|
| Engine wrapper | `src/lib/chess/engine.ts` | Owns the `Chess` instance; legal-move cache, apply/undo, board snapshot, result detection |
| Game store | `src/lib/chess/store.ts` | Zustand: phase, mode, selection, history, captured, promotion prompt, AI/online state, SFX triggers |
| AI search | `src/lib/chess/ai/search.ts` | Pure evaluation (material + piece-square tables) + negamax α-β with time budget |
| AI worker | `src/lib/chess/ai/ai.worker.ts` + `aiClient.ts` | Worker entry; main-thread fallback if `Worker` construction fails |
| 3D scene | `src/lib/three/ChessScene.ts` | Renderer init/fallback detection, camera, lights, environment, resize, render loop, tweens |
| Board builder | `src/lib/three/board.ts` | 64 emissive-tintable squares, frame, coordinate labels, highlight/marker meshes |
| Piece factory | `src/lib/three/pieces.ts` | Procedural LatheGeometry profiles (P/R/B/Q/K) + extruded knight head; ivory/charcoal PBR |
| Effects | `src/lib/three/effects.ts` | Capture particle bursts, tween manager, check-square pulse |
| Environments | `src/lib/three/environments.ts` | Random backdrops (CC0, Poly Haven): 2K equirects tonemapped + WebP q85 in `public/env` (~0.2–0.6 MB each, `scripts/prep_envs.py`), lazy-fetched per game start, PMREM IBL + sharp equirect background (`backgroundBlurriness` must stay 0 — blur > 0 makes the r186 WebGPU renderer paint the PMREM atlas instead of the sky) |
| Audio | `src/lib/audio/sfx.ts` | Lazy AudioContext, synthesized cues, mute toggle |
| Net client | `src/lib/net/socket.ts` | Singleton `io('/?XTransformPort=3003')`, typed emit/on helpers |
| UI | `src/components/chess/*` | `ChessApp`, `ModeSelect`, `ChessCanvas`, `GameHUD`, `PromotionDialog`, `ResultDialog` |
| Server | `mini-services/chess-server/index.ts` | Socket.IO rooms: create/join/rejoin, move validation, resign, rematch, disconnect grace |

## 5. Phased Milestones (exit criteria per phase)

### Phase 0 — Scaffold & deps ✅
Init fullstack env, verify dev server, add `three`, `chess.js`, `socket.io(-client)`.
**Exit:** deps installed; chess.js + three export smoke tests pass.

### Phase 1 — Rules & state
Engine wrapper + Zustand store; selection & legal-target computation; move
application; promotion detection; game-over reasons.
**Exit:** store correctly reaches checkmate/stalemate states in isolation.

### Phase 2 — 3D rendering
`WebGPURenderer` init with backend detection; board + frame + labels; procedural
piece geometries; PBR ivory/charcoal materials; hemisphere + shadow-casting key
light; PMREM environment (guarded); OrbitControls clamps; responsive resize.
**Exit:** full starting position renders with shadows at 60 fps; backend badge
accurate.

### Phase 3 — Interaction
Pointer click vs orbit-drag disambiguation; raycast select/act; selection,
legal-move dots, capture rings, last-move and check highlights; slide/arc move
animations incl. castling rook, en-passant pawn removal, promotion swap;
promotion dialog.
**Exit:** a full game can be played hot-seat purely through the 3D board.

### Phase 4 — Modes
- **4a AI:** worker search (levels Easy→Expert, time budgets 0.2–3 s), thinking
  indicator, input lockout, main-thread fallback.
- **4b Online:** chess-server mini-service (create/join/rejoin, validated moves,
  resign, rematch, disconnect grace) + socket wiring, room UI, toasts.
**Exit:** AI beats a random mover without blocking UI; two clients finish a game
online with rematch.

### Phase 5 — Polish
Synthesized SFX (move/capture/castle/check/promote/game-end) + mute; capture
particle bursts; camera flip & auto-orientation per mode; move list, captured
trays, PGN copy; result dialog; loading/error states; mobile layout.
**Exit:** all features usable end-to-end on desktop + mobile viewport.

### Phase 6 — Verification
`bun run lint` clean; dev.log clean; Agent Browser E2E: menu → game → moves →
sounds → game over; scripted 2-client online socket test; screenshots reviewed.
**Exit:** zero console/runtime errors; golden paths verified in browser.

## 6. Key Technical Decisions

1. **Procedural pieces over downloaded models** — no external asset dependency,
   tiny payload, license-clean; lathe profiles read as classic Staunton at game scale.
2. **`three/webgpu` imports everywhere** — one module graph so node materials and
   addons share class identities; WebGL2 fallback handled inside `WebGPURenderer`.
3. **Worker AI with time-budgeted iterative deepening** — difficulty = (depth cap,
   budget, randomness) rather than separate engines; UI thread never blocks;
   graceful main-thread fallback for exotic embeds.
4. **Server re-validates online moves** — clients stay thin; a tampered client
   cannot make an illegal move.
5. **`moveSeq` counter** — the scene syncs positions off a single monotonic
   counter, avoiding double-apply races between FEN syncs and move animations.
6. **Diff-based animation, snapshot-based resync** — normal moves animate;
   undo/rematch/rejoin resync instantly from FEN (no reverse-animation edge cases).

## 7. Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| WebGPU unavailable (Safari/Firefox/old GPU) | Medium | `WebGPURenderer` auto-falls back to WebGL2; badge communicates it |
| chess.js speed limits AI depth | Medium | Time-budgeted iterative deepening; move ordering; worker keeps UI fluid |
| Socket path/gateway mismatch | Low | Follow scaffold example verbatim (`path:'/'` server, `io('/?XTransformPort=3003')`) |
| Worker bundling differences | Low | `new Worker(new URL(...), {type:'module'})` with runtime fallback |
| Node/room memory on server restart | Accepted | Rooms are ephemeral by design; client toasts on loss |
| Headless E2E can't see WebGPU | Medium | Verify fallback path + screenshot review + scripted socket integration test |

## 8. Future Enhancements (out of scope)

Chess clocks, PGN import, Stockfish WASM option, spectator mode, ELO/rating
persistence (Prisma), board themes, drag-and-drop piece movement, sound pack
selection.
