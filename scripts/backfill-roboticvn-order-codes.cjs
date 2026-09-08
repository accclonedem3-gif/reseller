const path = require("node:path");

const axios = require("axios");
const { PrismaClient } = require("@prisma/client");
const dotenv = require("dotenv");
const { decryptSecret } = require("@reseller/shared/server");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");
const pageSize = 100;

function roboticBaseUrl(value) {
  const base = String(value || "https://api.roboticvn.com").replace(/\/+$/, "");
  return /\/api\/v2$/i.test(base) ? base : `${base}/api/v2`;
}

async function fetchOrderReferences(source, buyerKey) {
  const references = new Map();
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;

  while (offset < total) {
    const response = await axios.get(
      `${roboticBaseUrl(source.baseUrl)}/orders`,
      {
        params: { limit: pageSize, offset },
        headers: { "x-api-key": buyerKey, Accept: "application/json" },
        timeout: 30_000,
      },
    );
    const rows = Array.isArray(response.data?.data) ? response.data.data : [];
    total = Math.max(0, Number(response.data?.meta?.count) || rows.length);

    for (const row of rows) {
      const providerOrderId = String(row?.id || row?.order_id || "").trim();
      const providerOrderCode = String(row?.display_id || "").trim();
      if (providerOrderId && providerOrderCode) {
        references.set(providerOrderId, providerOrderCode);
      }
    }

    if (rows.length === 0) break;
    offset += rows.length;
  }

  return references;
}

async function main() {
  const encryptionKey = String(process.env.APP_ENCRYPTION_KEY || "").trim();
  if (!encryptionKey) throw new Error("APP_ENCRYPTION_KEY is missing.");

  const sources = await prisma.shopProviderSource.findMany({
    where: {
      OR: [
        { providerName: { equals: "roboticvn", mode: "insensitive" } },
        { baseUrl: { contains: "roboticvn.com", mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      label: true,
      baseUrl: true,
      buyerKeyEncrypted: true,
    },
  });

  let matchedTotal = 0;
  let updatedTotal = 0;

  for (const source of sources) {
    const buyerKey = decryptSecret(source.buyerKeyEncrypted, encryptionKey);
    const references = await fetchOrderReferences(source, buyerKey);
    const ids = Array.from(references.keys());
    const orders = ids.length
      ? await prisma.order.findMany({
          where: {
            sourceProduct: { providerSourceId: source.id },
            providerOrderId: { in: ids },
          },
          select: {
            id: true,
            providerOrderId: true,
            providerOrderCode: true,
          },
        })
      : [];

    const updates = orders
      .map((order) => ({
        id: order.id,
        code: references.get(String(order.providerOrderId || "")) || "",
        currentCode: order.providerOrderCode,
      }))
      .filter((order) => order.code && order.code !== order.currentCode);

    matchedTotal += orders.length;
    if (apply) {
      for (let index = 0; index < updates.length; index += 100) {
        const chunk = updates.slice(index, index + 100);
        await prisma.$transaction(
          chunk.map((order) =>
            prisma.order.update({
              where: { id: order.id },
              data: { providerOrderCode: order.code },
            }),
          ),
        );
      }
      updatedTotal += updates.length;
    }

    console.log(
      `${source.label}: provider=${references.size}, local=${orders.length}, ${apply ? "updated" : "wouldUpdate"}=${updates.length}`,
    );
  }

  console.log(
    JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      sources: sources.length,
      matchedTotal,
      updatedTotal,
    }),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
