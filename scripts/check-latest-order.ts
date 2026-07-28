import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
dotenv.config();

async function main() {
  const prisma = new PrismaClient();
  const order = await prisma.order.findFirst({
    orderBy: { createdAt: 'desc' },
    include: { shop: { include: { providerConfig: true } } }
  });
  console.log("Latest Order:");
  console.log(JSON.stringify(order, null, 2));
  await prisma.$disconnect();
}

main();
