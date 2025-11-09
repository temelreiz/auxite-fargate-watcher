import WebSocket, { RawData } from "ws";
import axios from "axios";

// ---- Env config ----
const WS_URL = process.env.WS_URL || "wss://api.auxite.io/ws/prices";
const WS_ORIGIN = process.env.WS_ORIGIN || "https://wallet.auxite.io";

const CHAIN = (process.env.CHAIN || "base").toLowerCase();

const ORACLES = (process.env.ORACLES || "")
  .split(",")
  .map((a) => a.trim().toLowerCase())
  .filter(Boolean);

const WEBHOOK_URL = process.env.WEBHOOK_URL || "";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";

const DEBUG_WS = (process.env.DEBUG_WS || "false").toLowerCase() === "true";

if (!WEBHOOK_URL) {
  console.error("Missing WEBHOOK_URL env");
}

if (!WEBHOOK_SECRET) {
  console.error("Missing WEBHOOK_SECRET env");
}

// ---- Types ----
interface PriceMessage {
  chain: string;
  oracle: string;
  payload: unknown;
  [key: string]: unknown;
}

// ---- State ----
let ws: WebSocket | null = null;
let reconnectTimeout: NodeJS.Timeout | null = null;
let aliveLogInterval: NodeJS.Timeout | null = null;
let buffer: PriceMessage[] = [];

// ---- Helpers ----
function log(...args: unknown[]) {
  // production'da çok gürültü olmasın dersen DEBUG_WS ile kontrol
  if (DEBUG_WS) {
    console.log(...args);
  }
}

function connect() {
  if (ws) {
    try {
      ws.terminate();
    } catch {
      // ignore
    }
    ws = null;
  }

  log("Connecting to WS:", WS_URL);

  ws = new WebSocket(WS_URL, {
    headers: {
      // Origin header'ı burada önemli: API Cloudflare/ALB bu header'a bakıyor
      Origin: WS_ORIGIN,
    },
  });

  ws.on("open", () => {
    console.log("WS connected:", WS_URL);

    // alive log
    if (aliveLogInterval) clearInterval(aliveLogInterval);
    aliveLogInterval = setInterval(() => {
      console.log(
        `${new Date().toISOString()} alive / buffer: ${buffer.length}`
      );
    }, 60_000);
  });

  ws.on("message", (data: RawData) => {
    try {
      const text = data.toString("utf8");
      const msg = JSON.parse(text) as PriceMessage;

      // chain filter
      if (msg.chain && msg.chain.toLowerCase() !== CHAIN) {
        return;
      }

      // oracle filter (varsa)
      if (
        ORACLES.length > 0 &&
        msg.oracle &&
        !ORACLES.includes(msg.oracle.toLowerCase())
      ) {
        return;
      }

      buffer.push(msg);
    } catch (err) {
      console.error("Failed to parse WS message:", err);
    }
  });

  ws.on("error", (err: Error) => {
    console.error("WS error:", err.message || err);
  });

  ws.on("close", (code: number, reason: Buffer) => {
    console.warn(
      `WS closed: code=${code}, reason=${reason.toString("utf8") || "n/a"}`
    );

    if (aliveLogInterval) {
      clearInterval(aliveLogInterval);
      aliveLogInterval = null;
    }

    // Otomatik reconnect
    if (!reconnectTimeout) {
      reconnectTimeout = setTimeout(() => {
        reconnectTimeout = null;
        connect();
      }, 5000);
    }
  });
}

async function flushBuffer() {
  if (!WEBHOOK_URL || buffer.length === 0) return;

  const batch = buffer;
  buffer = [];

  try {
    await axios.post(
      WEBHOOK_URL,
      {
        chain: CHAIN,
        events: batch,
      },
      {
        headers: {
          "Content-Type": "application/json",
          "X-Auxite-Webhook-Secret": WEBHOOK_SECRET,
        },
        timeout: 10_000,
      }
    );
    log(`Flushed ${batch.length} events to webhook`);
  } catch (err: any) {
    console.error(
      "Failed to POST webhook:",
      err?.response?.status,
      err?.response?.data || err?.message || err
    );
    // Başarısız olursa batch'i kaybetmeyelim:
    buffer = [...batch, ...buffer];
  }
}

// ---- Start ----
connect();

// Her 5 saniyede bir buffer flush
setInterval(flushBuffer, 5000);
