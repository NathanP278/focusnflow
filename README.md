# Focus & Flow (`focusnflow`)

> Apple-Grade Minimalist Pomodoro & Focus Workspace with drift-free Web Worker timer, procedural Web Audio soundscapes, 60fps reactive canvas particle engine, Picture-in-Picture floating countdown, dynamic pastel themes, and zero-dependency SQLite persistence.

---

## Highlights & Features

- **Drift-Free Precision Timer**: Dedicated Web Worker clock isolated from browser tab sleep and background throttling. Supports Work (25m), Short Break (5m), and Long Break (15m) with automatic cycle progression.
- **Picture-in-Picture (PiP) Floating HUD**: Real-time canvas stream rendered into a native PiP window, keeping session time and active tasks visible across all desktop applications.
- **Procedural Web Audio Engine**: 100% synthetic soundscapes (Rain, White Noise, Ocean Waves, Stream) and acoustic completion chimes (Bowl, Marimba, Bell, Synth) synthesized live via native Web Audio API — zero external audio assets.
- **Reactive Particle Field**: 60fps HTML5 canvas with mouse repulsion, ambient floating physics, and Page Visibility auto-throttling to conserve GPU and battery.
- **Universal Dynamic Theming**: 5 carefully curated pastel color palettes (Sunset Peach, Forest Mint, Cosmic Lilac, Deep Ocean, OLED Monochrome) with light/dark/auto mode support.
- **Zero-Dependency Native Backend**: Node 24 REST API with embedded `node:sqlite` database, WAL mode, foreign key integrity, atomic transactions, and automated test suite.
- **Offline-First Resilience**: Automatic fallback to `localStorage` when server is unreachable, with seamless state hydration on reconnection.

---

## Tech Stack

| Layer | Technologies |
|---|---|
| **Frontend** | TypeScript 5.8, Vite 6.2, Vanilla Reactive Store |
| **Styling** | Native Modern CSS with CSS custom properties, responsive grid, and fluid typography |
| **Audio** | Native Web Audio API (procedural synthesis, biquad filters, LFO modulation) |
| **Graphics** | HTML5 2D Canvas API (particle system & PiP stream generator) |
| **Backend** | Node 24 native HTTP server + native `node:sqlite` |
| **Testing** | Node native test runner (`node:test`), Playwright e2e |

---

## Project Structure

```
focusnflow/
├── index.html              # Clean semantic HTML5 application shell
├── package.json            # Scripts and dev dependencies
├── tsconfig.json           # TypeScript strict configuration
├── vite.config.ts          # Vite bundler & API reverse proxy
├── test-e2e.py             # Playwright end-to-end browser test suite
├── server/
│   ├── index.mjs           # Zero-dependency Node.js + SQLite REST API
│   └── test.mjs            # 21 integration and security test cases
└── src/
    ├── main.ts             # Application bootstrapper & event orchestrator
    ├── style.css           # Design tokens, layouts, pastel themes, and animations
    └── core/
        ├── types.ts        # TypeScript data models and interfaces
        ├── store.ts        # Observable reactive state container
        ├── store.test.ts   # State container assertion test suite
        ├── worker-timer.ts # Web Worker background timer
        ├── audio.ts        # Procedural sound synthesizer
        ├── particles.ts    # Interactive canvas physics engine
        ├── pip.ts          # Picture-in-Picture canvas stream renderer
        └── api.ts          # Backend REST API client with local storage sync
```

---

## Getting Started

### Prerequisites
- **Node.js**: v22.0.0+ (requires native `node:sqlite` support)
- **npm**: v10.0.0+
- **Python 3.10+** (optional, for end-to-end tests)

### Installation

```bash
# Clone the repository
git clone https://github.com/NathanP278/focusnflow.git
cd focusnflow

# Install development dependencies
npm install
```

### Running the Application

```bash
# Run both Vite frontend and backend API concurrently (or in two terminals)
npm run server   # Starts backend on http://localhost:3001
npm run dev      # Starts frontend dev server on http://localhost:5173
```

Visit `http://localhost:5173` in your browser.

### Testing & Verification

```bash
# Run backend integration, security, and SQLite transaction tests
npm run test:server

# Run TypeScript typecheck
npm run typecheck

# Build production bundle
npm run build

# Run Playwright E2E tests (optional)
npm run test:e2e
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Space` | Start / Pause timer |
| `R` | Reset current timer interval |
| `S` | Skip to next interval mode |
| `N` | Focus new task input |
| `P` | Toggle Picture-in-Picture floating HUD |
| `A` | Toggle ambient background soundscape |
| `M` | Cycle color theme palette |
| `D` | Toggle Dark / Light mode |
| `?` | Open keyboard shortcuts cheatsheet |
| `Esc` | Close open modal dialogs |

---

## License

MIT License.
