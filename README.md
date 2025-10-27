# Auxite Fargate Watcher
Oracle eventlerini WS üzerinden dinler ve webhook'a POST eder.
## Çalıştırma
npm i && npm run build
WEBHOOK_URL="http://localhost:3000/api/oracle-hook" node dist/index.js
