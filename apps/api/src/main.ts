import "dotenv/config";
import "reflect-metadata";

import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { urlencoded } from "express";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

import { API_PREFIX } from "@reseller/shared";

import { AppConfigService } from "./config/app-config.service";
import { AppModule } from "./app.module";
import { PrismaService } from "./db/prisma.service";
import { AdminService } from "./admin/admin.service";

function normalizeOrigin(value: string) {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

function parseHostname(value: string) {
  const normalized = String(value || "").trim();

  if (!normalized) {
    return "";
  }

  try {
    return new URL(normalized).hostname.toLowerCase();
  } catch {
    return normalized.replace(/:\d+$/, "").toLowerCase();
  }
}

function isLoopbackHost(value: string) {
  const hostname = parseHostname(value);
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

type CorsOriginCallback = (
  error: Error | null,
  allow?: boolean | string,
) => void;

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    cors: false,
    rawBody: true, // needed for Binance Pay webhook RSA signature verification
  });
  const config = app.get(AppConfigService);
  const uploadsDir = join(process.cwd(), "uploads");

  // #7: trust the co-located reverse proxy (nginx on loopback) so req.ip = the REAL client IP from
  // X-Forwarded-For. "loopback" only trusts 127.0.0.1/::1, so an external client can't spoof XFF.
  // Without this, behind nginx every request's ip is 127.0.0.1 → all users share ONE rate-limit
  // bucket (a few users throttle everyone) and per-IP abuse limits are meaningless.
  app.getHttpAdapter().getInstance().set("trust proxy", "loopback");

  config.validateForProduction();

  if (!existsSync(uploadsDir)) {
    mkdirSync(uploadsDir, { recursive: true });
  }

  app.use(helmet());
  // rawBody is preserved automatically via NestFactory rawBody:true option above.
  // The built-in body-parser will handle JSON; do NOT add a second json() middleware
  // or it will break the rawBody buffer that Binance Pay webhook verification depends on.
  app.use(urlencoded({ extended: true, limit: "2mb" }));
  const allowedOrigins = new Set(config.corsOrigins.map(normalizeOrigin));

  app.enableCors({
    origin: (requestOrigin: string | undefined, callback: CorsOriginCallback) => {
      const normalizedOrigin = normalizeOrigin(String(requestOrigin || ""));
      const isAllowed =
        !requestOrigin ||
        allowedOrigins.has(normalizedOrigin) ||
        isLoopbackHost(String(requestOrigin || ""));

      callback(null, isAllowed ? requestOrigin || true : false);
    },
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );
  app.setGlobalPrefix(API_PREFIX);
  app.use("/uploads", (_req: any, res: any, next: any) => {
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    next();
  }, (await import("express")).default.static(uploadsDir));

  const appPublicUrl = config.appPublicUrl;
  const swaggerConfig = new DocumentBuilder()
    .setTitle("Internal Source API")
    .setDescription(
      "## Kết nối nguồn nội bộ ULTRA\n\n" +
      "API dành cho PRO seller để đặt hàng từ nguồn ULTRA.\n\n" +
      "### Authentication\n\n" +
      "Mỗi request phải có header:\n\n" +
      "```\nX-Source-Api-Key: <your-key>\n```\n\n" +
      "### Lấy API key\n\n" +
      "Liên hệ PRO seller hoặc nhắn lệnh `/api` trong Telegram bot của shop nguồn để nhận key.\n\n" +
      "### Flow cơ bản\n\n" +
      "1. `GET /catalog` → lấy danh sách sản phẩm\n" +
      "2. `GET /balance` → kiểm tra số dư\n" +
      "3. `POST /orders` → đặt hàng (trừ số dư)\n" +
      "4. `GET /orders/{code}` → kiểm tra trạng thái đơn",
    )
    .setVersion("1.0")
    .addServer(`${appPublicUrl}/${API_PREFIX}`, "API Server")
    .addApiKey({ type: "apiKey", name: "X-Source-Api-Key", in: "header" }, "source-api-key")
    .build();

  const swaggerDoc = SwaggerModule.createDocument(app, swaggerConfig, {
    ignoreGlobalPrefix: true,
  });
  swaggerDoc.paths = Object.fromEntries(
    Object.entries(swaggerDoc.paths).filter(([path]) =>
      path.startsWith("/internal-source/v1"),
    ),
  );
  SwaggerModule.setup("api/swagger", app, swaggerDoc, {
    swaggerOptions: { persistAuthorization: true },
    customSiteTitle: "Internal Source API Docs",
  });

  // Lightweight health/readiness probe (NOT under the API prefix, no auth) for load balancers /
  // PM2 / uptime monitors. Pings the DB so "up" means "can actually serve", not just "process alive".
  const prisma = app.get(PrismaService);
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.get("/health", async (_req: any, res: any) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.status(200).json({ status: "ok", uptime: Math.round(process.uptime()) });
    } catch (err: any) {
      res.status(503).json({ status: "error", error: err?.message || "db_unreachable" });
    }
  });

  // Prometheus-style metrics for the warranty pipeline (queue depth, live proxies, tool success
  // rate, Redis circuit). Optionally gate with METRICS_TOKEN env (?token= or X-Metrics-Token) so
  // business counts aren't world-readable; leave unset for an internal/firewalled scrape.
  const adminService = app.get(AdminService);
  const metricsToken = String(process.env.METRICS_TOKEN || "").trim();
  expressApp.get("/metrics", async (req: any, res: any) => {
    if (metricsToken) {
      const provided = String(req.query?.token || req.headers?.["x-metrics-token"] || "");
      if (provided !== metricsToken) {
        res.status(401).type("text/plain").send("unauthorized");
        return;
      }
    }
    try {
      const m = await adminService.getWarrantyMetrics();
      const lines = [
        "# HELP warranty_queue_depth Account-check jobs in the BullMQ queue by state.",
        "# TYPE warranty_queue_depth gauge",
        `warranty_queue_depth{state="waiting"} ${m.queue.waiting}`,
        `warranty_queue_depth{state="active"} ${m.queue.active}`,
        `warranty_queue_depth{state="delayed"} ${m.queue.delayed}`,
        `warranty_queue_depth{state="total"} ${m.queue.total}`,
        "# HELP warranty_proxy Configured check proxies by liveness (live = not Redis-dead-marked).",
        "# TYPE warranty_proxy gauge",
        `warranty_proxy{state="total"} ${m.proxy.total}`,
        `warranty_proxy{state="live"} ${m.proxy.live}`,
        `warranty_proxy{state="dead"} ${m.proxy.dead}`,
        "# HELP warranty_tool_checks_24h Conclusive auto-checks in the last 24h by result.",
        "# TYPE warranty_tool_checks_24h gauge",
        `warranty_tool_checks_24h{result="completed"} ${m.tool24h.completed}`,
        `warranty_tool_checks_24h{result="failed"} ${m.tool24h.failed}`,
        "# HELP warranty_tool_success_rate Percent of conclusive auto-checks that landed a verdict (24h).",
        "# TYPE warranty_tool_success_rate gauge",
        `warranty_tool_success_rate ${m.tool24h.successRate ?? 0}`,
        "# HELP redis_circuit_open 1 if the API's Redis circuit breaker is open (degraded).",
        "# TYPE redis_circuit_open gauge",
        `redis_circuit_open ${m.redisCircuitOpen ? 1 : 0}`,
      ];
      res.status(200).type("text/plain; version=0.0.4").send(lines.join("\n") + "\n");
    } catch (err: any) {
      res.status(503).type("text/plain").send(`# metrics error: ${err?.message || "unavailable"}\n`);
    }
  });

  // Run NestJS lifecycle hooks (QueueService / CacheService Redis close, etc.) on SIGTERM/SIGINT —
  // without this, a deploy/restart drops Redis connections abruptly instead of closing them cleanly.
  app.enableShutdownHooks();

  await app.listen(config.apiPort);
  console.log(`API is running on http://localhost:${config.apiPort}/${API_PREFIX}`);
  console.log(`Health probe: http://localhost:${config.apiPort}/health`);
}

// Crash safety net for errors outside Nest's per-request exception filter. Log a stray rejection
// but stay up; exit on a true uncaughtException so PM2 restarts a clean process rather than serving
// from an undefined state.
process.on("unhandledRejection", (reason) => {
  console.error("[api] UNHANDLED REJECTION:", reason instanceof Error ? (reason.stack || reason.message) : reason);
});
process.on("uncaughtException", (err) => {
  console.error("[api] UNCAUGHT EXCEPTION:", err instanceof Error ? err.stack : err);
  process.exit(1);
});

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});

