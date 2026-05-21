import { Injectable } from "@nestjs/common";

@Injectable()
export class AppConfigService {
  get nodeEnv() {
    return process.env.NODE_ENV || "development";
  }

  get apiPort() {
    return Number(process.env.PORT || process.env.API_PORT || 3000);
  }

  get webPublicUrl() {
    return process.env.WEB_PUBLIC_URL || "http://localhost:5173";
  }

  get appPublicUrl() {
    return process.env.APP_PUBLIC_URL || "http://localhost:3000";
  }

  get corsOrigin() {
    return process.env.CORS_ORIGIN || this.webPublicUrl;
  }

  get corsOrigins() {
    return String(this.corsOrigin)
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }

  get accessSecret() {
    return process.env.JWT_ACCESS_SECRET || "change-me-access-secret";
  }

  get refreshSecret() {
    return process.env.JWT_REFRESH_SECRET || "change-me-refresh-secret";
  }

  get accessExpiresIn() {
    return process.env.JWT_ACCESS_EXPIRES_IN || "15m";
  }

  get refreshExpiresIn() {
    return process.env.JWT_REFRESH_EXPIRES_IN || "30d";
  }

  get passwordResetTtlMinutes() {
    return Number(process.env.PASSWORD_RESET_TTL_MINUTES || 30);
  }

  get resendApiKey() {
    return process.env.RESEND_API_KEY || "";
  }

  get mailFrom() {
    return process.env.MAIL_FROM || "Reseller Platform <onboarding@resend.dev>";
  }

  get encryptionKey() {
    return process.env.APP_ENCRYPTION_KEY || "change-me-32-byte-key";
  }

  get internalApiToken() {
    return process.env.INTERNAL_API_TOKEN || "change-me-internal-api-token";
  }

  get redisUrl() {
    return process.env.REDIS_URL || "redis://localhost:6379";
  }

  get paymentMode() {
    return process.env.PAYMENT_MODE || "payos";
  }

  get providerBaseUrl() {
    return process.env.DEFAULT_PROVIDER_BASE_URL || "https://canboso.com";
  }

  get providerName() {
    return process.env.DEFAULT_PROVIDER_NAME || "canboso";
  }

  get defaultCurrency() {
    return process.env.DEFAULT_CURRENCY || "VND";
  }

  get usdtVndRate() {
    return Number(process.env.USDT_VND_RATE || 27000);
  }

  get usdtPaymentTolerance() {
    return Number(process.env.USDT_PAYMENT_TOLERANCE || 0.02);
  }

  get tronGridApiBaseUrl() {
    return process.env.TRONGRID_API_BASE_URL || "https://api.trongrid.io";
  }

  get tronGridApiKey() {
    return process.env.TRONGRID_API_KEY || "";
  }

  get tronUsdtContractAddress() {
    return process.env.TRON_USDT_CONTRACT_ADDRESS || "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
  }

  get mockProviderEnabled() {
    return String(process.env.MOCK_PROVIDER_ENABLED || "false") === "true";
  }

  get mockTelegramEnabled() {
    return String(process.env.MOCK_TELEGRAM_MODE || "false") === "true";
  }

  get telegramApiId() {
    return Number(process.env.TELEGRAM_API_ID || 0);
  }

  get telegramApiHash() {
    return process.env.TELEGRAM_API_HASH || "";
  }

  get catalogSyncIntervalMs() {
    return Number(process.env.CATALOG_SYNC_INTERVAL_MS || 60000);
  }

  get catalogSchedulerTickMs() {
    return Number(process.env.CATALOG_SCHEDULER_TICK_MS || 5000);
  }

  get catalogSyncConcurrency() {
    return Number(process.env.CATALOG_SYNC_CONCURRENCY || 12);
  }

  validateForProduction() {
    if (this.nodeEnv !== "production") {
      return;
    }

    const errors: string[] = [];
    const required = [
      "DATABASE_URL",
      "REDIS_URL",
      "JWT_ACCESS_SECRET",
      "JWT_REFRESH_SECRET",
      "APP_ENCRYPTION_KEY",
      "INTERNAL_API_TOKEN",
      "APP_PUBLIC_URL",
      "WEB_PUBLIC_URL",
      "CORS_ORIGIN",
    ];

    for (const key of required) {
      if (!String(process.env[key] || "").trim()) {
        errors.push(`${key} is required.`);
      }
    }

    for (const key of ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET", "APP_ENCRYPTION_KEY", "INTERNAL_API_TOKEN"]) {
      const value = String(process.env[key] || "");

      if (
        value.length < 32 ||
        /change-me|CHANGE_ME|default|secret/i.test(value)
      ) {
        errors.push(`${key} must be a strong random value with at least 32 characters.`);
      }
    }

    for (const key of ["APP_PUBLIC_URL", "WEB_PUBLIC_URL", "CORS_ORIGIN"]) {
      const value = String(process.env[key] || "");

      if (/localhost|127\.0\.0\.1|example\.com/i.test(value)) {
        errors.push(`${key} must use the real production domain.`);
      }
    }

    if (this.mockProviderEnabled) {
      errors.push("MOCK_PROVIDER_ENABLED must be false in production.");
    }

    if (this.mockTelegramEnabled) {
      errors.push("MOCK_TELEGRAM_MODE must be false in production.");
    }

    if (errors.length > 0) {
      throw new Error(`Production configuration is not safe:\n- ${errors.join("\n- ")}`);
    }
  }
}
