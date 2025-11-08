import WebSocket from "ws";
import axios from "axios";

const WS_URL = process.env.WS_URL || "wss://api.auxite.io/ws/prices";
const WS_ORIGIN =
  process.env.WS_ORIGIN || "https://wallet.auxite.io"; // TD'de zaten bu var

const WEBHOOK_URL =
  process.env.WEBHOOK_URL || "https://wallet.auxite.io/api/oracle-hook";
const WEBHOOK_SECRET =
  process.env.WEBHOOK_SECRET || "auxite-shared-secret";

const CHAIN = process.env.CHAIN || "base";

const ALIVE_LOG_INTERVAL_MS = 60_000;

type PriceMessage = {
  type: string;
  chain?: string;
  [key: string]: any;
};

let buffer: PriceMessage[] = [];
let ws: WebSocket | null = null;
let lastAliveLog = Date.now();

function logAlive() {
  const now = Date.now();
  if (now - lastAliveLog >= ALIVE_LOG_INTERVAL_MS) {
    console.log(
      new Date().toISOString(),
      "alive / buffer:",
      buffer.length
    );
    lastAliveLog = now;
  }
}

async function flushBuffer() {
  if (!buffer.length) return;
  const batch = buffer;
  buffer = [];

  try {
    await axios.post(
      WEBHOOK_URL,
      { events: batch },
      {
        headers: {
          "Content-Type": "application/json",
          "x-webhook-secret": WEBHOOK_SECRET,
        },
        timeout: 10_000,
      }
    );
  } catch (err: any) {
    console.error("flushBuffer error:", err?.message || err);
    // hata olursa batch'i geri ekleyelim ki kaybetmeyelim
    buffer.unshift(...batch);
  }
}

function createWebSocket() {
  const headers: Record<string, string> = {};

  if (WS_ORIGIN) {
    headers["Origin"] = WS_ORIGIN;
  }

  // Debug için bir kere logla
  console.log(
    `[WS] connecting to ${WS_URL} with Origin=${headers["Origin"] || "-"
    }`
  );

  ws = new WebSocket(WS_URL, { headers });

  ws.on("open", () => {
    console.log("[WS] connected");
  });

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString()) as PriceMessage;

      // chain filtresi vs gerekiyorsa burada:
      if (CHAIN && msg.chain && msg.chain !== CHAIN) return;

      buffer.push(msg);
      logAlive();

      if (buffer.length >= 50) {
        void flushBuffer();
      }
    } catch (err: any) {
      console.error("onMessage parse error:", err?.message || err);
    }
  });

  ws.on("error", (err) => {
    console.error("[WS] error:", err);
  });

  ws.on("close", (code, reason) => {
    console.error(
      `[WS] closed code=${code} reason=${reason.toString()} — reconnecting...`
    );
    ws = null;

    setTimeout(() => {
      createWebSocket();
    }, 3_000);
  });
}

// periyodik flush (buffer dolmasa bile)
setInterval(() => {
  void flushBuffer();
}, 5_000);

// başlangıç
createWebSocket();
logAlive();
