# Auxite Oracle Watcher (Fargate)

## Quick start (local)
```
npm ci
npm run build
WS_URL=wss://... CHAIN=base-sepolia ORACLES=0x... WEBHOOK_URL=https://... WEBHOOK_SECRET=secret node dist/index.js
```

## Docker
```
docker build -t auxite-oracle-watcher .
docker run --rm -e WS_URL=... -e CHAIN=base-sepolia -e ORACLES=0x... -e WEBHOOK_URL=... -e WEBHOOK_SECRET=... auxite-oracle-watcher
```

## Env
- WS_URL: WebSocket RPC (Alchemy/Infura/Ankr) — WS **required**
- CHAIN: base | base-sepolia | sepolia
- ORACLES: CSV addresses
- WEBHOOK_URL: Next.js API endpoint to receive updates
- WEBHOOK_SECRET: HMAC secret used as x-oracle-signature (sha256=...)
- ROLLUP_WINDOW_SEC: batch interval
