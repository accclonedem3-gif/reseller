import { fetchProviderBalance, fetchProviderProducts } from "../packages/shared/src/server";

async function main() {
  const credentials = {
    baseUrl: "https://shopmmo.pro/api/v1",
    buyerKey: "91c7e51167e077c85e27abb6e09eabe10AWH2ktmwRnE6cB0cktd3hQq4lgk2F23"
  };

  try {
    console.log("Testing fetchProviderBalance...");
    const balance = await fetchProviderBalance(credentials);
    console.log("Balance result:", balance);
  } catch (error: any) {
    console.error("Balance failed:", error.message || error);
  }

  try {
    console.log("\nTesting fetchProviderProducts...");
    const products = await fetchProviderProducts(credentials);
    console.log(`Successfully fetched ${products.length} products.`);
    if (products.length > 0) {
      console.log("Sample product:", products[0]);
    }
  } catch (error: any) {
    console.error("Products failed:", error.message || error);
  }
}

main().catch(console.error);
