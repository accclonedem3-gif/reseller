// Standalone test for Web2m webhook match logic
// Run: node test-web2m-match.mjs

function matchOrder(description, txnAmount, pending) {
  const normalized = String(description || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!normalized) return null;
  for (const p of pending) {
    const code = String(p.externalOrderCode).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!code) continue;
    const last6 = code.slice(-6);
    const codeMatches =
      normalized.includes(code) ||
      (last6.length === 6 && normalized.includes(last6));
    if (!codeMatches) continue;
    if (Math.abs(Number(p.amount) - Number(txnAmount)) > 1) continue;
    return p.externalOrderCode;
  }
  return null;
}

const pending = [
  { externalOrderCode: "NAPVI-ABC123", amount: 10000 },
  { externalOrderCode: "NAPVI-XYZ789", amount: 50000 },
  { externalOrderCode: "ORD-20260520-001", amount: 200000 },
];

const cases = [
  // [description, amount, expectedMatch, label]
  ["NAPVI-ABC123", 10000, "NAPVI-ABC123", "Exact match"],
  ["NAPVIABC123", 10000, "NAPVI-ABC123", "Match khi không có dấu gạch"],
  ["napvi abc123", 10000, "NAPVI-ABC123", "Lowercase + space"],
  ["NAP14838 GD ABC123-010624 16:56:30", 10000, "NAPVI-ABC123", "Web2m format có giờ phút"],
  ["CK NAPVIABC123 cho ban", 10000, "NAPVI-ABC123", "Có text bao quanh"],
  ["NAPVI-ABC123", 10001, "NAPVI-ABC123", "Amount lệch 1 đồng (tolerance OK)"],
  ["NAPVI-ABC123", 10002, null, "Amount lệch 2 đồng (reject)"],
  ["NAPVI-XYZ789", 50000, "NAPVI-XYZ789", "Đơn khác trong cùng pending"],
  ["chuyen tien linh tinh", 10000, null, "Không có mã đơn"],
  ["NAPVI-ABC999", 10000, null, "Mã sai hoàn toàn"],
  ["ABC123", 10000, "NAPVI-ABC123", "Match qua last 6 chars"],
  ["", 10000, null, "Empty description"],
  ["ABC1", 10000, null, "Chỉ 4 ký tự, không đủ match"],
];

let pass = 0;
let fail = 0;

console.log("=== Web2m match logic tests ===\n");

for (const [desc, amount, expected, label] of cases) {
  const result = matchOrder(desc, amount, pending);
  const ok = result === expected;
  const icon = ok ? "✓" : "✗";
  const color = ok ? "\x1b[32m" : "\x1b[31m";
  console.log(`${color}${icon}\x1b[0m ${label}`);
  console.log(`  description: ${JSON.stringify(desc)}`);
  console.log(`  amount: ${amount}`);
  console.log(`  expected: ${expected}`);
  console.log(`  got: ${result}`);
  console.log();
  if (ok) pass++;
  else fail++;
}

console.log(`\n=== Result: ${pass} passed / ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
