import axios from "axios";

async function main() {
  const buyerKey = "91c7e51167e077c85e27abb6e09eabe10AWH2ktmwRnE6cB0cktd3hQq4lgk2F23";
  
  try {
    // Let's try to get a list of orders or recent orders if the API supports it
    const { data } = await axios.get("https://shopmmo.pro/api/v1/orders", {
      headers: {
        "X-API-Key": buyerKey,
        "Accept": "application/json"
      }
    });
    console.log("Orders List Response:", JSON.stringify(data, null, 2));
  } catch (error: any) {
    console.error("Orders List Error:", error.response?.data || error.message);
  }
}

main();
