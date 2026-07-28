import { PrismaClient } from "@prisma/client";

async function main() {
  const prisma = new PrismaClient();
  const order = await prisma.order.findUnique({
    where: { orderCode: "ORD-20260706043642-976" }
  });
  console.log(order);
  await prisma.$disconnect();
}

main();
