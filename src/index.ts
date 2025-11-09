import WebSocket from "ws";
import axios from "axios";

const WS_URL = process.env.WS_URL || "wss://api.auxite.io/ws/prices";
const WS_ORIGIN = process.env.WS_ORIGIN || "https://wallet.auxite.io";
const WEBHOOK_URL =
  process.env.WEBHOOK_URL || "https://wallet.auxite.io/api/oracle-hook";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "auxite-shared-secret";
const DEBUG_WS = process.env.DEBUG_WS === "true";

interface PriceMessage {
  type: string;
  [key: string]: any;
}

let ws: WebSocket | null = null;
let reconnectTimeout: NodeJS.Timeout | null = null;
let lastSequence = 0;

function log(...args: any[]) {
  console.log(new Date().toISOString(), ...args);
}

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  log("connecting to ws:", WS_URL, "Origin:", WS_ORIGIN);

  ws = new WebSocket(WS_URL, {
    headers: {
      Origin: WS_ORIGIN
    }
  });

  ws.on("open", () => {
    log("ws connected");
  });

  ws.on("message", (data: WebSocket.RawData) => {
    try {
      const text = data.toString();
      if (DEBUG_WS) {
        log("ws message:", text);
      }

      const msg: PriceMessage = JSON.parse(text);

      if (typeof msg.sequence === "number") {
        if (msg.sequence <= lastSequence) {
          return;
        }
        lastSequence = msg.sequence;
      }

      forwardToWebhook(msg).catch((err) => {
        log("webhook error:", err?.message || err);
      });
    } catch (err: any) {
      log("message parse error:", err?.message || err);
    }
  });

  ws.on("error", (err: Error) => {
    log("ws error:", err.message || err);
  });

  ws.on("close", (code: number, reason: Buffer) => {
    const reasonStr = reason?.toString() || "";
    log("ws closed:", code, reasonStr);
    scheduleReconnect();
  });
}

function scheduleReconnect() {
  if (reconnectTimeout) return;
  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = null;
    connect();
  }, 5000);
}

async function forwardToWebhook(payload: any) {
  try {
    await axios.post(
      WEBHOOK_URL,
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          "X-Auxite-Secret": WEBHOOK_SECRET
        },
        timeout: 5000
      }
    );
    if (DEBUG_WS) {
      log("webhook sent");
    }
  } catch (err: any) {
    log("webhook post failed:", err?.message || err);
  }
}

function startAliveLogger() {
  setInterval(() => {
    log("alive / buffer:", ws && ws.readyState === WebSocket.OPEN ? (ws as any)._bufferedAmount || 0 : 0);
  }, 60000);
}

connect();
startAliveLogger();
