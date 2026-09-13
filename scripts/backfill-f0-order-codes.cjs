const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  console.log("Starting backfill for F0 order codes in InternalSourceOrder...");

  const events = await prisma.internalSourceOrderEvent.findMany({
    where: {
      eventType: "upstream_purchase_success",
    },
    select: {
      orderId: true,
      payloadJson: true,
    },
  });

  console.log(`Found ${events.length} 'upstream_purchase_success' events.`);

  let updatedCount = 0;
  for (const event of events) {
    if (!event.payloadJson || typeof event.payloadJson !== "object") continue;
    const providerOrderId = event.payloadJson.providerOrderId
      ? String(event.payloadJson.providerOrderId).trim()
      : null;
    const providerOrderCode = event.payloadJson.providerOrderCode
      ? String(event.payloadJson.providerOrderCode).trim()
      : null;

    if (providerOrderId || providerOrderCode) {
      await prisma.internalSourceOrder.update({
        where: { id: event.orderId },
        data: {
          providerOrderId: providerOrderId || undefined,
          providerOrderCode: providerOrderCode || undefined,
        },
      });
      updatedCount++;
    }
  }

  console.log(`Successfully backfilled ${updatedCount} InternalSourceOrder records.`);
}

main()
  .catch((e) => {
    console.error("Backfill failed:", e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
