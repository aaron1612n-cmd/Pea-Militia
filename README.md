# Steel Meridian

A browser game about a combined-arms field battle. Live at https://steel-meridian.avadlabs.workers.dev

## Develop

```sh
npm install
npm run dev        # local dev server
npm run build      # vite build + embed dist/ into the Worker
npm run check      # automated check suite against a local preview (BASE_URL=... to check the live site)
npm run deploy     # build + wrangler deploy
```

## Check suite (`tests/check.mjs`)

Every build must pass. It covers: closed, outward-facing meshes (no gaps or see-through faces);
z-fighting; grounding, clipping, loose parts and collider coverage for every idle, walk, jump and
land pose; the follow camera staying out of the plate and the pea; framing on desktop, phone and
landscape; UI overlap; keyboard walking, turning, jumping and the edge fall/respawn; pointer lock
and mouse look; the phone stick, look drag and jump button; the help button by click and tap;
console errors; and turntable, close-up and animation renders saved to `test-output/`.

## Controls

Desktop: click to lock the mouse, WASD or arrows to move, mouse to look, Space to jump, H or `?` replays the prompts.
Phone: left thumb moves (floating stick), right thumb looks, the arrow button jumps.

## Deploy

Deploys run from Claude sessions with `npm run deploy` (no GitHub Actions deploy). PRs run the check suite in CI.
