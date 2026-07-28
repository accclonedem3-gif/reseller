import axios from "axios";
import crypto from "crypto";

async function main() {
  const buyerKey = "91c7e51167e077c85e27abb6e09eabe10AWH2ktmwRnE6cB0cktd3hQq4lgk2F23";
  const idempotencyKey = crypto.randomUUID();
  
  try {
    const { data } = await axios.post("https://shopmmo.pro/api/v1/order", {
      product_id: 3131, // Discord Clone
      amount: 1,
    }, {
      params: { async: 1 },
      headers: {
        "X-API-Key": buyerKey,
        "Idempotency-Key": idempotencyKey,
        "Accept": "application/json"
      }
    });
    console.log("Async Order Response:", JSON.stringify(data, null, 2));
  } catch (error: any) {
    console.error("Async Error:", error.response?.data || error.message);
  }
}

main();
