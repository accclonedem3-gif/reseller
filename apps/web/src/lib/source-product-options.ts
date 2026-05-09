export const sourceProductFamilyOptions = [
  { value: "CHATGPT", label: "ChatGPT" },
  { value: "VEO3", label: "Veo 3" },
  { value: "CLAUDE", label: "Claude" },
  { value: "GEMINI", label: "Gemini" },
  { value: "CANVA", label: "Canva" },
  { value: "CAPCUT", label: "CapCut" },
  { value: "OTHER", label: "Khác" },
] as const;

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
  { value: "BH6M", label: "Bảo hành 6 tháng" },
  { value: "BH12M", label: "Bảo hành 12 tháng" },
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
