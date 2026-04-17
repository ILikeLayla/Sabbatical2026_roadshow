# SABB 2026 Roadshow — 1v1 FPS Browser Game

A real-time 1v1 first-person shooter running entirely in the browser, built with **Three.js**, **Socket.IO**, and **Node.js/Express**.

---

## Features

- **3D first-person view** — Three.js WebGL renderer with shadows, fog, and dynamic lighting  
- **1v1 matchmaking** — players join a queue and are automatically paired  
- **Best-of-5 series** — rounds tracked per session; first to 3 round wins takes the series  
- **Full movement** — WASD walk, Space jump, Shift squat, with smooth camera transitions  
- **Aim Down Sights (ADS)** — right-click toggles iron-sight view with FOV zoom and centred gun  
- **Magazine & reload system** — 30-round magazine, R to reload, total reserve ammo tracked  
- **Bullet tracers** — yellow tracer line from muzzle tip to impact or max range (40 m)  
- **Hit feedback** — red blood particles, white mesh flash, and crosshair hit marker on connect  
- **Obstacle collision** — bullets stop at walls and cover; step-up / step-down stair traversal  
- **Opponent rendering** — networked opponent body + head mesh with squat/jump animation  
- **Impact particles** — orange sparks on obstacles, red blood on player hits  
- **Scoreboard HUD** — live series score shown top-centre throughout the match  

---

## Arena Layout

The 50 x 50 m arena contains:

| Feature | Description |
|---|---|
| Windowed bunkers | Two walls (z = +/-6) with shoot-through window openings |
| Raised platforms | 2 m platforms at x = +/-16, accessible via 4-step staircases |
| Cover boxes | Low and mid-height crates scattered across the centre |
| Boundary walls | 6 m tall walls on all four sides |

Spawn points are diagonal corners: Player 1 at (-20, -20), Player 2 at (+20, +20), each facing the centre.

---

## Controls

| Input | Action |
|---|---|
| W A S D | Move |
| Mouse | Look |
| Left Click | Shoot |
| Right Click | Toggle ADS (Aim Down Sights) |
| Space | Jump |
| Shift | Squat |
| R | Reload |

---

## Project Structure

```
sabb_2026_roadshow/
├── backend/
│   ├── server.js        # Express + Socket.IO game server
│   └── package.json
└── frontend/
    ├── index.html       # Game UI (lobby, HUD, result screens)
    ├── css/
    │   └── style.css    # HUD, scoreboard, overlays
    └── js/
        └── main.js      # Three.js renderer, game loop, socket client
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Renderer | Three.js 0.150.0 |
| Networking | Socket.IO 4.5.4 (WebSocket-only) |
| Server | Node.js + Express 4 |
| Transport | window.location.origin (auto IP detection via os.networkInterfaces()) |

---

## Getting Started

### Prerequisites

- Node.js >= 18

### Install & Run

```bash
cd backend
npm install       # or: bun install
npm start         # starts on port 3000
```

Open two browser tabs (or two devices on the same network) at:

```
http://localhost:3000
```

Both players enter a username and click **Join** — the game starts automatically when two players are queued.

---

## Game Rules

1. Each round ends when a player's HP reaches 0.  
2. The first player to win **3 rounds** wins the series.  
3. Between rounds there is a 3-second break before the next round starts automatically.  
4. Damage values: **body hit = 10 HP**, **head hit = 25 HP**.  
5. Disconnecting forfeits the current round.
