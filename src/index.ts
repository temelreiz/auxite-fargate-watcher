// --- ENV ---
const {
  WS_URL,
  WS_ORIGIN = "https://wallet.auxite.io",
  HTTP_URL,
  CHAIN = "base",
  ORACLES = "",
  WEBHOOK_URL,
  WEBHOOK_SECRET,
  ROLLUP_WINDOW_SEC = "0",
} = process.env as Record<string, string>;

if (!WS_URL) throw new Error("WS_URL missing");
if (!WEBHOOK_URL) throw new Error("WEBHOOK_URL missing");

// --- WebSocket polyfill with Origin header ---
import * as Isows from "isows";

const BaseWS =
  (Isows as any).WebSocket ||
  (Isows as any).default ||
  (Isows as any);

class OriginWebSocket extends BaseWS {
  constructor(url: string, protocols?: any) {
    super(url, protocols, {
      headers: {
        Origin: WS_ORIGIN,
      },
    });
  }
}

(globalThis as any).WebSocket = OriginWebSocket as any;

// --- imports (viem + etc) ---
import {
  createPublicClient,
  webSocket,
  http,
  parseAbiItem,
  type Address,
  type Log,
  type Chain,
} from "viem";
import type { AbiEvent } from "abitype";
import { base, baseSepolia, sepolia } from "viem/chains";
import crypto from "crypto";
import { request } from "undici";

const log = (...a: any[]) => console.log(new Date().toISOString(), ...a);
const warn = (...a: any[]) =>
  console.warn(new Date().toISOString(), "[WARN]", ...a);
const err = (...a: any[]) =>
  console.error(new Date().toISOString(), "[ERR] ", ...a);

// --- Chain ---
const chain: Chain =
  CHAIN === "base-sepolia"
    ? baseSepolia
    : CHAIN === "sepolia"
    ? sepolia
    : base;

// --- Clients ---
const wsTransport = webSocket(WS_URL);
const wsClient = createPublicClient({ chain, transport: wsTransport });
const httpClient = HTTP_URL
  ? createPublicClient({ chain, transport: http(HTTP_URL) })
  : null;

// --- Events ---
const evPriceUpdated = parseAbiItem(
  "event PriceUpdated(uint256 priceE6, address updater, uint256 ts)"
) as unknown as AbiEvent;

type Update = {
  symbol: string;
  priceE6: string;
  ts: number;
};

let buffer: Update[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function schedulePost() {
  const roll = Number(ROLLUP_WINDOW_SEC || "0");
  if (roll <= 0) {
    void postUpdates();
    return;
  }
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void postUpdates();
  }, roll * 1000);
}

async function postUpdates() {
  if (buffer.length === 0) return;

  const batch = buffer.splice(0, buffer.length);

  const payload = JSON.stringify({
    ts: Math.floor(Date.now() / 1000),
    prices: batch,
  });

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (WEBHOOK_SECRET) {
    const sig = crypto
      .createHmac("sha256", WEBHOOK_SECRET)
      .update(payload)
      .digest("hex");
    headers["x-oracle-signature"] = `sha256=${sig}`;
  }

  try {
    const res = await request(WEBHOOK_URL, {
      method: "POST",
      headers,
      body: payload,
    });
    if (res.statusCode >= 200 && res.statusCode < 300) {
      log(`POST ${WEBHOOK_URL} OK (${batch.length})`);
    } else {
      warn(`POST ${WEBHOOK_URL} status=${res.statusCode}`);
    }
  } catch (e) {
    err("POST failed", e);
  }
}

function handleWsMessage(msg: any) {
  if (!msg || msg.type !== "prices" || !Array.isArray(msg.data)) return;
  // Beklenen: AUXG, AUXS, AUXPT, AUXPD fiyatları (price per gram e6)
  const updates: Update[] = msg.data.map((p: any) => ({
    symbol: p.symbol,
    priceE6: String(p.priceE6 ?? p.price_e6 ?? p.price ?? 0),
    ts: Number(p.ts ?? Date.now() / 1000),
  }));
  buffer.push(...updates);
  schedulePost();
}

async function startWs() {
  log(`Connecting WS: ${WS_URL} (Origin=${WS_ORIGIN})`);

  // viem client zaten global WebSocket'i kullanacak (Origin header’lı)
  (wsClient as any).subscribe({
    // low-level: viem versiyonuna göre değişir; yoksa direkt raw ws kullanılır.
  });

  // Eğer doğrudan ws ile dinliyorsan:
  const ws = new OriginWebSocket(WS_URL);
  ws.onmessage = (ev: any) => {
    try {
      const data = JSON.parse(ev.data.toString());
      handleWsMessage(data);
    } catch (e) {
      err("WS message parse error", e);
    }
  };
  ws.onerror = (e: any) => {
    err("WS error", e?.message || e);
  };
  ws.onopen = () => {
    log("WS connected");
  };
  ws.onclose = () => {
    warn("WS closed");
  };
}

async function main() {
  log(`Watcher starting (TD=WS gram feed)`);
  await startWs();
  setInterval(() => log("alive / buffer:", buffer.length), 60_000);
}

process.on("SIGTERM", async () => {
  log("SIGTERM received, flushing...");
  await postUpdates();
  process.exit(0);
});
process.on("SIGINT", async () => {
  log("SIGINT received, flushing...");
  await postUpdates();
  process.exit(0);
});

void main();
