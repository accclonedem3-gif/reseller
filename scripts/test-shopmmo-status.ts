import axios from "axios";

async function main() {
  const transId = "ORD-20260706043642-976";
  const buyerKey = "91c7e51167e077c85e27abb6e09eabe10AWH2ktmwRnE6cB0cktd3hQq4lgk2F23";
  
  try {
    const { data } = await axios.get(`https://shopmmo.pro/api/v1/orders/${transId}`, {
      headers: {
        "X-API-Key": buyerKey,
        "Accept": "application/json"
      }
    });
    console.log("Order Status:", JSON.stringify(data, null, 2));
  } catch (error: any) {
    console.error("Error:", error.response?.data || error.message);
  }
}

main();
