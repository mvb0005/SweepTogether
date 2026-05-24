# SweepTogether — Frontend Direction

**Companion to:** `GAMEPLAY_DESIGN.md` and `GAMEPLAY_BUILD_STEPS.md`.
**Purpose:** Where the frontend is heading. Three questions to answer here:

1. **What renders the board?** SVG (current) vs Canvas vs WebGL. This is the substrate question.
2. **What runs the app?** Web-only vs PWA vs Capacitor wrapper vs React Native. This is the platform question.
3. **What does mobile actually feel like?** Touch input, layout, performance budgets.

These three are coupled. Decide them together or you'll lock yourself out of an option.

---

## 1. Rendering substrate — the most important decision

### Where we are now

`BoardSVG.tsx` renders each visible cell as its own SVG `<rect>`/`<text>`. At chunk size 16×16, a typical phone viewport shows roughly 12×20 = 240 cells, plus the buffered chunks around it — call it 600 elements on screen. That's well inside the comfort zone where SVG works fine: SVG works beautifully up to a few thousand elements, then degrades quickly, with the cliff typically appearing around 3k-5k elements.

So SVG is *currently* fine. The question is whether it stays fine as we add features.

### What pushes us toward Canvas

The gameplay roadmap quietly increases per-frame element count:

- **Player avatars** — small but every other player adds elements.
- **Biome footprints / boundaries** — overlays per biome, potentially with patterned fills.
- **Other-player activity ripples** — short-lived animated elements that pile up if many players are active.
- **Minimap** — its own scaled-down board representation, hundreds more elements.
- **Reveal animations on flood fill** — staggered transforms across dozens of cells, all simultaneously.
- **Avatar trails, particle effects, gate open animations** — polish-tier features that all want to be on the same canvas as the cells.

Once you push past ~3k animated elements on a mobile GPU, SVG falls off a cliff. The Felt team's writeup is the cleanest case study of exactly this transition: Felt's interactive maps can be very performance-intensive, rendering thousands of elements on-screen at once. The fast performance of complex maps is one of the things our users love, and we pride ourselves on, and it's one reason we recently switched our map element rendering from using SVGs with React, to using Canvas. Their specific pain point will be ours: Asking React to create, diff, reconcile and update thousands of elements on every move of the mouse when panning or zooming the map gets slow.

The honest performance picture: Canvas is purely pixel-based and can handle thousands of objects much more efficiently, making it a better choice for extensive graphics scenes, real-time graphics. And specifically for games: For graphics-intensive, highly interactive games, as well as for generative art, Canvas is generally the way to go.

### What keeps us on SVG (for now)

- **CSS styling is free.** Biome colours, hover states, animations — all declarative.
- **React reconciliation does the work.** We don't write a render loop.
- **Interactions are trivial.** Each cell is a DOM node with onClick. Migrating to Canvas means writing our own hit testing.
- **Accessibility works.** Screen readers can be made to understand SVG. Canvas is fundamentally a black box to screen readers. You must build a parallel "accessibility tree".

### The recommendation

**Stay on SVG through Step 4 (vault biome). Migrate to Canvas for Step 8 (polish pass), or earlier if Step 7's biome variety pushes us past the cliff first.**

Reasons in order:

1. **The current architecture lets us swap renderers cleanly.** `BoardSVG.tsx` is one component reading from `ChunkLoader` + `ViewportContext` + `GameContext`. Replacing it with `BoardCanvas.tsx` doesn't touch the data flow. This makes the deferral safe.
2. **We don't know what we don't know.** Performance ceilings are real but element-count-dependent, and we're guessing about feature density. Measure before optimising.
3. **The transition has a known shape.** When we migrate, we know what to do — Felt's writeup is essentially a template.

Concrete migration trigger: when the 50th-percentile frame on a mid-tier Android device (think a 3-year-old phone, not an iPhone 16) drops below 50fps during a flood-fill reveal animation in a vault, we migrate. Until then, SVG.

### What "migrate" actually means

When the time comes:

- Replace `BoardSVG` with a `<canvas>` rendered via a single React component that has its own animation loop (`requestAnimationFrame`).
- Build a small hit-test layer: given mouse `(x, y)`, return the cell underneath. This is trivial for a grid — divide by `CELL_SIZE`, done.
- Keep avatars, tooltips, and minimap as separate SVG/DOM overlays on top of the canvas. It's possible to combine HTML5 Canvas and SVG for advanced scenarios. Sparse UI elements stay in SVG; the dense grid moves to canvas.
- React still owns *state*. Canvas just owns *pixels*. The boundary should feel like React → state changes → "redraw" signal → canvas renderer reads state. No two-way binding.

A `PixiJS` layer is overkill for our needs — a plain 2D canvas with `ctx.fillRect` calls for cells, `ctx.fillText` for numbers, sprite atlases for icons is sufficient and easier to reason about than introducing a scene-graph library.

### What about WebGL?

Skip it. Use WebGL if you need 3D or specialized GPU effects. Don't optimize prematurely. A 2D Minesweeper grid with thousands of cells is solidly in 2D-canvas territory. WebGL would be a flex with no payoff.

---

## 2. Platform strategy — how we get to mobile

### The options, with honest tradeoffs

**Option A: PWA only.** Mobile users add the web app to home screen. Service worker for offline. No app store presence.

- *Pros:* Zero new infrastructure. Single codebase. Already 90% there.
- *Cons:* Discovery sucks. iOS PWAs are still second-class citizens (push notifications limited, install prompt is hidden under the share menu). No leaderboards or achievements in any store.

**Option B: PWA + Capacitor wrapper.** Same web app, packaged into native iOS/Android shells via Capacitor. Distributed via App Store and Play Store.

- *Pros:* Capacitor is compatible with any JavaScript framework as well as vanilla JavaScript — keeps our React/Vite/TS stack. Capacitor is perfect for web developers to hit the ground running building mobile applications. Single codebase. App store distribution. Native APIs (haptics, share sheet, etc.) when needed.
- *Cons:* WebView performance ceiling. Capacitor runs in a WebView, which can limit smoothness and animation performance compared to Flutter's Skia engine or React Native's native component bridge. Once we hit that ceiling we'd need a Canvas/WebGL renderer to push through it (see §1 — we were planning that anyway).

**Option C: React Native.** Rewrite the frontend in RN. Web becomes React Native Web.

- *Pros:* React Native, on the other hand, operates on a "learn once, write anywhere" principle with native UI rendering. Better feel on mobile.
- *Cons:* Significant rewrite. React Native Web is functional but lossy for canvas-style rendering. If you're making an app with detailed, real-time charts or a social feed full of complex swipe animations, React Native has the edge — but our app is a *grid renderer*, not a UI of native components. RN's advantage (native UI controls) is mostly wasted on a custom-rendered game.

**Option D: Flutter, native iOS/Android.** Hard pass. Different language, different team, doesn't share with web.

### The recommendation

**Option B: PWA-first with a Capacitor wrapper when we want app store presence.**

The logic chain:

1. The game *is* a web app. The whole architecture (Socket.IO chunks, React state, SVG/Canvas rendering) is web-native.
2. If you already have a web app, Capacitor gets you into the App Store and Google Play in days. The marginal cost of supporting native distribution is small.
3. The WebView performance ceiling Capacitor inherits *is the same ceiling SVG-in-browser already has*. Solving it once (canvas migration in §1) solves it everywhere.
4. React Native's win is irrelevant for our shape of app. We're not rendering native buttons; we're rendering a grid. Going RN would mean either rendering the grid in a `WebView` inside RN (worst of both worlds) or porting our renderer to RN's Skia/Reanimated stack (huge effort).

### Phasing

| Phase | Deliverable | When |
|---|---|---|
| 1 | Strong PWA — service worker, install prompt, offline shell, web manifest, icons | Concurrent with Steps 1–4 |
| 2 | Touch input works as well as mouse | During Steps 1–2 (movement) |
| 3 | Capacitor wrap, iOS/Android builds, ship to TestFlight / Play internal track | After Step 6 (when game is feature-complete enough to demo) |
| 4 | Submit to app stores | After Step 8 (polish), assuming it survives Phase 3 testing |

### What "strong PWA" means concretely

- **`manifest.webmanifest`** with app name, description, icons at 192/512/1024px, theme colour, `display: standalone`, `start_url: "/"`.
- **Service worker** caching the app shell + static assets. Use Workbox via `vite-plugin-pwa` — well-trodden ground.
- **Offline behaviour:** show "can't connect" UI when socket is down, not a broken board. The game requires connectivity (it's multiplayer); offline means a clear "reconnecting…" state, not pretending to work.
- **Install prompt:** beforeinstallprompt event, custom UI nudge after the user has played for ~5 minutes (not on first load — be polite).
- **Web Push?** Out of scope. Nothing in the game pushes notifications. If we ever add "your friend revealed your vault" alerts, revisit.

---

## 3. Mobile UX — the actually hard part

The platform decision is easy compared to making touch input feel right. A Minesweeper-style game has three actions that all want different gestures on mobile: reveal, flag, chord. Plus movement (Step 1) and pan (look-ahead). That's five gestures contending for two thumbs.

### Input scheme

The current desktop scheme is: left-click reveal, right-click flag, double-click chord, drag pan, arrows move (Step 1).

Mobile mapping:

| Action | Desktop | Mobile |
|---|---|---|
| Reveal | left-click | tap |
| Flag | right-click | long-press (300ms) |
| Chord | double-click | double-tap |
| Pan camera | click-drag | two-finger drag |
| Move avatar | arrow keys | on-screen D-pad |
| Zoom (future) | scroll wheel | pinch |

Two problems jump out:

1. **Long-press vs tap conflict.** A user holding their finger down because they're thinking is a long-press. Need a visual flag-mode indicator: as soon as 200ms passes with a touch held, show the "flag" icon under the finger growing in. They get 100ms more to cancel by lifting. This is how mature mobile Minesweeper apps handle it.
2. **Tap accuracy on small cells.** Cells at default `CELL_SIZE = 30` are roughly 30 CSS px. iOS guidelines want 44pt minimum touch targets. Either (a) increase cell size on touch devices, (b) add a "magnifier loupe" under the finger, or (c) tap snaps to nearest cell (the cursor is *inferred* as one cell ahead of the finger, kept visible).

**Recommendation: (a) + (c).** On touch devices, `CELL_SIZE` jumps to 44px. The visible avatar marker doubles as the "cursor" — tap-anywhere highlights the cell, tap-again confirms. This is essentially a "two-stage tap" — slightly slower but eliminates misclicks, which matter a lot in a game where misclicks lose you score.

Actually — that two-stage idea conflicts with reveal-tap-immediately. Pulling back: ship with single-tap reveal, see if misclicks are a real problem in playtest. If they are, add a "careful mode" toggle for two-stage. Don't pre-emptively make the game slower for everyone.

### Layout

Phone portrait orientation:

```
┌─────────────────────┐
│  status bar / score │  60px
├─────────────────────┤
│                     │
│                     │
│      board area     │  flex
│                     │
│                     │
│                     │
├─────────────────────┤
│  D-pad   │  actions │  120px
└─────────────────────┘
```

- Status bar: current score, player count, mute toggle, settings.
- Board: takes all remaining vertical space.
- D-pad bottom-left, three thumbs-reach action buttons bottom-right (Flag toggle, Chord toggle, Inventory).

The "Flag toggle" replaces long-press for users who find it awkward: tap it, the next tap places a flag instead of revealing. Tap the same cell again, it's revealed normally. This is how iOS Minesweeper apps have done it for 15 years. It works.

Landscape: same idea but D-pad left edge, action buttons right edge, board centre.

Tablet: closer to desktop layout — board takes most of the screen, optional D-pad as floating overlay (since they have more reach). Probably don't optimise heavily for tablet until we have a reason to.

### Performance budget for mobile

Targets:

- **First contentful paint:** <2s on a 3-year-old Android over LTE.
- **Time to interactive:** <4s on the same.
- **Frame rate during reveal animation:** ≥50fps on the same.
- **Bundle size:** <200KB gzipped JS for the initial chunk. (Vite + React + Socket.IO already puts pressure here.)

The bundle target is the hardest. Concretely:

- Lazy-load anything not needed for the first interaction (settings panel, inventory, minimap can all be code-split).
- Strip Socket.IO's polling transport if we don't need it — websocket-only saves ~20KB.
- Tree-shake aggressively. Drop any `lodash` use in favour of stdlib.

### Network

Socket.IO over websocket on mobile is reliable but lossy in poor networks. Things to do:

- **Reconnection UI.** When the socket drops, dim the board, show a "reconnecting…" toast. Buffer player input *locally* and replay on reconnect — this is generous to flaky networks.
- **Reduce chunk subscriptions on mobile.** Buffer = 1 instead of 2. Smaller viewport, less speculative loading.
- **Heartbeats.** Mobile OSes aggressively kill background socket connections. On `visibilitychange` "hidden", disconnect cleanly. On "visible", reconnect and re-subscribe to current chunks. Don't try to keep alive in the background — the OS will win that fight.

### Battery and thermals

A constantly-animating game drains batteries. Decisions:

- Cap animations at 60fps explicitly. Don't run at higher refresh rates on capable phones — battery cost is real.
- Pause animations when the player is idle (no input, no incoming updates) for 30 seconds. The board still updates from server events but doesn't run idle effects (pulsing avatars, etc.).
- Honour `prefers-reduced-motion`. Disable all decorative animations when set. This also helps battery as a side effect.

---

## 4. Cross-platform sanity checks

### Desktop is not "just bigger mobile"

A common mistake when going mobile-first is letting mobile constraints leak into desktop. Avoid:

- **Don't show the D-pad on desktop.** Detect input modality (`pointer: fine`) and hide it.
- **Don't make the cells huge on desktop.** They can be 30px or even smaller; users have a mouse.
- **Don't long-press on desktop.** Right-click is faster and conventionally correct.
- **Don't waste vertical space on a status bar.** Desktop has plenty of horizontal real estate — put status in the corners.

A `useInputModality` hook returns `'touch' | 'mouse' | 'keyboard'` based on the most recent input event. Components read it and adapt. This avoids the "feature-detect once at load" trap (users with both touch and mouse exist — laptops with touchscreens, iPad with Magic Keyboard).

### Browser support floor

Reasonable targets:

- iOS Safari 16+ (covers iPhone 8 and newer in practice).
- Chrome / Edge last 2 stable versions.
- Firefox last 2 stable versions.
- Samsung Internet last 2 versions (Android's de facto default browser for many users).

Don't waste time on IE-or-equivalent regressions. We have a known modern stack.

### Accessibility

Not optional. The Canvas migration (§1) makes this harder, but:

- **Keyboard navigation must work end-to-end.** Tab to focus the board, arrow keys to move a focus indicator cell-by-cell, space to reveal, F to flag, C to chord. This is also how power users will want to play on desktop.
- **Screen reader support** announces cell state on focus ("revealed, 3 adjacent mines" or "hidden, flagged"). For Canvas, this means maintaining a parallel ARIA tree — exactly what the Felt-style migration warns about. Worth doing.
- **Colour-blind palettes.** The classic 1-blue/2-green/3-red Minesweeper colours are *terrible* for the most common red-green colour blindness. Offer an alternate palette with shape modifiers (1 has a dot, 2 has two dots, etc.) as an opt-in.
- **Reduced motion** mentioned above.

---

## 5. Build order alignment

Mapping these decisions onto the existing Steps 1–8:

| Step | Frontend direction impact |
|---|---|
| 1 (avatar + movement) | First touch-input pass. Add `useInputModality`. Build D-pad for mobile. SVG still. |
| 2 (walls) | Nothing platform-specific. SVG. |
| 3 (biome lattice) | Biome overlays start adding element count. Profile here. SVG likely fine. |
| 4 (vault biome) | Gate tooltip needs mobile equivalent (tap gate for tooltip). SVG fine. |
| 5 (puzzle library) | Bundle size watch — puzzles.json could bloat. Lazy-load by difficulty tier. SVG fine. |
| 6 (gate requirements + rewards) | Inventory UI is a new panel — mobile bottom-sheet vs desktop sidebar. |
| 7 (more biomes) | Element count likely crosses migration threshold *somewhere here*. Profile carefully. May trigger early SVG→Canvas migration. |
| 8 (polish) | If not migrated already, migrate now. PWA finalised. Capacitor wrap begins in parallel. |

Two sessions of dedicated frontend-direction work likely fit between Steps 7 and 8:

- **Session N: Renderer migration.** SVG → Canvas. Hit-testing layer. Verify feature parity.
- **Session N+1: PWA + Capacitor.** Service worker, manifest, Capacitor scaffold, iOS and Android builds, TestFlight upload.

---

## 6. Decisions to make

Before any of this drives a session prompt:

- **Confirm PWA-first + Capacitor wrap as the path.** Alternative is RN, which is a different conversation.
- **Confirm SVG-now, Canvas-later as the substrate plan.** Alternative is migrating earlier, which front-loads cost but de-risks.
- **Confirm minimum mobile spec.** I'm assuming "3-year-old mid-tier Android over LTE." If the floor is higher (modern iPhones only), we can be more relaxed. If lower (old budget Android), the bundle and frame-rate budgets get harder.
- **Confirm app-store goal.** If we're never planning to put this on app stores, Capacitor is wasted effort. PWA-only is then sufficient. Honest answer: app stores still drive discovery, especially for games. Worth doing eventually.

---

## 7. What I'm *not* recommending and why

- **Three.js / WebGL.** Overkill for 2D grid. Don't do it.
- **React Native.** Wrong tool — we render a grid, not native UI. Migration cost dwarfs benefits.
- **Flutter.** Different ecosystem, language, team skill. Worth zero given the existing investment.
- **Vue / Svelte / Solid rewrite.** The React investment is fine. Don't fix what isn't broken.
- **Tauri.** Desktop wrapper for web apps. We don't have a desktop-app goal. Browser is enough for desktop.
- **Self-hosted game engine (PixiJS, Phaser).** Phaser is a real option for the eventual canvas migration but adds a layer of indirection. Plain Canvas 2D is simpler. Revisit if hand-rolled becomes painful.
- **Heavy state management library (Redux, Zustand, MobX).** Context + hooks have served the chunk-state pattern well. Adding Zustand later for one specific need is fine; don't migrate wholesale.

The discipline here is to recognise that the existing stack is actually well-chosen, and the cross-platform path runs *through* it, not around it.
