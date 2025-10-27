// --- WebSocket polyfill for Node (viem için gerekli) ---
import * as WebSocket from "isows";
globalThis.WebSocket =
    WebSocket.WebSocket || WebSocket;
import { createPublicClient, webSocket, http, parseAbiItem, } from "viem";
import { base, baseSepolia, sepolia } from "viem/chains";
import crypto from "crypto";
import { request } from "undici";
const log = (...a) => console.log(new Date().toISOString(), ...a);
const warn = (...a) => console.warn(new Date().toISOString(), "[WARN]", ...a);
const err = (...a) => console.error(new Date().toISOString(), "[ERR] ", ...a);
// --- ENV ---
const { WS_URL, HTTP_URL, CHAIN = "base", ORACLES = "", WEBHOOK_URL, WEBHOOK_SECRET, ROLLUP_WINDOW_SEC = "0", } = process.env;
if (!WS_URL)
    throw new Error("WS_URL missing");
if (!WEBHOOK_URL)
    throw new Error("WEBHOOK_URL missing");
const chain = CHAIN === "base-sepolia" ? baseSepolia : CHAIN === "sepolia" ? sepolia : base;
// --- Clients ---
const wsTransport = webSocket(WS_URL);
const wsClient = createPublicClient({ chain, transport: wsTransport });
const httpClient = HTTP_URL
    ? createPublicClient({ chain, transport: http(HTTP_URL) })
    : null;
// --- Events ---
const evAnswerUpdated = parseAbiItem("event AnswerUpdated(int256 current, uint256 updatedAt)");
const evPriceUpdated = parseAbiItem("event PriceUpdated(uint256 priceE6, address updater, uint256 ts)");
// --- Oracles list ---
const addrs = ORACLES.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
if (addrs.length === 0)
    warn("No ORACLES provided; watcher will idle.");
let buffer = [];
let timer = null;
const seen = new Set();
function seenKey(lg) {
    const th = lg.transactionHash ?? "0x";
    const li = lg.logIndex ?? -1;
    return `${th}-${li}`;
}
function recordOnce(lg, rec) {
    const k = seenKey(lg);
    if (seen.has(k))
        return;
    seen.add(k);
    if (seen.size > 5000)
        seen.clear();
    buffer.push(rec);
}
async function postUpdates() {
    if (buffer.length === 0)
        return;
    const batch = buffer.splice(0, buffer.length);
    const payload = JSON.stringify({
        chainId: chain.id,
        updates: batch,
        ts: Math.floor(Date.now() / 1000),
    });
    const headers = { "content-type": "application/json" };
    if (WEBHOOK_SECRET) {
        const sig = crypto
            .createHmac("sha256", WEBHOOK_SECRET)
            .update(payload)
            .digest("hex");
        headers["x-oracle-signature"] = `sha256=${sig}`;
    }
    try {
        console.log("🛰️ sending payload", payload);
        const res = await request(WEBHOOK_URL, {
            method: "POST",
            headers,
            body: payload,
        });
        if (res.statusCode >= 200 && res.statusCode < 300) {
            log(`POST ${WEBHOOK_URL} OK (${batch.length})`);
        }
        else {
            warn(`POST ${WEBHOOK_URL} status=${res.statusCode}`);
        }
    }
    catch (e) {
        err("POST failed", e);
    }
}
function schedulePost() {
    const roll = Number(ROLLUP_WINDOW_SEC || "0");
    if (roll <= 0) {
        void postUpdates();
        return;
    }
    if (timer)
        return;
    timer = setTimeout(() => {
        timer = null;
        void postUpdates();
    }, roll * 1000);
}
// --- WS Watchers ---
function attachWsWatchers(address) {
    // PriceUpdated
    wsClient.watchEvent({
        address,
        event: evPriceUpdated,
        onLogs: (logs) => {
            console.log("↪️ onLogs WS PriceUpdated", address, logs.length);
            for (const lg of logs) {
                const args = lg.args;
                const priceE6 = Array.isArray(args) ? args[0] : args?.priceE6;
                const ts = Array.isArray(args) ? args[2] : args?.ts;
                recordOnce(lg, {
                    address,
                    current: priceE6.toString(),
                    roundId: "0",
                    updatedAt: Number(ts),
                });
            }
            schedulePost();
        },
        onError: (e) => err(`watchEvent(WS) PriceUpdated @${address}`, e?.message || e),
        batch: true,
    });
    log(`watchEvent(WS) PriceUpdated attached -> ${address}`);
    // AnswerUpdated
    wsClient.watchEvent({
        address,
        event: evAnswerUpdated,
        onLogs: (logs) => {
            console.log("↪️ onLogs WS AnswerUpdated", address, logs.length);
            for (const lg of logs) {
                const args = lg.args;
                const current = Array.isArray(args) ? args[0] : args?.current;
                const updatedAt = Array.isArray(args)
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
        onError: (e) => err(`watchEvent(WS) AnswerUpdated @${address}`, e?.message || e),
        batch: true,
    });
    log(`watchEvent(WS) AnswerUpdated attached -> ${address}`);
}
// --- HTTP Fallback ---
async function startHttpPoller(address) {
    if (!httpClient)
        return;
    log(`httpPoller start -> ${address}`);
    let last = await httpClient.getBlockNumber();
    last = last > 10n ? last - 10n : 0n;
    const step = 3_000;
    const loop = async () => {
        try {
            const latest = await httpClient.getBlockNumber();
            if (latest > last) {
                const fromBlock = last + 1n;
                const toBlock = latest;
                try {
                    const logsP = await httpClient.getLogs({
                        address,
                        event: evPriceUpdated,
                        fromBlock,
                        toBlock,
                    });
                    if (logsP.length)
                        console.log("↪️ HTTP getLogs PriceUpdated", address, logsP.length);
                    for (const lg of logsP) {
                        const args = lg.args;
                        const priceE6 = Array.isArray(args)
                            ? args[0]
                            : args?.priceE6;
                        const ts = Array.isArray(args) ? args[2] : args?.ts;
                        recordOnce(lg, {
                            address,
                            current: priceE6.toString(),
                            roundId: "0",
                            updatedAt: Number(ts),
                        });
                    }
                }
                catch (e) {
                    err(`HTTP getLogs PriceUpdated @${address}`, e);
                }
                try {
                    const logsA = await httpClient.getLogs({
                        address,
                        event: evAnswerUpdated,
                        fromBlock,
                        toBlock,
                    });
                    if (logsA.length)
                        console.log("↪️ HTTP getLogs AnswerUpdated", address, logsA.length);
                    for (const lg of logsA) {
                        const args = lg.args;
                        const current = Array.isArray(args)
                            ? args[0]
                            : args?.current;
                        const updatedAt = Array.isArray(args)
                            ? args[1]
                            : args?.updatedAt;
                        recordOnce(lg, {
                            address,
                            current: current.toString(),
                            roundId: "0",
                            updatedAt: Number(updatedAt),
                        });
                    }
                }
                catch (e) {
                    err(`HTTP getLogs AnswerUpdated @${address}`, e);
                }
                schedulePost();
                last = latest;
            }
        }
        catch (e) {
            err("httpPoller loop error", e);
        }
        finally {
            setTimeout(loop, step);
        }
    };
    setTimeout(loop, step);
}
function attachWatchers() {
    for (const address of addrs) {
        attachWsWatchers(address);
        if (httpClient)
            void startHttpPoller(address);
    }
}
async function main() {
    log(`Watcher starting on ${chain.name} (id=${chain.id})`);
    log(`Oracles: ${addrs.length > 0 ? addrs.join(",") : "∅"}`);
    if (addrs.length === 0)
        return;
    try {
        const id = await wsClient.getChainId();
        if (id !== chain.id)
            warn(`⚠️ WS endpoint chainId=${id} != configured=${chain.id}`);
        else
            log(`✅ WS endpoint verified: chainId=${id}`);
    }
    catch (e) {
        warn("Failed to verify WS chainId:", e);
    }
    if (httpClient) {
        try {
            const id = await httpClient.getChainId();
            if (id !== chain.id)
                warn(`⚠️ HTTP endpoint chainId=${id} != configured=${chain.id}`);
            else
                log(`✅ HTTP endpoint verified: chainId=${id}`);
        }
        catch (e) {
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
