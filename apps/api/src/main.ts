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

  await app.listen(config.apiPort);
  console.log(`API is running on http://localhost:${config.apiPort}/${API_PREFIX}`);
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});

