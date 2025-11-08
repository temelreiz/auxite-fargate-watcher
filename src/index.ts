// src/index.ts

// --- WebSocket polyfill (Node + Origin header için) ---
import * as IsomorphicWS from "isows";

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

// --- ENV ---
const {
  WS_URL,
  HTTP_URL,
  CHAIN = "base",
  ORACLES = "",
  WEBHOOK_URL,
  WEBHOOK_SECRET,
  ROLLUP_WINDOW_SEC = "0",
  WS_ORIGIN = "https://wallet.auxite.io", // default: prod origin
} = process.env as Record<string, string>;

if (!WS_URL) throw new Error("WS_URL missing");
if (!WEBHOOK_URL) throw new Error("WEBHOOK_URL missing");

// --- Global WebSocket override (viem burayı kullanacak) ---
// isows: default export veya { WebSocket } gelebiliyor, ikisini de handle edelim.
const BaseWS: any =
  (IsomorphicWS as any).WebSocket || (IsomorphicWS as any);

// viem `new WebSocket(url)` çağırdığı için, global'e constructible bir fonksiyon veriyoruz.
// Her çağrıda Origin header'ını enjekte ediyoruz.
function WebSocketWithOrigin(this: any, url: string, protocols?: any) {
  const options: any = {};
  if (WS_ORIGIN) {
    options.headers = { Origin: WS_ORIGIN };
  }
  return new BaseWS(url, protocols, options);
}

// eslint vs TS kafaya takmasın diye `any` cast.
(globalThis as any).WebSocket = WebSocketWithOrigin as any;

// --- Logging helpers ---
const log = (...a: any[]) => console.log(new Date().toISOString(), ...a);
const warn = (...a: any[]) =>
  console.warn(new Date().toISOString(), "[WARN]", ...a);
const err = (...a: any[]) =>
  console.error(new Date().toISOString(), "[ERR] ", ...a);

// --- Chain seçimi ---
const chain: Chain =
  CHAIN === "base-sepolia"
    ? baseSepolia
    : CHAIN === "sepolia"
    ? sepolia
    : base;

// --- viem clients ---
const wsTransport = webSocket(WS_URL);
const wsClient = createPublicClient({ chain, transport: wsTransport });

const httpClient = HTTP_URL
  ? createPublicClient({ chain, transport: http(HTTP_URL) })
  : null;

// --- Events ---
const evAnswerUpdated = parseAbiItem(
  "event AnswerUpdated(int256 current, uint256 updatedAt)"
) as unknown as AbiEvent;

const evPriceUpdated = parseAbiItem(
  "event PriceUpdated(uint256 priceE6, address updater, uint256 ts)"
) as unknown as AbiEvent;

// --- Oracles ---
const addrs = ORACLES.split(",")
  .map((s) => s.trim())
  .filter(Boolean) as Address[];

if (addrs.length === 0) {
  warn("No ORACLES provided; watcher will idle.");
}

type Update = {
  address: Address;
  current: string;
  roundId: string;
  updatedAt: number;
};

let buffer: Update[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
const seen = new Set<string>();

function seenKey(lg: Log): string {
  const th = (lg as any).transactionHash ?? "0x";
  const li = (lg as any).logIndex ?? -1;
  return `${th}-${li}`;
}

function recordOnce(lg: Log, rec: Update) {
  const k = seenKey(lg);
  if (seen.has(k)) return;
  seen.add(k);
  if (seen.size > 5000) {
    // çok büyümesin
    seen.clear();
  }
  buffer.push(rec);
}

async function postUpdates() {
  if (buffer.length === 0) return;
  const batch = buffer.splice(0, buffer.length);

  const payload = JSON.stringify({
    chainId: chain.id,
    updates: batch,
    ts: Math.floor(Date.now() / 1000),
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
    log("🛰️ sending payload", payload);
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

// --- WS Watchers ---
function attachWsWatchers(address: Address) {
  // PriceUpdated
  (wsClient as any).watchEvent({
    address,
    event: evPriceUpdated,
    onLogs: (logs: Log[]) => {
      log("↪️ onLogs WS PriceUpdated", address, logs.length);
      for (const lg of logs) {
        const args: any = (lg as any).args;
        const priceE6: bigint = Array.isArray(args)
          ? args[0]
          : args?.priceE6;
        const ts: bigint = Array.isArray(args) ? args[2] : args?.ts;

        recordOnce(lg, {
          address,
          current: priceE6.toString(),
          roundId: "0",
          updatedAt: Number(ts),
        });
      }
      schedulePost();
    },
    onError: (e: any) =>
      err(`watchEvent(WS) PriceUpdated @${address}`, e?.message || e),
    batch: true,
  });
  log(`watchEvent(WS) PriceUpdated attached -> ${address}`);

  // AnswerUpdated
  (wsClient as any).watchEvent({
    address,
    event: evAnswerUpdated,
    onLogs: (logs: Log[]) => {
      log("↪️ onLogs WS AnswerUpdated", address, logs.length);
      for (const lg of logs) {
        const args: any = (lg as any).args;
        const current: bigint = Array.isArray(args)
          ? args[0]
          : args?.current;
        const updatedAt: bigint = Array.isArray(args)
          ? args[1]
          : args?.updatedAt;

        recordOnce(lg, {
          address,
          current: current.toString(),
          roundId: "0",
          updatedAt: Number(updatedAt),
        });
      }
      schedulePost();
    },
    onError: (e: any) =>
      err(`watchEvent(WS) AnswerUpdated @${address}`, e?.message || e),
    batch: true,
  });
  log(`watchEvent(WS) AnswerUpdated attached -> ${address}`);
}

// --- HTTP Fallback ---
async function startHttpPoller(address: Address) {
  if (!httpClient) return;
  log(`httpPoller start -> ${address}`);

  let last: bigint = await httpClient.getBlockNumber();
  last = last > 10n ? last - 10n : 0n;
  const step = 3_000;

  const loop = async () => {
    try {
      const latest = await httpClient.getBlockNumber();
      if (latest > last) {
        const fromBlock = last + 1n;
        const toBlock = latest;

        try {
          const logsP = await (httpClient as any).getLogs({
            address,
            event: evPriceUpdated,
            fromBlock,
            toBlock,
          });
          if (logsP.length)
            log("↪️ HTTP getLogs PriceUpdated", address, logsP.length);
          for (const lg of logsP) {
            const args: any = lg.args;
            const priceE6: bigint = Array.isArray(args)
              ? args[0]
              : args?.priceE6;
            const ts: bigint = Array.isArray(args) ? args[2] : args?.ts;
            recordOnce(lg, {
              address,
              current: priceE6.toString(),
              roundId: "0",
              updatedAt: Number(ts),
            });
          }
        } catch (e) {
          err(`HTTP getLogs PriceUpdated @${address}`, e);
        }

        try {
          const logsA = await (httpClient as any).getLogs({
            address,
            event: evAnswerUpdated,
            fromBlock,
            toBlock,
          });
          if (logsA.length)
            log("↪️ HTTP getLogs AnswerUpdated", address, logsA.length);
          for (const lg of logsA) {
            const args: any = lg.args;
            const current: bigint = Array.isArray(args)
              ? args[0]
              : args?.current;
            const updatedAt: bigint = Array.isArray(args)
              ? args[1]
              : args?.updatedAt;
            recordOnce(lg, {
              address,
              current: current.toString(),
              roundId: "0",
              updatedAt: Number(updatedAt),
            });
          }
        } catch (e) {
          err(`HTTP getLogs AnswerUpdated @${address}`, e);
        }

        schedulePost();
        last = latest;
      }
    } catch (e) {
      err("httpPoller loop error", e);
    } finally {
      setTimeout(loop, step);
    }
  };

  setTimeout(loop, step);
}

function attachWatchers() {
  for (const address of addrs) {
    attachWsWatchers(address);
    if (httpClient) void startHttpPoller(address);
  }
}

async function main() {
  log(`Watcher starting on ${chain.name} (id=${chain.id})`);
  log(`Oracles: ${addrs.length > 0 ? addrs.join(",") : "∅"}`);
  if (addrs.length === 0) return;

  try {
    const id = await wsClient.getChainId();
    if (id !== chain.id)
      warn(`⚠️ WS endpoint chainId=${id} != configured=${chain.id}`);
    else log(`✅ WS endpoint verified: chainId=${id}`);
  } catch (e) {
    warn("Failed to verify WS chainId:", e);
  }

  if (httpClient) {
    try {
      const id = await httpClient.getChainId();
      if (id !== chain.id)
        warn(`⚠️ HTTP endpoint chainId=${id} != configured=${chain.id}`);
      else log(`✅ HTTP endpoint verified: chainId=${id}`);
    } catch (e) {
      warn("Failed to verify HTTP chainId:", e);
    }
  }

  attachWatchers();
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
