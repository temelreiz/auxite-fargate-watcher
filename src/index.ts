import * as IsoWS from "isows";
import crypto from "crypto";
import { request } from "undici";

const log = (...a: any[]) => console.log(new Date().toISOString(), ...a);
const warn = (...a: any[]) =>
  console.warn(new Date().toISOString(), "[WARN]", ...a);
const err = (...a: any[]) =>
  console.error(new Date().toISOString(), "[ERR] ", ...a);

// --- ENV ---

const {
  WS_URL,
  WS_ORIGIN,
  WEBHOOK_URL,
  WEBHOOK_SECRET,
  NODE_ENV = "production",
} = process.env as Record<string, string>;

if (!WS_URL) throw new Error("WS_URL missing");
if (!WEBHOOK_URL) throw new Error("WEBHOOK_URL missing");

// --- WebSocket client with Origin header (Cloudflare için) ---

const BaseWebSocket =
  (IsoWS as any).WebSocket ||
  (IsoWS as any).default ||
  (IsoWS as any);

class OriginWebSocket extends BaseWebSocket {
  constructor(url: string, protocols?: any, options?: any) {
    // ws signature: (url, protocols?, options?)
    if (protocols && typeof protocols === "object" && !Array.isArray(protocols)) {
      options = protocols;
      protocols = undefined;
    }

    options = options || {};
    if (WS_ORIGIN) {
      options.headers = {
        ...(options.headers || {}),
        Origin: WS_ORIGIN,
      };
    }

    super(url, protocols, options);
  }
}

// --- Types ---

type FeedPrice = {
  symbol: string;
  // server tarafının payload adlandırmasına göre esneklik:
  priceGram?: number;
  price_g?: number;
  price?: number;
};

type FeedMessage = {
  type: string;
  data?: FeedPrice[];
};

type OracleUpdate = {
  symbol: string;
  pricePerGram: number;
  ts: number;
};

// --- State ---

let lastHeartbeat = Date.now();

// --- Helpers ---

function extractPricePerGram(p: FeedPrice): number | null {
  if (typeof p.priceGram === "number") return p.priceGram;
  if (typeof p.price_g === "number") return p.price_g;
  if (typeof p.price === "number") return p.price;
  return null;
}

async function postUpdates(updates: OracleUpdate[]) {
  if (!updates.length) return;

  const payload = JSON.stringify({
    ts: Math.floor(Date.now() / 1000),
    prices: updates,
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
    const res = await request(WEBHOOK_URL!, {
      method: "POST",
      headers,
      body: payload,
    });

    if (res.statusCode >= 200 && res.statusCode < 300) {
      log(
        `POST ${WEBHOOK_URL} OK (${updates.length} symbols: ${updates
          .map((u) => u.symbol)
          .join(",")})`
      );
    } else {
      warn(`POST ${WEBHOOK_URL} status=${res.statusCode}`);
    }
  } catch (e) {
    err("POST failed", e);
  }
}

function handleMessage(raw: string) {
  let msg: FeedMessage;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }

  if (msg.type !== "prices" || !Array.isArray(msg.data)) return;

  const wanted = new Set(["AUXG", "AUXS", "AUXPT", "AUXPD"]);

  const updates: OracleUpdate[] = [];

  for (const p of msg.data) {
    if (!p || !p.symbol || !wanted.has(p.symbol)) continue;
    const price = extractPricePerGram(p);
    if (price == null || !isFinite(price)) continue;

    updates.push({
      symbol: p.symbol,
      pricePerGram: price,
      ts: Math.floor(Date.now() / 1000),
    });
  }

  if (updates.length) {
    log(
      `Received prices: ${updates
        .map((u) => `${u.symbol}=${u.pricePerGram}`)
        .join(" ")}`
    );
    void postUpdates(updates);
  }
}

// --- Main loop ---

function connect() {
  log(`Connecting to WS ${WS_URL} (origin=${WS_ORIGIN || "-"})`);

  const ws = new OriginWebSocket(WS_URL);

  ws.onopen = () => {
    log("WS connected");
    lastHeartbeat = Date.now();
  };

  ws.onmessage = (ev: any) => {
    lastHeartbeat = Date.now();
    const data =
      typeof ev.data === "string" ? ev.data : ev.data?.toString?.() ?? "";
    if (!data) return;
    handleMessage(data);
  };

  ws.onerror = (ev: any) => {
    err("WS error", ev?.message || ev);
  };

  ws.onclose = (ev: any) => {
    warn(
      `WS closed code=${ev?.code} reason=${ev?.reason || ""}, reconnecting...`
    );
    setTimeout(connect, 3000);
  };
}

// --- Health log ---

setInterval(() => {
  const diff = Math.floor((Date.now() - lastHeartbeat) / 1000);
  log(`alive / lastMessageAgo=${diff}s`);
}, 60_000);

// --- Start ---

log(
  `Auxite watcher starting (mode=price-feed, url=${WS_URL}, env=${NODE_ENV})`
);
connect();
