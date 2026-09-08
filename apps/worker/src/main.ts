import { bootstrap } from "./bootstrap";

bootstrap().catch((error) => {
  console.error("[worker] Fatal bootstrap error:", error);
  process.exit(1);
});
