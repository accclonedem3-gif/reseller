export const sourceProductFamilyOptions = [
  { value: "CHATGPT", label: "ChatGPT" },
  { value: "CLAUDE", label: "Claude" },
  { value: "GEMINI", label: "Gemini" },
  { value: "GROK", label: "Grok" },
  { value: "PERPLEXITY", label: "Perplexity" },
  { value: "VEO3", label: "Veo 3" },
  { value: "KLING", label: "Kling AI" },
  { value: "HIGGSFIELD", label: "Higgsfield" },
  { value: "CANVA", label: "Canva" },
  { value: "CAPCUT", label: "CapCut" },
  { value: "ADOBE", label: "Adobe" },
  { value: "SUNO", label: "Suno" },
  { value: "ELEVENLABS", label: "ElevenLabs" },
  { value: "HEYGEN", label: "HeyGen" },
  { value: "GMAIL", label: "Gmail" },
  { value: "YOUTUBE", label: "YouTube" },
  { value: "TIKTOK", label: "TikTok" },
  { value: "ZOOM", label: "Zoom" },
  { value: "DUOLINGO", label: "Duolingo" },
  { value: "HMA", label: "HMA" },
  { value: "VPN", label: "VPN" },
  { value: "OTHER", label: "Khác" },
] as const;

/** Gói sản phẩm — phụ thuộc productFamily */
export const sourceProductPackageOptions: Record<string, ReadonlyArray<{ value: string; label: string }>> = {
  CHATGPT: [
    { value: "GPT_PLUS", label: "GPT Plus" },
    { value: "GPT_PRO", label: "GPT Pro" },
    { value: "GPT_TEAM", label: "GPT Team" },
    { value: "GPT_API", label: "GPT API Credit" },
  ],
  VEO3: [
    { value: "VEO3_50", label: "Veo 3 50 credit" },
    { value: "VEO3_100", label: "Veo 3 100 credit" },
    { value: "VEO3_ULTRA_50", label: "Veo 3 Ultra 50 credit" },
    { value: "VEO3_ULTRA_100", label: "Veo 3 Ultra 100 credit" },
    { value: "VEO3_ULTRA_25K", label: "Veo 3 Ultra 25K credit" },
    { value: "VEO3_ULTRA_50K", label: "Veo 3 Ultra 50K credit" },
    { value: "VEO3_PRO", label: "Veo 3 Pro" },
  ],
  CLAUDE: [
    { value: "CLAUDE_PRO", label: "Claude Pro" },
    { value: "CLAUDE_TEAM1", label: "Claude Team 1" },
    { value: "CLAUDE_TEAM5", label: "Claude Team 5" },
    { value: "CLAUDE_MAX", label: "Claude Max" },
  ],
  GEMINI: [
    { value: "GEMINI_ADVANCED", label: "Gemini Advanced" },
    { value: "GEMINI_PRO", label: "Gemini Pro" },
    { value: "GEMINI_ULTRA", label: "Gemini Ultra" },
    { value: "GEMINI_AI_PRO", label: "Gemini AI Pro" },
  ],
  CANVA: [
    { value: "CANVA_PRO", label: "Canva Pro" },
    { value: "CANVA_TEAM", label: "Canva Team" },
    { value: "CANVA_EDU", label: "Canva EDU" },
  ],
  CAPCUT: [
    { value: "CAPCUT_PRO", label: "CapCut Pro" },
    { value: "CAPCUT_PRO_TRIAL", label: "CapCut Pro Trial" },
    { value: "CAPCUT_RENEW", label: "CapCut Pro Renew" },
  ],
  GROK: [
    { value: "GROK_SUPER", label: "Grok Super" },
    { value: "GROK_HEAVY", label: "Grok Heavy" },
    { value: "GROK_HEAVY_DATE", label: "Grok Heavy Date" },
  ],
  KLING: [
    { value: "KLING_1100", label: "Kling AI 1100 Credit" },
    { value: "KLING_PRO", label: "Kling AI Pro" },
    { value: "KLING_MAX", label: "Kling AI Max" },
  ],
  ADOBE: [
    { value: "ADOBE_FULL_APP", label: "Adobe Full App" },
    { value: "ADOBE_TRIAL", label: "Adobe Trial" },
    { value: "ADOBE_PHOTOSHOP", label: "Adobe Photoshop" },
    { value: "ADOBE_ILLUSTRATOR", label: "Adobe Illustrator" },
  ],
  SUNO: [
    { value: "SUNO_PRE", label: "Suno Pre" },
    { value: "SUNO_PRO", label: "Suno Pro" },
    { value: "SUNO_PREMIER", label: "Suno Premier" },
  ],
  HEYGEN: [
    { value: "HEYGEN_CREATOR", label: "HeyGen Creator" },
    { value: "HEYGEN_TEAM", label: "HeyGen Team" },
  ],
  PERPLEXITY: [
    { value: "PERPLEXITY_PRO", label: "Perplexity Pro" },
  ],
  GMAIL: [
    { value: "GMAIL_PERSONAL", label: "Gmail Personal" },
    { value: "GMAIL_WORKSPACE", label: "Google Workspace" },
  ],
  ELEVENLABS: [
    { value: "ELEVENLABS_STARTER", label: "ElevenLabs Starter" },
    { value: "ELEVENLABS_CREATOR", label: "ElevenLabs Creator" },
    { value: "ELEVENLABS_PRO", label: "ElevenLabs Pro" },
    { value: "ELEVENLABS_SCALE", label: "ElevenLabs Scale" },
  ],
  TIKTOK: [
    { value: "TIKTOK_ADS", label: "TikTok Ads Credit" },
    { value: "TIKTOK_PRO", label: "TikTok Pro" },
  ],
  DUOLINGO: [
    { value: "DUOLINGO_SUPER", label: "Duolingo Super" },
    { value: "DUOLINGO_MAX", label: "Duolingo Max" },
  ],
  HMA: [
    { value: "HMA_PRO", label: "HMA VPN Pro" },
  ],
  VPN: [
    { value: "VPN_PRO", label: "VPN Pro" },
    { value: "VPN_PREMIUM", label: "VPN Premium" },
  ],
  ZOOM: [
    { value: "ZOOM_PRO", label: "Zoom Pro" },
    { value: "ZOOM_BUSINESS", label: "Zoom Business" },
  ],
  YOUTUBE: [
    { value: "YOUTUBE_PREMIUM", label: "YouTube Premium" },
    { value: "YOUTUBE_FAMILY", label: "YouTube Family" },
  ],
  HIGGSFIELD: [
    { value: "HIGGSFIELD_PRO", label: "Higgsfield Pro" },
  ],
  OTHER: [],
};

export const sourceAccountTypeOptions = [
  { value: "PERSONAL", label: "Tài khoản cá nhân" },
  { value: "SHARED", label: "Tài khoản share" },
  { value: "ADD_FAMILY", label: "Add thành viên gia đình" },
  { value: "CREDIT_API", label: "Credit API" },
  { value: "OTHER", label: "Khác" },
] as const;

export const sourceDurationTypeOptions = [
  { value: "DAY_1", label: "1 ngày" },
  { value: "DAY_7", label: "7 ngày" },
  { value: "MONTH_1", label: "1 tháng" },
  { value: "MONTH_3", label: "3 tháng" },
  { value: "MONTH_6", label: "6 tháng" },
  { value: "MONTH_12", label: "12 tháng" },
  { value: "LIFETIME", label: "Vĩnh viễn" },
  { value: "OTHER", label: "Khác" },
] as const;

export const sourceDeliveryModeOptions = [
  { value: "AUTO_API", label: "Tự động qua API nguồn" },
  { value: "AUTO_STOCK", label: "Tự động từ kho nội bộ" },
  { value: "MANUAL", label: "Giao thủ công" },
] as const;

export const sourceWarrantyPolicyOptions = [
  { value: "KBH", label: "Không bảo hành" },
  { value: "BH24H", label: "Bảo hành 24 giờ" },
  { value: "BH1M", label: "Bảo hành 1 tháng" },
  { value: "BH3M", label: "Bảo hành 3 tháng" },
  { value: "BH6M", label: "Bảo hành 6 tháng" },
  { value: "BH12M", label: "Bảo hành 12 tháng" },
  { value: "BHF", label: "Bảo hành Full (BHF)" },
] as const;

export function getSourceOptionLabel(
  value: string | null | undefined,
  options: readonly { value: string; label: string }[],
  fallback = "-",
) {
  if (!value) {
    return fallback;
  }

  return options.find((item) => item.value.toLowerCase() === value.toLowerCase())?.label || value;
}

/**
 * Auto-generate product display name from selected classification fields.
 * Example: VEO3_ULTRA_25K + MONTH_1 + BHF → "Veo 3 Ultra 25K credit 1 tháng BHF"
 */
export function buildAutoProductName(input: {
  productFamily?: string | null;
  productPackage?: string | null;
  durationType?: string | null;
  warrantyPolicy?: string | null;
}): string {
  const parts: string[] = [];
  if (input.productPackage && input.productFamily) {
    const packageOpts = sourceProductPackageOptions[input.productFamily] || [];
    const pkgLabel = packageOpts.find((p) => p.value === input.productPackage)?.label;
    if (pkgLabel) parts.push(pkgLabel);
  } else if (input.productFamily && input.productFamily !== "OTHER") {
    const famLabel = sourceProductFamilyOptions.find((f) => f.value === input.productFamily)?.label;
    if (famLabel) parts.push(famLabel);
  }
  if (input.durationType && input.durationType !== "LIFETIME" && input.durationType !== "OTHER") {
    const durLabel = sourceDurationTypeOptions.find((d) => d.value === input.durationType)?.label;
    if (durLabel) parts.push(durLabel);
  } else if (input.durationType === "LIFETIME") {
    parts.push("Vĩnh viễn");
  }
  if (input.warrantyPolicy && input.warrantyPolicy !== "KBH") {
    const warrantyShortMap: Record<string, string> = {
      BH24H: "BH24H",
      BH1M: "BH1M",
      BH3M: "BH3M",
      BH6M: "BH6M",
      BH12M: "BH12M",
      BHF: "BHF",
    };
    const warranty = warrantyShortMap[input.warrantyPolicy];
    if (warranty) parts.push(warranty);
  }
  return parts.join(" ");
}
