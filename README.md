# Pea Militia

A browser game about a pea and its militia. Live at https://pea-militia.avadlabs.workers.dev

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
z-fighting (coplanar overlapping faces, depth precision); per-animation-phase grounding, clipping,
loose parts and collider coverage; camera collisions with the plate and pea; default framing on
desktop, phone and landscape; UI overlap; the recenter button by mouse click, keyboard and touch tap;
touch orbit and pinch; console errors; and turntable plus close-up renders saved to `test-output/`.

## Deploy

Pushes to `main` run `.github/workflows/deploy.yml`, which needs the repo secrets
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
