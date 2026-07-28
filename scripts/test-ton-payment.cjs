const assert = require("node:assert/strict");
const {
  TON_USDT_MAINNET_MASTER,
  fetchTonUsdtTransfers,
  normalizeTonAddress,
} = require("../packages/shared/dist/server.js");

async function main() {
  const officialMasterRaw = normalizeTonAddress(TON_USDT_MAINNET_MASTER);
  assert.match(officialMasterRaw, /^0:[a-f0-9]{64}$/);
  assert.equal(normalizeTonAddress(officialMasterRaw.toUpperCase()), officialMasterRaw);
  assert.equal(
    normalizeTonAddress(`${TON_USDT_MAINNET_MASTER.slice(0, -1)}A`),
    null,
    "a friendly address with an invalid checksum must be rejected",
  );
  const crc16Xmodem = (bytes) => {
    let crc = 0;
    for (const byte of bytes) {
      crc ^= byte << 8;
      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
      }
    }
    return crc;
  };
  const testOnlyBytes = Buffer.from(TON_USDT_MAINNET_MASTER.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  testOnlyBytes[0] |= 0x80;
  testOnlyBytes.writeUInt16BE(crc16Xmodem(testOnlyBytes.subarray(0, 34)), 34);
  const testOnlyAddress = testOnlyBytes.toString("base64url").replace(/=+$/, "");
  assert.equal(normalizeTonAddress(testOnlyAddress), null, "a test-only address must be rejected on mainnet");

  const since = new Date("2026-07-17T00:00:00.000Z");
  const transactionNow = Math.floor(since.getTime() / 1000) + 30;
  const differentAddress = `0:${"1".repeat(64)}`;
  let requestedUrl;

  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    requestedUrl = new URL(String(url));
    assert.equal(options.method, "GET");
    return new Response(JSON.stringify({
      jetton_transfers: [
        {
          amount: "12345678",
          destination: officialMasterRaw,
          jetton_master: officialMasterRaw,
          source: differentAddress,
          transaction_aborted: false,
          transaction_hash: "accepted-hash",
          transaction_lt: "1000",
          transaction_now: transactionNow,
          trace_id: "accepted-trace",
        },
        {
          amount: "12345678",
          destination: officialMasterRaw,
          jetton_master: differentAddress,
          transaction_aborted: false,
          transaction_hash: "fake-jetton-hash",
          transaction_now: transactionNow,
        },
        {
          amount: "12345678",
          destination: officialMasterRaw,
          jetton_master: officialMasterRaw,
          transaction_aborted: true,
          transaction_hash: "aborted-hash",
          transaction_now: transactionNow,
        },
        {
          amount: "12345678",
          destination: differentAddress,
          jetton_master: officialMasterRaw,
          transaction_aborted: false,
          transaction_hash: "wrong-destination-hash",
          transaction_now: transactionNow,
        },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const transfers = await fetchTonUsdtTransfers({
      ownerAddresses: [TON_USDT_MAINNET_MASTER],
      since,
      apiKey: "test-key",
    });

    assert.equal(transfers.length, 1);
    assert.equal(transfers[0].txHash, "accepted-hash");
    assert.equal(transfers[0].amountUsdt, 12.345678);
    assert.equal(transfers[0].destinationAddress, officialMasterRaw);
    assert.equal(requestedUrl.pathname, "/api/v3/jetton/transfers");
    assert.equal(requestedUrl.searchParams.get("direction"), "in");
    assert.equal(requestedUrl.searchParams.get("jetton_master"), TON_USDT_MAINNET_MASTER);
    assert.equal(requestedUrl.searchParams.get("owner_address"), officialMasterRaw);
  } finally {
    global.fetch = originalFetch;
  }

  console.log("TON payment parser tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
