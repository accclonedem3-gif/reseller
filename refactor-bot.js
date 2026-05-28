const fs = require('fs');
const path = require('path');
const p = path.resolve('apps/api/src/lib/telegram-bot.service.v2.ts');
let code = fs.readFileSync(p, 'utf8');

if (!code.includes('import IORedis')) {
  code = code.replace('import axios from "axios";', 'import axios from "axios";\nimport IORedis from "ioredis";');
}

// 1. Add redis field
if (!code.includes('private readonly redis: IORedis;')) {
  code = code.replace('private readonly logger = new Logger(TelegramBotService.name);', 'private readonly logger = new Logger(TelegramBotService.name);\n  private readonly redis: IORedis;');
}

// 2. Initialize in constructor
if (!code.includes('this.redis = new IORedis')) {
  code = code.replace('this.gramJsService = gramJsService;\n  }', 'this.gramJsService = gramJsService;\n    this.redis = new IORedis(this.config.redisUrl, { maxRetriesPerRequest: null });\n  }');
}

// 3. Remove Map declarations
const maps = [
  'pendingQuantitySelections',
  'pendingWalletTopups',
  'pendingPaymentSelections',
  'pendingTxHashSubmissions',
  'pendingBinanceOrderIdSubmissions',
  'pendingWarrantyClaimSubmissions',
  'pendingWarrantyIssueDescriptions',
  'pendingWarrantyAccountSelections',
  'pendingConnectionTopupInputs',
  'pendingQrMessages'
];
maps.forEach(m => {
  const re = new RegExp(`  private readonly ${m} = new Map<.*>\\(\\);\\n`, 'g');
  code = code.replace(re, '');
});

// 4. Add helper methods
const helpers = `
  private async setPendingSession<T>(type: string, key: string, data: T, ttlMs: number) {
    const fullKey = \`bot:session:\${type}:\${key}\`;
    await this.redis.set(fullKey, JSON.stringify(data), "PX", ttlMs);
  }

  private async getPendingSession<T>(type: string, key: string): Promise<T | undefined> {
    const fullKey = \`bot:session:\${type}:\${key}\`;
    const val = await this.redis.get(fullKey);
    if (!val) return undefined;
    try {
      return JSON.parse(val) as T;
    } catch {
      return undefined;
    }
  }

  private async delPendingSession(type: string, key: string) {
    const fullKey = \`bot:session:\${type}:\${key}\`;
    await this.redis.del(fullKey);
  }
`;
if (!code.includes('setPendingSession<T>')) {
  code = code.replace('  private readonly logger = new Logger(TelegramBotService.name);\n  private readonly redis: IORedis;', '  private readonly logger = new Logger(TelegramBotService.name);\n  private readonly redis: IORedis;\n' + helpers);
}

// 5. Replace clear methods (convert to async)
const clearMethods = [
  'clearPendingQuantitySelection',
  'clearPendingWalletTopup',
  'clearPendingPaymentSelection',
  'clearPendingTxHashSubmission',
  'clearPendingWarrantyClaimSubmission',
  'clearPendingWarrantyIssueDescription',
  'clearPendingWarrantyAccountSelection',
  'clearPendingBinanceOrderIdSubmission', // doesn't exist maybe? Let's be safe
];

clearMethods.forEach(m => {
  const re = new RegExp(`private ${m}\\(shopId: string, telegramUserId: string\\) \\{([\\s\\S]*?)\\}`, 'g');
  code = code.replace(re, (match, body) => {
    let newBody = body;
    maps.forEach(map => {
      newBody = newBody.replace(new RegExp(`this\\.${map}\\.delete\\((.*?)\\);`, 'g'), `await this.delPendingSession('${map}', $1);`);
    });
    return `private async ${m}(shopId: string, telegramUserId: string) {${newBody}}`;
  });
});

// 6. Fix callers of clear methods to add await
clearMethods.forEach(m => {
  code = code.replace(new RegExp(`this\\.${m}\\(`, 'g'), `await this.${m}(`);
});

// Replace "await await" in case we accidentally double it
code = code.replace(/await await/g, 'await');

// 7. Manual replacements for usages of Maps in other methods:
// Since AST is hard here, we'll manually replace known occurrences of `.set`, `.get`, `.delete`
const manualReplacements = [
  { search: /this\.pendingWalletTopups\.set\((.*?), (\{[\s\S]*?\})\);/g, replace: "await this.setPendingSession('pendingWalletTopups', $1, $2, this.pendingQuantityTtlMs);" },
  { search: /this\.pendingTxHashSubmissions\.set\((.*?), (\{[\s\S]*?\})\);/g, replace: "await this.setPendingSession('pendingTxHashSubmissions', $1, $2, this.pendingTxHashTtlMs);" },
  { search: /this\.pendingWarrantyClaimSubmissions\.set\((.*?)\);/g, replace: "await this.setPendingSession('pendingWarrantyClaimSubmissions', $1, { expiresAt: Date.now() + 10 * 60 * 1000 }, 10 * 60 * 1000);" },
  { search: /this\.pendingWarrantyAccountSelections\.set\((.*?), (\{[\s\S]*?\})\);/g, replace: "await this.setPendingSession('pendingWarrantyAccountSelections', $1, $2, 10 * 60 * 1000);" },
  { search: /this\.pendingTxHashSubmissions\.set\((.*?), pending\);/g, replace: "await this.setPendingSession('pendingTxHashSubmissions', $1, pending, this.pendingTxHashTtlMs);" },
  { search: /this\.pendingPaymentSelections\.set\([\s\S]*?this\.getPendingQuantityKey\(shopId, telegramUserId\),[\s\S]*?(\{[\s\S]*?\})[\s\S]*?\);/m, replace: "await this.setPendingSession('pendingPaymentSelections', this.getPendingQuantityKey(shopId, telegramUserId), $1, this.pendingPaymentTtlMs);" },
  { search: /this\.pendingQrMessages\.set\((.*?), (\{[\s\S]*?\})\);/g, replace: "await this.setPendingSession('pendingQrMessages', $1, $2, 30 * 60 * 1000);" }, // 30 mins TTL
  { search: /const qrMsg = this\.pendingQrMessages\.get\((.*?)\);/g, replace: "const qrMsg = await this.getPendingSession<{ token: string; chatId: string | number; messageId: number }>('pendingQrMessages', $1);" },
  { search: /this\.pendingQrMessages\.delete\((.*?)\);/g, replace: "await this.delPendingSession('pendingQrMessages', $1);" },
  { search: /this\.pendingQuantitySelections\.set\([\s\S]*?this\.getPendingQuantityKey\(shopId, String\(message\.from\.id\)\),[\s\S]*?(\{[\s\S]*?\})[\s\S]*?\);/m, replace: "await this.setPendingSession('pendingQuantitySelections', this.getPendingQuantityKey(shopId, String(message.from.id)), $1, this.pendingQuantityTtlMs);" },
  { search: /const pending = this\.pendingWalletTopups\.get\((.*?)\);/g, replace: "const pending = await this.getPendingSession<PendingWalletTopupSelection>('pendingWalletTopups', $1);" },
  { search: /this\.pendingWalletTopups\.delete\((.*?)\);/g, replace: "await this.delPendingSession('pendingWalletTopups', $1);" },
  { search: /const selection = this\.pendingQuantitySelections\.get\((.*?)\);/g, replace: "const selection = await this.getPendingSession<PendingQuantitySelection>('pendingQuantitySelections', $1);" },
  { search: /this\.pendingQuantitySelections\.delete\((.*?)\);/g, replace: "await this.delPendingSession('pendingQuantitySelections', $1);" },
  { search: /const selection = this\.pendingPaymentSelections\.get\((.*?)\);/g, replace: "const selection = await this.getPendingSession<PendingPaymentSelection>('pendingPaymentSelections', $1);" },
  { search: /this\.pendingPaymentSelections\.delete\((.*?)\);/g, replace: "await this.delPendingSession('pendingPaymentSelections', $1);" },
  { search: /const pending = this\.pendingTxHashSubmissions\.get\((.*?)\);/g, replace: "const pending = await this.getPendingSession<PendingTxHashSubmission>('pendingTxHashSubmissions', $1);" },
  { search: /this\.pendingTxHashSubmissions\.delete\((.*?)\);/g, replace: "await this.delPendingSession('pendingTxHashSubmissions', $1);" },
  { search: /const pending = this\.pendingWarrantyClaimSubmissions\.get\((.*?)\);/g, replace: "const pending = await this.getPendingSession<PendingWarrantyClaimSubmission>('pendingWarrantyClaimSubmissions', $1);" },
  { search: /this\.pendingWarrantyClaimSubmissions\.delete\((.*?)\);/g, replace: "await this.delPendingSession('pendingWarrantyClaimSubmissions', $1);" },
  { search: /const pending = this\.pendingWarrantyAccountSelections\.get\((.*?)\);/g, replace: "const pending = await this.getPendingSession<PendingWarrantyAccountSelection>('pendingWarrantyAccountSelections', $1);" },
  { search: /this\.pendingWarrantyAccountSelections\.delete\((.*?)\);/g, replace: "await this.delPendingSession('pendingWarrantyAccountSelections', $1);" },
  { search: /this\.pendingConnectionTopupInputs\.set\([\s\S]*?this\.getPendingQuantityKey\(shop\.id, telegramUserId\),[\s\S]*?(\{[\s\S]*?\})[\s\S]*?\);/m, replace: "await this.setPendingSession('pendingConnectionTopupInputs', this.getPendingQuantityKey(shop.id, telegramUserId), $1, 10 * 60 * 1000);" },
  { search: /const pending = this\.pendingConnectionTopupInputs\.get\((.*?)\);/g, replace: "const pending = await this.getPendingSession<PendingConnectionTopupInput>('pendingConnectionTopupInputs', $1);" },
  { search: /this\.pendingConnectionTopupInputs\.delete\((.*?)\);/g, replace: "await this.delPendingSession('pendingConnectionTopupInputs', $1);" }
];

manualReplacements.forEach(rep => {
  code = code.replace(rep.search, rep.replace);
});

// Empty out cleanupExpiredPendingSelections
code = code.replace(/private cleanupExpiredPendingSelections\(\) \{[\s\S]*?^  \}/m, 'private cleanupExpiredPendingSelections() {\n    // No-op: Redis handles TTL automatically\n  }');

fs.writeFileSync(p, code);
console.log('Modified successfully.');
