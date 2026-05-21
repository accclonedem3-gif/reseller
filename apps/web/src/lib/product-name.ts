type Replacement = [RegExp, string | ((match: string, ...groups: string[]) => string)];

function applyReplacements(value: string, replacements: Replacement[]) {
  let result = String(value || "");
  for (const [pattern, replacement] of replacements) {
    result = result.replace(pattern, replacement as never);
  }
  return result.replace(/\s+/g, " ").trim();
}

function normalizeSource(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, (c) => (c === "đ" ? "d" : "D"))
    .replace(/\s+/g, " ")
    .trim();
}

function formatCount(raw: string, unit: "day" | "month" | "year") {
  const n = Number(raw || 0);
  return `${raw} ${n === 1 ? unit : `${unit}s`}`;
}

export function translateProductNameToEnglish(value: string): string {
  const normalized = normalizeSource(value);

  const withDurations = applyReplacements(normalized, [
    [/\b(\d+)\s*năm\b/gi, (_m, a) => formatCount(a, "year")],
    [/\b(\d+)\s*nam\b/gi, (_m, a) => formatCount(a, "year")],
    [/\b(\d+)\s*tháng\b/gi, (_m, a) => formatCount(a, "month")],
    [/\b(\d+)\s*thang\b/gi, (_m, a) => formatCount(a, "month")],
    [/\b(\d+)\s*ngày\b/gi, (_m, a) => formatCount(a, "day")],
    [/\b(\d+)\s*ngay\b/gi, (_m, a) => formatCount(a, "day")],
    [/\b(\d+)\s*t\b/gi, (_m, a) => formatCount(a, "month")],
    [/\b(\d+)\s*th\b/gi, (_m, a) => formatCount(a, "month")],
    [/\b(\d+)\s*n\b/gi, (_m, a) => formatCount(a, "year")],
  ]);

  const translated = applyReplacements(withDurations, [
    [/\btài\s*khoản\s*chính\s*chủ\b/gi, "personal account"],
    [/\btai\s*khoan\s*chinh\s*chu\b/gi, "personal account"],
    [/\btk\s*chính\s*chủ\b/gi, "personal account"],
    [/\btk\s*chinh\s*chu\b/gi, "personal account"],
    [/\bchính\s*chủ\b/gi, "personal"],
    [/\bchinh\s*chu\b/gi, "personal"],
    [/\btk\b/gi, "account"],
    [/\btài\s*khoản\b/gi, "account"],
    [/\btai\s*khoan\b/gi, "account"],
    [/\bgói\b/gi, "package"],
    [/\bgoi\b/gi, "package"],
    [/\bvĩnh\s*viễn\b/gi, "lifetime"],
    [/\bvinh\s*vien\b/gi, "lifetime"],
    [/\btrọn\s*đời\b/gi, "lifetime"],
    [/\btron\s*doi\b/gi, "lifetime"],
    [/\bkhông\s*bảo\s*hành\b/gi, "no warranty"],
    [/\bkhong\s*bao\s*hanh\b/gi, "no warranty"],
    [/\bbảo\s*hành\s*đầy\s*đủ\b/gi, "full warranty"],
    [/\bbao\s*hanh\s*day\s*du\b/gi, "full warranty"],
    [/\bbảo\s*hành\s*full\b/gi, "full warranty"],
    [/\bbao\s*hanh\s*full\b/gi, "full warranty"],
    [/\bfull\s*bảo\s*hành\b/gi, "full warranty"],
    [/\bfull\s*bao\s*hanh\b/gi, "full warranty"],
    [/\bmail\s*có\s*sẵn\b/gi, "stock mail"],
    [/\bmail\s*co\s*san\b/gi, "stock mail"],
    [/\bngẫu\s*nhiên\b/gi, "random"],
    [/\bngau\s*nhien\b/gi, "random"],
    [/\bthêm\s*family\b/gi, "add family"],
    [/\bthem\s*family\b/gi, "add family"],
    [/\bthêm\s*fam\b/gi, "add fam"],
    [/\bthem\s*fam\b/gi, "add fam"],
    [/\bbảo\s*hành\b/gi, "warranty"],
    [/\bbao\s*hanh\b/gi, "warranty"],
  ]);

  return applyReplacements(translated, [
    [/\baccount\s+personal\b/gi, "personal account"],
    [/\bpackage\s+team(\d+)\b/gi, "team $1 package"],
    [/\bteam(\d+)\b/gi, "team $1"],
  ]);
}

export function localizeProductName(value: string, lang: string): string {
  if (lang === "th" || lang === "en") return translateProductNameToEnglish(value);
  return value;
}
