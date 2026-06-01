import { useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { ShieldCheck, ShieldAlert, Search, CheckCircle, Loader2, AlertCircle, Clock, ArrowLeft } from "lucide-react";
import { api } from "@/lib/api";
import { useLang } from "@/lib/lang";

const T = {
  vi: {
    invalidLink: "Link bảo hành không hợp lệ.",
    shopWarranty: (name: string) => `${name} — Bảo hành`,
    warranty: "Bảo hành sản phẩm",
    formTitle: "Yêu cầu bảo hành",
    formDesc: "Điền thông tin để tra cứu đơn hàng và mở yêu cầu bảo hành",
    labelContact: "Thông tin liên hệ",
    phContact: "SĐT/Zalo hoặc @username Telegram",
    hintContact: "Để xác định bạn là người mua hàng",
    labelAccount: "Tài khoản đã mua / Mã hóa đơn",
    phAccount: "Nhập tài khoản đã nhận, hoặc mã hóa đơn (ORD-...)",
    hintAccount: "Khách lẻ: nhập tài khoản đang dùng → bảo hành đúng tài khoản đó. Nếu có mã hóa đơn (ORD-...): nhập để xem cả hóa đơn và chọn tài khoản.",
    labelClaimCode: "Mã bảo hành",
    phClaimCode: "Nhập mã bảo hành trong tin nhắn nhận tài khoản",
    hintClaimCode: "Mã bí mật shop gửi kèm khi giao tài khoản (đơn cũ trước đây có thể bỏ trống)",
    errRequired: "Vui lòng điền đầy đủ thông tin.",
    errNotFound: "Không tìm thấy đơn hàng nào phù hợp hoặc đơn hàng đã hết hạn bảo hành.",
    errDefault: "Đã có lỗi xảy ra. Vui lòng thử lại.",
    errClaim: "Không thể gửi yêu cầu bảo hành. Vui lòng thử lại.",
    searchBtn: "Tra cứu đơn hàng",
    backBtn: "Tìm kiếm lại",
    selectTitle: "Chọn đơn hàng cần bảo hành",
    purchasedAt: (d: string) => `Mua ngày: ${d}`,
    expiresAt: (d: string) => `HSD bảo hành: ${d}`,
    activeClaim: "Đang có yêu cầu bảo hành",
    descTitle: "Mô tả vấn đề (tùy chọn)",
    descPh: "Mô tả lỗi hoặc vấn đề bạn gặp phải...",
    claimAccountsTitle: "Tài khoản cần bảo hành",
    claimAccountsHint: "Nhập username/email các tài khoản lỗi, cách nhau bởi dấu phẩy hoặc xuống dòng. Để trống = bảo hành toàn bộ hóa đơn.",
    claimAccountsPh: "user1@gmail.com, user2@gmail.com ...",
    acctModeHint: "Bạn đang yêu cầu bảo hành cho tài khoản này:",
    orderModeHint: "Chọn (các) tài khoản trong đơn cần bảo hành:",
    selectAllLabel: "Chọn tất cả",
    clearAllLabel: "Bỏ chọn tất cả",
    changedPwToggle: "Tôi đã đổi mật khẩu (nhập mật khẩu mới cho từng tài khoản)",
    newPwPh: "Mật khẩu mới",
    resolvedTitle: "Tài khoản thay thế đã cấp",
    resolvedHint: "Bạn đã được bảo hành — bấm để copy lại tài khoản thay thế",
    copiedToast: "Đã copy!",
    submitBtn: "Gửi yêu cầu bảo hành",
    successTitle: "Bảo hành đã được duyệt!",
    successOrder: (code: string) => `Đơn #${code}`,
    replacementLabel: "Tài khoản thay thế",
    pendingTitle: "Chưa xác minh được",
    pendingDefault: "Hệ thống chưa kiểm chính xác. Bấm 🛡 Bảo hành lại để thử thêm, hoặc shop sẽ xem xét nếu vẫn không xác minh được.",
    supportLabel: "Liên hệ hỗ trợ",
    autoCheckTitle: "Đang kiểm tra tài khoản",
    autoCheckQueuePos: (n: number) => `Vị trí xếp hàng: #${n}`,
    autoCheckQueueAhead: (n: number) => n === 0 ? "Sắp tới lượt của bạn..." : `Còn ${n} yêu cầu đang xử lý trước bạn`,
    autoCheckActive: "Đang đăng nhập và kiểm tra...",
    autoCheckRunning: "Hệ thống đang đăng nhập và kiểm tra gói cùng hạn dùng...",
    autoCheckProgress: (done: number, total: number) => `Đã kiểm tra ${done}/${total} tài khoản`,
    autoCheckProgressRetry: (done: number, total: number) => `Đang kiểm tra lại (${done}/${total} tài khoản)`,
    autoCheckDoneTitle: "Đã kiểm tra xong",
    autoCheckPendingReviewDesc: "Shop sẽ xem xét yêu cầu và phản hồi cho bạn sớm.",
    autoCheckFailedDesc: "Hệ thống chưa kiểm tra được tự động. Shop sẽ xem xét yêu cầu thủ công.",
    autoCheckSoftFailedTitle: "Chưa xác minh được",
    autoCheckSoftFailedRetryHint: "Bấm 🛡 Bảo hành lại để thử thêm. Nếu vẫn không xác minh được, shop sẽ xem xét.",
    autoCheckSoftFailedWrongPassTitle: "🔑 Mật khẩu không đúng",
    autoCheckSoftFailedWrongPassHint: "Không đăng nhập được tài khoản (có thể đã đổi mật khẩu). Shop sẽ xem xét và xử lý giúp bạn.",
    autoCheckReason: (errorType: string) => {
      const et = String(errorType || "").toLowerCase();
      if (et === "wrong_password") return "Mật khẩu không đúng";
      if (et === "login_stuck") return "Mật khẩu không đúng hoặc lỗi đăng nhập";
      if (et === "2fa") return "Tài khoản yêu cầu xác thực 2 bước (OTP)";
      if (et === "proxy_die") return "Lỗi kết nối — vui lòng thử lại";
      if (et === "cf_timeout") return "Cloudflare chặn tạm thời — thử lại sau ít phút";
      if (et === "blocked") return "Tài khoản bị khoá";
      return "Hệ thống chưa kiểm chính xác — có thể do mạng chậm";
    },
    replacedTitle: "Bảo hành đã được duyệt!",
    replacedDesc: (n: number, planLabel?: string) =>
      `Phát hiện ${n} tài khoản mất gói ${planLabel || "trả phí"}. Đã thay thế ${n} tài khoản mới.`,
    rejectedTitle: "Tài khoản vẫn còn hạn",
    rejectedDesc: "Tài khoản vẫn đang hoạt động bình thường, chưa đủ điều kiện bảo hành.",
    pwdChangedTitle: "Tài khoản bảo hành đã đổi mật khẩu",
    pwdChangedDesc: "Nếu bạn đã đổi mật khẩu sau khi nhận tài khoản, nhập mật khẩu hiện tại để hệ thống kiểm tra chính xác.",
    pwdLabel: "Mật khẩu hiện tại",
    pwdPh: "Mật khẩu bạn đang dùng",
    pwdPhKeep: "Để trống = giữ mật khẩu cũ",
    pwdForAccount: (email: string) => `Mật khẩu cho ${email}`,
    pwdHintEnterAccounts: "Nhập tài khoản cụ thể ở ô \"Tài khoản cần bảo hành\" phía trên để hiện ô đổi mật khẩu cho từng tài khoản.",
    pwdToggleShow: "Hiện",
    pwdToggleHide: "Ẩn",
    wrongPasswordRetryBox: "Hệ thống đăng nhập không được vì sai mật khẩu. Bấm Bảo hành lại, nhập mật khẩu hiện tại của tài khoản rồi gửi để kiểm tra lại.",
  },
  en: {
    invalidLink: "Invalid warranty link.",
    shopWarranty: (name: string) => `${name} — Warranty`,
    warranty: "Product warranty",
    formTitle: "Submit warranty claim",
    formDesc: "Fill in your details to look up your order and submit a warranty request",
    labelContact: "Contact information",
    phContact: "Phone/Zalo or @username Telegram",
    hintContact: "To verify you are the buyer",
    labelAccount: "Purchased account / Order code",
    phAccount: "Enter the account you received, or an order code (ORD-...)",
    hintAccount: "Retail buyer: enter your account → warranty just that account. Have an order code (ORD-...)? Enter it to see the full invoice and pick accounts.",
    labelClaimCode: "Warranty code",
    phClaimCode: "Enter the warranty code from your delivery message",
    hintClaimCode: "The secret code the shop sent with your account (older orders may leave this blank)",
    errRequired: "Please fill in all required fields.",
    errNotFound: "No matching order found or the warranty has expired.",
    errDefault: "An error occurred. Please try again.",
    errClaim: "Could not submit warranty claim. Please try again.",
    searchBtn: "Look up order",
    backBtn: "Search again",
    selectTitle: "Select the order to warranty",
    purchasedAt: (d: string) => `Purchased: ${d}`,
    expiresAt: (d: string) => `Warranty expires: ${d}`,
    activeClaim: "Active warranty claim",
    descTitle: "Describe the issue (optional)",
    descPh: "Describe the error or issue you encountered...",
    claimAccountsTitle: "Accounts to warranty",
    claimAccountsHint: "Enter usernames/emails of broken accounts, separated by commas or newlines. Leave blank = warranty entire order.",
    claimAccountsPh: "user1@gmail.com, user2@gmail.com ...",
    acctModeHint: "You are requesting warranty for this account:",
    orderModeHint: "Select the account(s) in this order to warranty:",
    selectAllLabel: "Select all",
    clearAllLabel: "Clear all",
    changedPwToggle: "I changed the password (enter a new password per account)",
    newPwPh: "New password",
    resolvedTitle: "Replacement account(s) issued",
    resolvedHint: "You were already issued these — tap to copy again",
    copiedToast: "Copied!",
    submitBtn: "Submit warranty claim",
    successTitle: "Warranty approved!",
    successOrder: (code: string) => `Order #${code}`,
    replacementLabel: "Replacement account",
    pendingTitle: "Couldn't verify",
    pendingDefault: "Auto-check couldn't conclude. Tap 🛡 Submit again to retry, or the shop will review if it keeps failing.",
    supportLabel: "Contact support",
    autoCheckTitle: "Checking your account",
    autoCheckQueuePos: (n: number) => `Queue position: #${n}`,
    autoCheckQueueAhead: (n: number) => n === 0 ? "You're next in line..." : `${n} request(s) being processed ahead of you`,
    autoCheckActive: "Logging in and checking...",
    autoCheckRunning: "The system is logging in and checking the account plan & expiry...",
    autoCheckProgress: (done: number, total: number) => `Checked ${done}/${total} account(s)`,
    autoCheckProgressRetry: (done: number, total: number) => `Retrying check (${done}/${total} accounts)`,
    autoCheckDoneTitle: "Check completed",
    autoCheckPendingReviewDesc: "The seller will review your request and respond shortly.",
    autoCheckFailedDesc: "Auto-check could not complete. The seller will review manually.",
    autoCheckSoftFailedTitle: "Couldn't verify",
    autoCheckSoftFailedRetryHint: "Tap 🛡 Submit again to retry. If it keeps failing, the shop will review.",
    autoCheckSoftFailedWrongPassTitle: "🔑 Wrong password",
    autoCheckSoftFailedWrongPassHint: "Couldn't sign in to the account (the password may have changed). The shop will review and handle it for you.",
    autoCheckReason: (errorType: string) => {
      const et = String(errorType || "").toLowerCase();
      if (et === "wrong_password") return "Wrong password";
      if (et === "login_stuck") return "Wrong password or login error";
      if (et === "2fa") return "Account requires 2FA (OTP)";
      if (et === "proxy_die") return "Network error — please retry";
      if (et === "cf_timeout") return "Cloudflare blocked temporarily — retry in a moment";
      if (et === "blocked") return "Account is blocked";
      return "Couldn't verify — possibly slow network";
    },
    replacedTitle: "Warranty approved!",
    replacedDesc: (n: number, planLabel?: string) =>
      `${n} account(s) lost their ${planLabel || "paid"} plan. ${n} replacement account(s) issued.`,
    rejectedTitle: "Account still active",
    rejectedDesc: "The account is still on a paid plan — warranty not applicable.",
    pwdChangedTitle: "I changed the account password",
    pwdChangedDesc: "If you changed the password after receiving the account, enter the current one so the system can check it accurately.",
    pwdLabel: "Current password",
    pwdPh: "Password you are using now",
    pwdPhKeep: "Leave blank = keep original password",
    pwdForAccount: (email: string) => `Password for ${email}`,
    pwdHintEnterAccounts: "Enter specific accounts in the \"Accounts to warranty\" field above to show per-account password inputs.",
    pwdToggleShow: "Show",
    pwdToggleHide: "Hide",
    wrongPasswordRetryBox: "The checker could not log in because the password is wrong. Tap Submit again, enter the account's current password, then submit to check again.",
  },
  th: {
    invalidLink: "ลิงก์การรับประกันไม่ถูกต้อง",
    shopWarranty: (name: string) => `${name} — การรับประกัน`,
    warranty: "การรับประกันสินค้า",
    formTitle: "ส่งคำร้องขอรับประกัน",
    formDesc: "กรอกข้อมูลเพื่อค้นหาคำสั่งซื้อและส่งคำร้องขอรับประกัน",
    labelContact: "ข้อมูลติดต่อ",
    phContact: "เบอร์โทร/Zalo หรือ @username Telegram",
    hintContact: "เพื่อยืนยันว่าคุณเป็นผู้ซื้อ",
    labelAccount: "บัญชีที่ซื้อ / รหัสคำสั่งซื้อ",
    phAccount: "กรอกบัญชีที่ได้รับ หรือรหัสคำสั่งซื้อ (ORD-...)",
    hintAccount: "ลูกค้าปลีก: กรอกบัญชีของคุณ → รับประกันเฉพาะบัญชีนั้น มีรหัสคำสั่งซื้อ (ORD-...)? กรอกเพื่อดูใบเสร็จและเลือกบัญชี",
    labelClaimCode: "รหัสรับประกัน",
    phClaimCode: "กรอกรหัสรับประกันจากข้อความรับบัญชี",
    hintClaimCode: "รหัสลับที่ร้านส่งมาพร้อมบัญชี (คำสั่งซื้อเก่าสามารถเว้นว่างได้)",
    errRequired: "กรุณากรอกข้อมูลให้ครบถ้วน",
    errNotFound: "ไม่พบคำสั่งซื้อที่ตรงกันหรือการรับประกันหมดอายุแล้ว",
    errDefault: "เกิดข้อผิดพลาด กรุณาลองใหม่",
    errClaim: "ไม่สามารถส่งคำร้องขอรับประกันได้ กรุณาลองใหม่",
    searchBtn: "ค้นหาคำสั่งซื้อ",
    backBtn: "ค้นหาใหม่",
    selectTitle: "เลือกคำสั่งซื้อที่ต้องการรับประกัน",
    purchasedAt: (d: string) => `วันที่ซื้อ: ${d}`,
    expiresAt: (d: string) => `การรับประกันหมดอายุ: ${d}`,
    activeClaim: "มีคำร้องขอรับประกันที่ใช้งานอยู่",
    descTitle: "อธิบายปัญหา (ไม่บังคับ)",
    descPh: "อธิบายข้อผิดพลาดหรือปัญหาที่คุณพบ...",
    claimAccountsTitle: "บัญชีที่ต้องการรับประกัน",
    claimAccountsHint: "ใส่ username/email ของบัญชีที่มีปัญหา คั่นด้วยจุลภาคหรือขึ้นบรรทัดใหม่ เว้นว่าง = รับประกันทั้งคำสั่งซื้อ",
    claimAccountsPh: "user1@gmail.com, user2@gmail.com ...",
    acctModeHint: "คุณกำลังขอรับประกันบัญชีนี้:",
    orderModeHint: "เลือกบัญชีในคำสั่งซื้อที่ต้องการรับประกัน:",
    selectAllLabel: "เลือกทั้งหมด",
    clearAllLabel: "ล้างการเลือก",
    changedPwToggle: "ฉันเปลี่ยนรหัสผ่านแล้ว (กรอกรหัสผ่านใหม่ของแต่ละบัญชี)",
    newPwPh: "รหัสผ่านใหม่",
    resolvedTitle: "บัญชีทดแทนที่ออกให้แล้ว",
    resolvedHint: "คุณได้รับการรับประกันแล้ว — แตะเพื่อคัดลอกอีกครั้ง",
    copiedToast: "คัดลอกแล้ว!",
    submitBtn: "ส่งคำร้องขอรับประกัน",
    successTitle: "อนุมัติการรับประกันแล้ว!",
    successOrder: (code: string) => `คำสั่งซื้อ #${code}`,
    replacementLabel: "บัญชีทดแทน",
    pendingTitle: "ไม่สามารถยืนยันได้",
    pendingDefault: "ระบบยังตรวจสอบไม่ได้ กดปุ่ม 🛡 ส่งคำร้องอีกครั้งเพื่อลองใหม่ หรือร้านค้าจะตรวจสอบหากยังไม่ผ่าน",
    supportLabel: "ติดต่อสนับสนุน",
    autoCheckTitle: "กำลังตรวจสอบบัญชี",
    autoCheckQueuePos: (n: number) => `คิว #${n}`,
    autoCheckQueueAhead: (n: number) => n === 0 ? "ใกล้ถึงคิวของคุณแล้ว..." : `มีคำขอ ${n} รายการกำลังประมวลผลก่อนคุณ`,
    autoCheckActive: "กำลังเข้าสู่ระบบและตรวจสอบ...",
    autoCheckRunning: "ระบบกำลังเข้าสู่ระบบบัญชีและตรวจสอบแพ็คเกจ...",
    autoCheckProgress: (done: number, total: number) => `ตรวจสอบแล้ว ${done}/${total} บัญชี`,
    autoCheckProgressRetry: (done: number, total: number) => `กำลังตรวจสอบใหม่ (${done}/${total} บัญชี)`,
    autoCheckDoneTitle: "ตรวจสอบเรียบร้อย",
    autoCheckPendingReviewDesc: "ผู้ขายจะตรวจสอบคำขอและตอบกลับให้คุณโดยเร็ว",
    autoCheckFailedDesc: "ระบบตรวจสอบอัตโนมัติไม่สำเร็จ ผู้ขายจะตรวจสอบด้วยตนเอง",
    autoCheckSoftFailedTitle: "ไม่สามารถยืนยันได้",
    autoCheckSoftFailedRetryHint: "กด 🛡 ส่งคำร้องอีกครั้งเพื่อลองใหม่ หากยังไม่ผ่าน ร้านค้าจะตรวจสอบ",
    autoCheckSoftFailedWrongPassTitle: "🔑 รหัสผ่านไม่ถูกต้อง",
    autoCheckSoftFailedWrongPassHint: "เข้าสู่ระบบบัญชีไม่ได้ (อาจเปลี่ยนรหัสผ่านแล้ว) ร้านค้าจะตรวจสอบและดำเนินการให้คุณ",
    autoCheckReason: (errorType: string) => {
      const et = String(errorType || "").toLowerCase();
      if (et === "wrong_password") return "รหัสผ่านไม่ถูกต้อง";
      if (et === "login_stuck") return "รหัสผ่านไม่ถูกต้องหรือข้อผิดพลาดการเข้าสู่ระบบ";
      if (et === "2fa") return "บัญชีต้องการการยืนยัน 2 ขั้นตอน (OTP)";
      if (et === "proxy_die") return "ข้อผิดพลาดเครือข่าย — กรุณาลองใหม่";
      if (et === "cf_timeout") return "Cloudflare บล็อกชั่วคราว — ลองใหม่ภายหลัง";
      if (et === "blocked") return "บัญชีถูกระงับ";
      return "ไม่สามารถตรวจสอบได้ — อาจเป็นเครือข่ายช้า";
    },
    replacedTitle: "อนุมัติการรับประกันแล้ว!",
    replacedDesc: (n: number, planLabel?: string) =>
      `พบ ${n} บัญชีที่หมดแพ็คเกจ${planLabel ? ` ${planLabel}` : ""} เปลี่ยนบัญชีใหม่ ${n} บัญชีแล้ว`,
    rejectedTitle: "บัญชียังใช้งานได้",
    rejectedDesc: "บัญชียังอยู่ในแพ็คเกจที่ชำระเงิน — ไม่มีสิทธิ์รับประกัน",
    pwdChangedTitle: "บัญชีรับประกันเปลี่ยนรหัสผ่านแล้ว",
    pwdChangedDesc: "ถ้าคุณเปลี่ยนรหัสผ่านหลังจากรับบัญชี กรุณากรอกรหัสปัจจุบันเพื่อให้ระบบตรวจสอบได้ถูกต้อง",
    pwdLabel: "รหัสผ่านปัจจุบัน",
    pwdPh: "รหัสผ่านที่ใช้อยู่",
    pwdPhKeep: "เว้นว่าง = ใช้รหัสผ่านเดิม",
    pwdForAccount: (email: string) => `รหัสผ่านของ ${email}`,
    pwdHintEnterAccounts: "กรอกบัญชีเฉพาะในช่อง \"บัญชีที่ต้องการรับประกัน\" ด้านบน เพื่อแสดงช่องเปลี่ยนรหัสผ่านของแต่ละบัญชี",
    pwdToggleShow: "แสดง",
    pwdToggleHide: "ซ่อน",
    wrongPasswordRetryBox: "The checker could not log in because the password is wrong. Submit again with the account's current password.",
  },
};

type Step = "form" | "confirm" | "result";

type OrderResult = {
  orderId: string;
  orderCode: string | null; // null in account-search mode (hidden from retail customers)
  searchMode?: "account" | "order";
  productName: string;
  productImageUrl?: string | null;
  deliveredAt: string | null;
  warrantyExpiresAt: string | null;
  warrantyPolicy: string | null;
  hasActiveClaim: boolean;
  accountUsernames?: string[];
  resolvedAccounts?: string[]; // replacement creds already issued (for re-copy)
};

type SearchResponse = {
  shop: { name: string; supportTelegram: string | null; supportZalo: string | null };
  orders: OrderResult[];
};

type WarrantyInvoice = {
  orderCode: string | null; // null when account-scoped (hidden from retail customers)
  productName: string;
  sellerContact: string | null;
  sellerShopName: string;
  buyerUsername: string | null;
  buyerName: string | null;
  buyerTelegramId: string | null;
  deliveredAccountText: string | null;
  quantity: number | null; // null when account-scoped
  totalSaleAmount: number | null;
  warrantyPolicy: string | null;
  warrantyStartedAt: string | null;
  warrantyExpiresAt: string | null;
  createdAt: string;
  deliveredAt: string | null;
  orderStatus: string;
  resolvedClaimCount: number | null;
  resolvedAccountCount?: number | null;
};

type ClaimResponse = {
  success: boolean;
  status: string;
  claimId: string;
  orderCode: string;
  deliveredAccountText: string | null;
  message: string;
  supportTelegram: string | null;
  supportZalo: string | null;
  accessToken?: string;
  autoCheck?: {
    tool?: string;
    status?: string;
    queuePosition?: number | null;
    queueLoad?: number;
  };
  invoice?: WarrantyInvoice | null;
};

type AutoCheckStatusResponse = {
  id?: string;
  autoCheckStatus: string | null;
  autoCheckTool?: string | null;
  autoCheckResult?: any | null;
  autoCheckErrorMessage?: string | null;
  autoCheckStartedAt?: string | null;
  autoCheckCompletedAt?: string | null;
  queuePosition?: number | null;
  queueState?: "active" | "waiting" | null;
  queueAheadCount?: number;
  autoCheckProgress?: {
    completed: number;
    total: number;
    tool: string | null;
    phase: "initial" | "retry" | null;
  } | null;
  status?: string;
  resolutionNote?: string | null;
  deliveredAccountText?: string | null;
  invoice?: WarrantyInvoice | null;
  // Public flags the BE sets unconditionally (no token needed) so the claim page can render
  // the right soft-fail message. See warranty-auto-check.service.ts (getAutoCheckStatus return).
  softFailed?: boolean | null;
  publicErrorType?: string | null;
};

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function isWrongPasswordResult(value: any) {
  return String(value?.errorType || value?.error_type || "").toLowerCase() === "wrong_password";
}

function getWrongPasswordAccounts(
  auto: AutoCheckStatusResponse | null,
  selectedOrder: OrderResult | null,
) {
  const result = auto?.autoCheckResult || null;
  if (!result) return [] as string[];

  const accounts = Array.isArray(result.accounts) ? result.accounts : [];
  const fromAccounts = accounts
    .filter(isWrongPasswordResult)
    .map((account: any) => String(account.email || "").trim())
    .filter(Boolean);

  if (fromAccounts.length > 0) return Array.from(new Set(fromAccounts));
  if (!isWrongPasswordResult(result)) return [] as string[];

  const known = selectedOrder?.accountUsernames || [];
  return known.length === 1 ? [known[0]!] : [];
}

function InputField({
  label,
  placeholder,
  value,
  onChange,
  hint,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-semibold" style={{ color: "var(--tx)" }}>
        {label}
      </label>
      {hint && <p className="text-xs" style={{ color: "var(--tx-f)" }}>{hint}</p>}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-[10px] border px-3.5 py-2.5 text-sm outline-none transition-colors"
        style={{ background: "var(--inp)", borderColor: "var(--bd)", color: "var(--tx)" }}
      />
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[20px] border p-6" style={{ background: "var(--surface)", borderColor: "var(--bd)" }}>
      {children}
    </div>
  );
}

// Customer-facing warranty duration label. The verbose "BH mặc định 30 ngày; tổng thời gian
// X tháng" wording belonged in admin/seller-side UI; for customers, the only useful info is
// the total duration. Render site already prepends "BH " so labels here are just the period.
const WARRANTY_POLICY_LABEL: Record<string, string> = {
  KBH:   "Không bảo hành",
  BH24H: "24 giờ",
  BH1M:  "1 tháng",
  BH3M:  "3 tháng",
  BH6M:  "6 tháng",
  BH12M: "12 tháng",
  BHF:   "Vĩnh viễn",
};

function formatVnd(n: number): string {
  return new Intl.NumberFormat("vi-VN").format(Math.max(0, Math.round(n))) + "đ";
}

function formatInvoiceDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)}`;
}

function parseAccountList(text: string | null): string[] {
  if (!text) return [];
  return text
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l, i) => (/^\d+\./.test(l) ? l : `${i + 1}. ${l}`));
}

/**
 * Balanced warranty receipt card (redesign 2026-05-25). Same density model as the bot's
 * lookup output — keep useful fields, drop the prose labels ("Mã đơn:", "Sản phẩm:",
 * "Trạng thái refund:" etc.), let the emoji + value carry meaning. Sections separated by
 * subtle dividers so the eye scans top-to-bottom: identity → warranty → accounts → refund.
 */
function WarrantyInvoiceCard({ invoice }: { invoice: WarrantyInvoice }) {
  const now = Date.now();
  const startedAt = invoice.warrantyStartedAt || invoice.deliveredAt;
  const expiresAt = invoice.warrantyExpiresAt;
  const daysUsed = startedAt ? Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 86_400_000)) : null;
  const daysLeft = expiresAt ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 86_400_000)) : null;

  const fmtDate = (d: string | null | undefined) =>
    d ? new Date(d).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
  const expiresLabel = expiresAt ? fmtDate(expiresAt) : "vĩnh viễn";
  const createdLabel = fmtDate(invoice.createdAt);

  // Count ACCOUNTS resolved (refunded/replaced), not claims — a single claim can cover several
  // accounts (e.g. 4 of a 5-acc order). Fall back to claim count for older API responses.
  const refunded = invoice.resolvedAccountCount ?? invoice.resolvedClaimCount ?? 0;
  const refundIsDone = refunded > 0;
  const pricePerAcc = invoice.quantity && invoice.quantity > 0
    ? Math.round((invoice.totalSaleAmount ?? 0) / invoice.quantity)
    : (invoice.totalSaleAmount ?? 0);
  const accountLines = parseAccountList(invoice.deliveredAccountText);
  const warrantyShort = invoice.warrantyPolicy
    ? (WARRANTY_POLICY_LABEL[invoice.warrantyPolicy.toUpperCase()] || invoice.warrantyPolicy)
    : null;

  const Row = ({ icon, children }: { icon: string; children: React.ReactNode }) => (
    <div className="flex gap-2.5 text-sm leading-snug" style={{ color: "var(--tx)" }}>
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1 break-all">{children}</span>
    </div>
  );

  return (
    <div
      className="rounded-[16px] border p-4 space-y-3.5"
      style={{ background: "var(--inp)", borderColor: "var(--bd)" }}
    >
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide" style={{ color: "var(--tx-m)" }}>
        <span>🧾</span><span>Hóa đơn bảo hành</span>
      </div>

      {/* ── Order identity ─────────────────────────── */}
      <div className="space-y-1.5">
        {/* Order code hidden when account-scoped (retail customer) */}
        {invoice.orderCode && <Row icon="📦"><span className="font-mono">{invoice.orderCode}</span></Row>}
        <Row icon="🏷">
          <span className="font-medium">{invoice.productName}</span>
          {invoice.quantity != null && (
            <span style={{ color: "var(--tx-m)" }}> · {invoice.quantity} acc · {formatVnd(invoice.totalSaleAmount ?? 0)}</span>
          )}
        </Row>
        {(invoice.buyerUsername || invoice.buyerName || invoice.buyerTelegramId) && (
          <Row icon="👤">
            {invoice.buyerUsername ? (
              <>
                <span className="font-medium">@{invoice.buyerUsername}</span>
                {invoice.buyerName && (
                  <span style={{ color: "var(--tx-m)" }}> ({invoice.buyerName})</span>
                )}
              </>
            ) : invoice.buyerName ? (
              <span className="font-medium">{invoice.buyerName}</span>
            ) : (
              <span className="font-mono" style={{ color: "var(--tx-m)" }}>#{invoice.buyerTelegramId}</span>
            )}
          </Row>
        )}
      </div>

      {/* ── Warranty window ────────────────────────── */}
      <div className="space-y-1.5 pt-1">
        {warrantyShort && <Row icon="🛡"><span className="font-medium">{warrantyShort}</span></Row>}
        <Row icon="⏰">Hạn <span className="font-medium">{expiresLabel}</span></Row>
        {daysUsed !== null && daysLeft !== null && (
          <Row icon="📊">
            Đã dùng <span className="font-medium">{daysUsed}</span>
            <span style={{ color: "var(--tx-m)" }}> / còn </span>
            <span className="font-medium">{daysLeft}</span>
            <span style={{ color: "var(--tx-m)" }}> ngày</span>
          </Row>
        )}
      </div>

      {/* ── Accounts (tap-to-copy code box) ────────── */}
      {accountLines.length > 0 && (
        <div className="pt-2 border-t" style={{ borderColor: "var(--bd)" }}>
          <div className="flex gap-2 text-xs uppercase tracking-wide mb-1.5" style={{ color: "var(--tx-m)" }}>
            <span>🔑</span><span className="font-semibold">Tài khoản đã giao</span>
          </div>
          <pre
            className="rounded-lg p-2.5 whitespace-pre-wrap break-all font-mono text-xs leading-relaxed"
            style={{ background: "var(--bg, #f8fafc)", color: "var(--tx)" }}
          >
            {accountLines.join("\n")}
          </pre>
        </div>
      )}

      {/* ── Refund + meta ──────────────────────────── */}
      <div className="space-y-1.5 pt-2 border-t" style={{ borderColor: "var(--bd)" }}>
        {/* Refund/economics hidden when account-scoped (retail customer sees only their account + status) */}
        {invoice.quantity != null && (
          <Row icon={refundIsDone ? "✅" : "⏳"}>
            <span
              className="inline-block rounded-full px-2 py-0.5 text-xs font-semibold mr-2"
              style={{
                background: refundIsDone ? "var(--ok-bg, #d1fae5)" : "var(--warn-bg, #fef3c7)",
                color: refundIsDone ? "var(--ok-fg, #047857)" : "var(--warn-fg, #92400e)",
              }}
            >
              {refundIsDone ? `Đã refund ${refunded}/${invoice.quantity}` : `Chưa refund 0/${invoice.quantity}`}
            </span>
            <span style={{ color: "var(--tx-m)" }}>{formatVnd(pricePerAcc)}/acc</span>
          </Row>
        )}
        <Row icon="📅"><span style={{ color: "var(--tx-m)" }}>Tạo {createdLabel}</span></Row>
      </div>
    </div>
  );
}

export function WarrantyClaimPage() {
  const { lang } = useLang();
  // Cast to the vi shape — all three langs share the same structure but TS can't unify the
  // inline function literals (autoCheckReason) across the languages without an explicit hint.
  const t = T[lang] as typeof T["vi"];
  const [searchParams] = useSearchParams();
  const shopSlug = searchParams.get("shop") || "";

  const [step, setStep] = useState<Step>("form");
  const [shopName, setShopName] = useState<string | null>(null);

  const [contactInfo, setContactInfo] = useState("");
  const [accountText, setAccountText] = useState("");
  const [message, setMessage] = useState("");
  const [claimAccountsText, setClaimAccountsText] = useState("");
  const [hasNewPassword, setHasNewPassword] = useState(false);
  const [passwordMap, setPasswordMap] = useState<Record<string, string>>({});
  const [revealMap, setRevealMap] = useState<Record<string, boolean>>({});
  const [copiedAt, setCopiedAt] = useState<number | null>(null);

  const [orders, setOrders] = useState<OrderResult[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<OrderResult | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ClaimResponse | null>(null);
  const [autoCheck, setAutoCheck] = useState<AutoCheckStatusResponse | null>(null);

  // Accounts to render in the password-override grid. ONLY shown when the customer has typed
  // specific usernames in "Tài khoản cần bảo hành" — otherwise the form assumes default
  // passwords for every account on the order. Avoids dumping 10 inputs on a 10-account order
  // when the customer hasn't actually changed any passwords.
  const accountsForPwdGrid = useMemo(() => {
    const all = selectedOrder?.accountUsernames || [];
    if (all.length === 0) return [];
    const raw = claimAccountsText.trim();
    if (!raw) return [];
    const targets = raw.split(/[\n,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (targets.length === 0) return [];
    return all.filter((email) => {
      const e = email.toLowerCase();
      return targets.some((t) => e === t || e.split("@")[0] === t || e.startsWith(t));
    });
  }, [selectedOrder, claimAccountsText]);

  // Set of currently-selected account emails (claimAccountsText is the source of truth).
  const selectedAccountSet = useMemo(
    () => new Set(claimAccountsText.split(/[\n,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean)),
    [claimAccountsText],
  );
  // Checkbox toggle (order-code mode: customer ticks which accounts of the invoice to warranty).
  function toggleAccount(email: string) {
    const all = selectedOrder?.accountUsernames || [];
    const next = new Set(selectedAccountSet);
    const e = email.toLowerCase();
    if (next.has(e)) next.delete(e); else next.add(e);
    setClaimAccountsText(all.filter((a) => next.has(a.toLowerCase())).join("\n"));
  }
  function toggleAllAccounts() {
    const all = selectedOrder?.accountUsernames || [];
    setClaimAccountsText(selectedAccountSet.size >= all.length ? "" : all.join("\n"));
  }

  // Account-search mode → auto-select the single scoped account so the retail customer just submits.
  useEffect(() => {
    if (selectedOrder?.searchMode === "account" && selectedOrder.accountUsernames?.length) {
      setClaimAccountsText(selectedOrder.accountUsernames.join("\n"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrder?.orderId]);

  useEffect(() => {
    if (!shopSlug) return;
    api
      .get(`/public/warranty/shop/${encodeURIComponent(shopSlug)}`)
      .then((r) => setShopName(r.data.name))
      .catch(() => setShopName(null));
  }, [shopSlug]);

  const wrongPasswordAccounts = useMemo(
    () => getWrongPasswordAccounts(autoCheck, selectedOrder),
    [autoCheck, selectedOrder],
  );
  const shouldPromptPasswordRetry =
    wrongPasswordAccounts.length > 0 || isWrongPasswordResult(autoCheck?.autoCheckResult);

  function handleWarrantyRetry() {
    if (shouldPromptPasswordRetry) {
      setHasNewPassword(true);
      if (wrongPasswordAccounts.length > 0) {
        setClaimAccountsText((current) => current.trim() ? current : wrongPasswordAccounts.join("\n"));
      }
    }
    setResult(null);
    setAutoCheck(null);
    idempotencyKeyRef.current = null;
    setStep(selectedOrder ? "confirm" : "form");
  }

  // Restore a previously-submitted pending claim from localStorage so the customer can resume polling.
  useEffect(() => {
    if (!shopSlug) return;
    try {
      const raw = localStorage.getItem(`warranty-pending-${shopSlug}`);
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        claimId: string;
        accessToken: string;
        orderCode: string;
        savedAt: number;
      };
      // Discard if older than 24h.
      if (Date.now() - saved.savedAt > 24 * 60 * 60 * 1000) {
        localStorage.removeItem(`warranty-pending-${shopSlug}`);
        return;
      }
      setResult({
        success: false,
        status: "auto_check_pending",
        claimId: saved.claimId,
        orderCode: saved.orderCode,
        deliveredAccountText: null,
        message: t.autoCheckRunning,
        supportTelegram: null,
        supportZalo: null,
        accessToken: saved.accessToken,
      });
      setStep("result");
    } catch {}
  }, [shopSlug]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!contactInfo.trim() || !accountText.trim()) {
      setError(t.errRequired);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      // accountText accepts EITHER an account (retail customer → warranties just that account)
      // OR an order code (reseller → full invoice). The backend detects the mode.
      const res = await api.post<SearchResponse>("/public/warranty/search", {
        shopSlug,
        accountText: accountText.trim(),
        contactInfo: contactInfo.trim(),
      });
      setOrders(res.data.orders);
      if (res.data.orders.length === 0) {
        setError(t.errNotFound);
      } else {
        setStep("confirm");
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg || t.errDefault);
    } finally {
      setLoading(false);
    }
  }

  // Idempotency key: stable trong 1 lượt "click Submit" (cùng selectedOrder). Tự reset khi
  // user đổi order hoặc back về form (xem useEffect + onClick handler bên dưới). Server cache
  // response theo key 10 phút → click 2 lần / mạng retry POST → trả lại response cũ thay vì
  // tạo claim mới hoặc trả "limit reached" jarring.
  const idempotencyKeyRef = useRef<string | null>(null);

  useEffect(() => {
    // Switch sang order khác → reset key (cached response của order trước không còn đúng).
    idempotencyKeyRef.current = null;
  }, [selectedOrder?.orderId]);

  async function handleSubmitClaim() {
    if (!selectedOrder) return;
    if (loading) return; // guard chống double-fire khi React chưa render disabled state
    setError(null);
    setLoading(true);
    // Lazy init — retry trong cùng submit attempt (network retry / khách click 2 lần) reuse key.
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    }
    try {
        const parsedTargetUsernames = claimAccountsText.trim()
        ? claimAccountsText.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean)
        : undefined;
      // Per-account new passwords: when the customer toggled "đã đổi mật khẩu" and typed a new pw
      // for an account, send it so the auto-check tool can log in with the changed password.
      const passwordOverrides = hasNewPassword
        ? Object.fromEntries(
            Object.entries(passwordMap)
              .map(([k, v]) => [k, String(v || "").trim()] as const)
              .filter(([, v]) => v.length > 0),
          )
        : undefined;
      const res = await api.post<ClaimResponse>("/public/warranty/claim", {
        orderId: selectedOrder.orderId,
        shopSlug,
        contactInfo: contactInfo.trim(),
        customerMessage: message.trim() || undefined,
        targetUsernames: parsedTargetUsernames,
        passwordOverrides: passwordOverrides && Object.keys(passwordOverrides).length > 0 ? passwordOverrides : undefined,
        idempotencyKey: idempotencyKeyRef.current,
      });
      setResult(res.data);
      setAutoCheck(null);
      setStep("result");
      // Persist pending claim so customer can revisit and resume polling.
      try {
        if (res.data.status === "auto_check_pending" && res.data.accessToken) {
          localStorage.setItem(
            `warranty-pending-${shopSlug}`,
            JSON.stringify({
              claimId: res.data.claimId,
              accessToken: res.data.accessToken,
              orderCode: res.data.orderCode,
              savedAt: Date.now(),
            }),
          );
        } else {
          localStorage.removeItem(`warranty-pending-${shopSlug}`);
        }
      } catch {}
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg || t.errClaim);
    } finally {
      setLoading(false);
    }
  }

  // Poll auto-check status while the claim is in QUEUED/RUNNING state.
  useEffect(() => {
    if (step !== "result" || !result?.claimId) return;
    const activeStatuses = ["auto_check_pending"];
    const isAutoPending = activeStatuses.includes(result.status);
    if (!isAutoPending) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pollCount = 0;
    let errorCount = 0;
    // Upper bound: ~5 phút polling (120 × 2.5s). Bảo vệ trước bất kỳ state lạ nào worker chưa
    // handle (tránh request loop vô tận khi user mở tab và quên).
    const MAX_POLLS = 120;
    const MAX_ERRORS = 5;
    // Bao gồm tất cả terminal states từ WARRANTY_AUTO_CHECK_STATUS: completed/failed thì rõ,
    // overloaded/cancelled cũng terminal (queue saturated hoặc seller resolved tay → ko bao giờ
    // chạy nữa). Thiếu 2 cái này là nguyên nhân poll vô tận sau khi claim đã đóng.
    const AUTO_CHECK_TERMINAL = new Set(
      ["completed", "failed", "unsupported", "skipped", "overloaded", "cancelled"],
    );

    const tick = async () => {
      if (cancelled) return;
      if (pollCount >= MAX_POLLS) {
        try { localStorage.removeItem(`warranty-pending-${shopSlug}`); } catch {}
        return;
      }
      pollCount++;
      try {
        const tokenParam = result.accessToken ? `?token=${encodeURIComponent(result.accessToken)}` : "";
        const r = await api.get<AutoCheckStatusResponse>(
          `/warranty/claims/${encodeURIComponent(result.claimId)}/auto-check${tokenParam}`,
        );
        if (cancelled) return;
        errorCount = 0;
        // Server fallback khi claim không tồn tại (xóa DB / localStorage outdated):
        // return { autoCheckStatus: null } KHÔNG có id/status. Reset về form thay vì để UI
        // mắc kẹt ở loading spinner.
        const isMissingClaim = !r.data || (!r.data.id && !r.data.status && r.data.autoCheckStatus == null);
        if (isMissingClaim) {
          try { localStorage.removeItem(`warranty-pending-${shopSlug}`); } catch {}
          setResult(null);
          setAutoCheck(null);
          setStep("form");
          return;
        }
        setAutoCheck(r.data);
        const autoTerminal = AUTO_CHECK_TERMINAL.has(String(r.data.autoCheckStatus || "").toLowerCase());
        const claimResolved = !!r.data.status && r.data.status !== "PENDING";
        if (autoTerminal || claimResolved) {
          try { localStorage.removeItem(`warranty-pending-${shopSlug}`); } catch {}
        } else {
          timer = setTimeout(tick, 2500);
        }
      } catch {
        if (cancelled) return;
        errorCount++;
        // 5 lần lỗi liên tiếp (network down / 4xx / 5xx) → dừng poll, không reset retry counter,
        // tránh đốt request khi server đang chết.
        if (errorCount >= MAX_ERRORS) {
          try { localStorage.removeItem(`warranty-pending-${shopSlug}`); } catch {}
          return;
        }
        timer = setTimeout(tick, 5000);
      }
    };

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [step, result?.claimId, result?.status]);

  if (!shopSlug) {
    return (
      <PageShell t={t}>
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <ShieldAlert className="h-10 w-10" style={{ color: "var(--tx-f)" }} />
          <p style={{ color: "var(--tx-m)" }}>{t.invalidLink}</p>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell shopName={shopName} t={t}>
      {step === "form" && (
        <Card>
          <div className="mb-5 flex items-center gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
              style={{ background: "rgba(16,185,129,0.12)" }}
            >
              <ShieldCheck className="h-5 w-5 text-emerald-500" />
            </div>
            <div>
              <h2 className="text-base font-bold" style={{ color: "var(--tx)" }}>{t.formTitle}</h2>
              <p className="text-xs" style={{ color: "var(--tx-f)" }}>{t.formDesc}</p>
            </div>
          </div>

          <form onSubmit={handleSearch} className="space-y-4">
            <InputField
              label={t.labelContact}
              placeholder={t.phContact}
              value={contactInfo}
              onChange={setContactInfo}
              hint={t.hintContact}
            />
            <InputField
              label={t.labelAccount}
              placeholder={t.phAccount}
              value={accountText}
              onChange={setAccountText}
              hint={t.hintAccount}
            />

            {error && (
              <div
                className="flex items-start gap-2 rounded-[10px] px-3.5 py-3 text-sm"
                style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "rgb(239,68,68)" }}
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-[12px] py-2.5 text-sm font-bold transition hover:opacity-90 disabled:opacity-50"
              style={{ background: "rgb(16,185,129)", color: "white" }}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {t.searchBtn}
            </button>
          </form>
        </Card>
      )}

      {step === "confirm" && (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => { setStep("form"); setSelectedOrder(null); setError(null); setClaimAccountsText(""); idempotencyKeyRef.current = null; }}
            className="flex items-center gap-1.5 text-sm transition hover:opacity-70"
            style={{ color: "var(--tx-m)" }}
          >
            <ArrowLeft className="h-4 w-4" />
            {t.backBtn}
          </button>

          <Card>
            <h2 className="mb-4 text-base font-bold" style={{ color: "var(--tx)" }}>
              {t.selectTitle}
            </h2>
            <div className="space-y-3">
              {orders.map((order) => (
                <button
                  key={order.orderId}
                  type="button"
                  onClick={() => setSelectedOrder(order.orderId === selectedOrder?.orderId ? null : order)}
                  className="w-full rounded-[12px] border p-4 text-left transition-all duration-150 disabled:opacity-50"
                  style={{
                    borderColor: selectedOrder?.orderId === order.orderId ? "rgb(16,185,129)" : "var(--bd)",
                    background: selectedOrder?.orderId === order.orderId ? "rgba(16,185,129,0.06)" : "var(--inp)",
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      {order.productImageUrl && (
                        <img
                          src={order.productImageUrl}
                          alt=""
                          className="h-10 w-10 shrink-0 rounded-[8px] object-cover"
                          style={{ border: "1px solid var(--bd)" }}
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                        />
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold" style={{ color: "var(--tx)" }}>
                          {order.productName}
                        </p>
                        {/* Order code shown only in order-code (reseller) mode; hidden from retail account search. */}
                        {order.orderCode && (
                          <p className="mt-0.5 text-xs font-mono" style={{ color: "var(--tx-m)" }}>
                            #{order.orderCode}
                          </p>
                        )}
                      </div>
                    </div>
                    {selectedOrder?.orderId === order.orderId && (
                      <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                    )}
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: "var(--tx-f)" }}>
                    <span>{t.purchasedAt(formatDate(order.deliveredAt))}</span>
                    {order.warrantyExpiresAt && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {t.expiresAt(formatDate(order.warrantyExpiresAt))}
                      </span>
                    )}
                    {order.hasActiveClaim && (
                      <span className="font-medium text-amber-500">{t.activeClaim}</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </Card>

          {selectedOrder && (
            <Card>
              <div className="space-y-4">
                {/* Already-issued replacement account(s) — re-copy for a customer who didn't catch
                    their replacement in time. Tap the box to copy. */}
                {(selectedOrder.resolvedAccounts?.length || 0) > 0 && (
                  <div>
                    <h3 className="mb-1 text-sm font-bold" style={{ color: "var(--tx)" }}>
                      🔑 {t.resolvedTitle}
                    </h3>
                    <p className="mb-2 text-xs" style={{ color: "var(--tx-f)" }}>{t.resolvedHint}</p>
                    <pre
                      onClick={() => {
                        const txt = (selectedOrder.resolvedAccounts || []).join("\n");
                        navigator.clipboard?.writeText(txt).then(
                          () => { setError(null); setCopiedAt(Date.now()); },
                          () => {},
                        );
                      }}
                      className="w-full cursor-pointer overflow-x-auto whitespace-pre-wrap break-all rounded-[10px] border px-3.5 py-2.5 font-mono text-sm"
                      style={{ background: "var(--inp)", borderColor: "rgb(16,185,129)", color: "var(--tx)" }}
                      title={t.resolvedHint}
                    >
                      {(selectedOrder.resolvedAccounts || []).join("\n")}
                    </pre>
                    {copiedAt && Date.now() - copiedAt < 2500 && (
                      <p className="mt-1 text-xs font-medium text-emerald-600">{t.copiedToast}</p>
                    )}
                  </div>
                )}
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <h3 className="text-sm font-bold" style={{ color: "var(--tx)" }}>
                      {t.claimAccountsTitle}
                    </h3>
                    {selectedOrder.searchMode !== "account" && (selectedOrder.accountUsernames?.length || 0) > 1 && (
                      <button
                        type="button"
                        onClick={toggleAllAccounts}
                        className="text-xs font-medium text-emerald-600 transition hover:opacity-70"
                      >
                        {selectedAccountSet.size >= (selectedOrder.accountUsernames?.length || 0) ? t.clearAllLabel : t.selectAllLabel}
                      </button>
                    )}
                  </div>
                  <p className="mb-2 text-xs" style={{ color: "var(--tx-f)" }}>
                    {selectedOrder.searchMode === "account" ? t.acctModeHint : t.orderModeHint}
                  </p>
                  <div className="space-y-1.5">
                    {(selectedOrder.accountUsernames || []).map((email) => {
                      const checked = selectedAccountSet.has(email.toLowerCase());
                      const isAcctMode = selectedOrder.searchMode === "account";
                      return (
                        <label
                          key={email}
                          className="flex cursor-pointer items-center gap-2.5 rounded-[10px] border px-3 py-2.5"
                          style={{
                            background: checked ? "rgba(16,185,129,0.06)" : "var(--inp)",
                            borderColor: checked ? "rgb(16,185,129)" : "var(--bd)",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={isAcctMode}
                            onChange={() => toggleAccount(email)}
                            className="h-4 w-4 accent-emerald-500"
                          />
                          <span className="truncate font-mono text-sm" style={{ color: "var(--tx)" }}>{email}</span>
                        </label>
                      );
                    })}
                  </div>

                  {/* "Đã đổi mật khẩu" → reveal a NEW-password input per selected account so the
                      auto-check tool can log in with the changed password. */}
                  {accountsForPwdGrid.length > 0 && (
                    <div className="mt-3">
                      <label className="flex cursor-pointer items-center gap-2 text-sm" style={{ color: "var(--tx-m)" }}>
                        <input
                          type="checkbox"
                          checked={hasNewPassword}
                          onChange={(e) => setHasNewPassword(e.target.checked)}
                          className="h-4 w-4 accent-emerald-500"
                        />
                        {t.changedPwToggle}
                      </label>
                      {hasNewPassword && (
                        <div className="mt-2 space-y-2">
                          {accountsForPwdGrid.map((email) => (
                            <div key={email} className="flex items-center gap-2">
                              <span className="w-32 shrink-0 truncate font-mono text-xs" style={{ color: "var(--tx-f)" }}>{email}</span>
                              <input
                                type="text"
                                value={passwordMap[email] || ""}
                                onChange={(e) => setPasswordMap((m) => ({ ...m, [email]: e.target.value }))}
                                placeholder={t.newPwPh}
                                className="min-w-0 flex-1 rounded-[8px] border px-2.5 py-1.5 text-sm outline-none"
                                style={{ background: "var(--inp)", borderColor: "var(--bd)", color: "var(--tx)" }}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div>
                  <h3 className="mb-1 text-sm font-bold" style={{ color: "var(--tx)" }}>
                    {t.descTitle}
                  </h3>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder={t.descPh}
                    rows={3}
                    className="w-full resize-none rounded-[10px] border px-3.5 py-2.5 text-sm outline-none"
                    style={{ background: "var(--inp)", borderColor: "var(--bd)", color: "var(--tx)" }}
                  />
                </div>
              </div>
            </Card>
          )}

          {/* "Đã đổi mật khẩu" toggle removed — the account input already carries the password, so a
              separate per-account new-password grid was redundant. Auto-check uses the order's
              delivered password; if it changed, the claim soft-fails and the seller reviews. */}

          {error && (
            <div
              className="flex items-start gap-2 rounded-[10px] px-3.5 py-3 text-sm"
              style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "rgb(239,68,68)" }}
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {/* When the order already has an active claim, the customer can still SELECT it to view /
              re-copy the replacement above, but can't file a new claim — show why, disable submit. */}
          {selectedOrder?.hasActiveClaim && (
            <p className="text-center text-xs font-medium text-amber-500">{t.activeClaim}</p>
          )}
          <button
            type="button"
            disabled={!selectedOrder || loading || !!selectedOrder?.hasActiveClaim}
            onClick={handleSubmitClaim}
            className="flex w-full items-center justify-center gap-2 rounded-[12px] py-2.5 text-sm font-bold transition hover:opacity-90 disabled:opacity-50"
            style={{ background: "rgb(16,185,129)", color: "white" }}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {t.submitBtn}
          </button>
        </div>
      )}

      {step === "result" && result && (
        <Card>
          {(() => {
            // Prefer the freshest invoice — auto-check polling response carries an
            // updated resolvedClaimCount once the claim resolves.
            const invoice = autoCheck?.invoice ?? result.invoice ?? null;
            return invoice ? (
              <div className="mb-4">
                <WarrantyInvoiceCard invoice={invoice} />
              </div>
            ) : null;
          })()}
          {result.status === "auto_check_pending" && (
            <AutoCheckProgress
              claimMessage={result.message}
              initialQueuePosition={result.autoCheck?.queuePosition ?? null}
              auto={autoCheck}
              t={t}
            />
          )}
          {result.status !== "auto_check_pending" && (result.success ? (
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full" style={{ background: "rgba(16,185,129,0.12)" }}>
                  <CheckCircle className="h-7 w-7 text-emerald-500" />
                </div>
                <div>
                  <p className="text-base font-bold" style={{ color: "var(--tx)" }}>{t.successTitle}</p>
                  <p className="mt-1 text-sm" style={{ color: "var(--tx-m)" }}>{t.successOrder(result.orderCode)}</p>
                </div>
              </div>

              {result.deliveredAccountText && (
                <div
                  className="rounded-[12px] p-4"
                  style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.2)" }}
                >
                  <p className="mb-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                    {t.replacementLabel}
                  </p>
                  <pre className="whitespace-pre-wrap break-all text-sm font-mono" style={{ color: "var(--tx)" }}>
                    {result.deliveredAccountText}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full" style={{ background: "rgba(251,191,36,0.12)" }}>
                  <Clock className="h-7 w-7 text-amber-400" />
                </div>
                <div>
                  <p className="text-base font-bold" style={{ color: "var(--tx)" }}>{t.pendingTitle}</p>
                  <p className="mt-1 text-sm" style={{ color: "var(--tx-m)" }}>
                    {result.message || t.pendingDefault}
                  </p>
                </div>
              </div>

              {(result.supportTelegram || result.supportZalo) && (
                <div
                  className="rounded-[12px] p-4 space-y-1.5"
                  style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}
                >
                  <p className="text-xs font-semibold" style={{ color: "var(--tx-m)" }}>{t.supportLabel}</p>
                  {result.supportTelegram && (
                    <p className="text-sm" style={{ color: "var(--tx)" }}>
                      Telegram: <span className="font-medium">{result.supportTelegram}</span>
                    </p>
                  )}
                  {result.supportZalo && (
                    <p className="text-sm" style={{ color: "var(--tx)" }}>
                      Zalo: <span className="font-medium">{result.supportZalo}</span>
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}

          {/* Action buttons — mirror the bot's "Bảo hành lại / Tra cứu đơn khác" footer so
              customers can retry on the same order (e.g. after an ambiguous verdict they
              suspect was caused by a typo'd password) without re-doing the lookup, or start
              fresh on a different order. Hidden during auto-check polling.
              Note: result.status is set at SUBMIT time and stays "auto_check_pending" forever
              for queued claims. The auto-check terminal signal lives on autoCheck.autoCheckStatus
              (filled by the polling endpoint). Show buttons when EITHER:
                - result.status is already non-pending (sync submit response: rejected /
                  unsupported / out-of-window etc.), OR
                - the auto-check polling has reached a terminal state.
              Without the second clause, the customer never saw the buttons after an ambiguous
              check completed — the bug from the previous iteration. */}
          {(result.status !== "auto_check_pending" ||
            (autoCheck && new Set(["completed", "failed", "unsupported", "skipped", "overloaded", "cancelled"]).has(String(autoCheck.autoCheckStatus || "").toLowerCase()))) && (() => {
            const isEscalated = String(autoCheck?.status || result.status || "").toUpperCase() === "PENDING_REVIEW";
            const supportHandle = result.supportTelegram;
            return (
              <div className="mt-4 space-y-2 border-t pt-4" style={{ borderColor: "var(--bd)" }}>
                {isEscalated ? (
                  <div className="rounded-[12px] p-4 text-center space-y-2" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)" }}>
                    <p className="text-sm font-semibold" style={{ color: "#ef4444" }}>Bảo hành không thành công</p>
                    <p className="text-sm" style={{ color: "var(--tx-m)" }}>
                      {supportHandle
                        ? <>Vui lòng liên hệ <span className="font-semibold" style={{ color: "var(--tx)" }}>@{supportHandle.replace(/^@/, "")}</span> để được hỗ trợ.</>
                        : "Vui lòng liên hệ shop để được hỗ trợ."}
                    </p>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setResult(null);
                      setAutoCheck(null);
                      idempotencyKeyRef.current = null;
                      setStep("form");
                    }}
                    className="flex w-full items-center justify-center gap-2 rounded-[12px] py-2.5 text-sm font-bold transition hover:opacity-90"
                    style={{ background: "rgb(16,185,129)", color: "white" }}
                  >
                    <ShieldCheck className="h-4 w-4" />
                    Bảo hành lại
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setResult(null);
                    setAutoCheck(null);
                    setSelectedOrder(null);
                    setClaimAccountsText("");
                    setAccountText("");
                    setMessage("");
                    setHasNewPassword(false);
                    setPasswordMap({});
                    setRevealMap({});
                    idempotencyKeyRef.current = null;
                    setStep("form");
                  }}
                  className="flex w-full items-center justify-center gap-2 rounded-[12px] py-2 text-sm transition hover:opacity-70"
                  style={{ color: "var(--tx-m)" }}
                >
                  <Search className="h-4 w-4" />
                  Tra cứu đơn khác
                </button>
              </div>
            );
          })()}
        </Card>
      )}
    </PageShell>
  );
}

function AutoCheckProgress({
  claimMessage,
  initialQueuePosition,
  auto,
  t,
}: {
  claimMessage: string;
  initialQueuePosition: number | null;
  auto: AutoCheckStatusResponse | null;
  t: typeof T["vi"];
}) {
  const status = String(auto?.autoCheckStatus || "queued").toLowerCase();
  const isRunning = status === "running" || status === "queued";
  const isDone = status === "completed" || status === "failed" || status === "unsupported";
  const isFailedOrUnsupported = status === "failed" || status === "unsupported";
  const queueState = auto?.queueState ?? null;
  const aheadCount = auto?.queueAheadCount ?? 0;
  const queuePos = auto?.queuePosition ?? initialQueuePosition;
  const result: any = auto?.autoCheckResult || null;

  const claimStatus = String(auto?.status || "").toUpperCase();
  const isReplaced = isDone && !!auto?.deliveredAccountText && claimStatus === "AUTO_RESOLVED";
  const isRejected = claimStatus === "REJECTED";
  // Completed but neither replaced nor rejected → routed to seller for manual review.
  // Common when auto-check returned login_stuck / 2FA / Pro plan / timeout.
  const isPendingReview = isDone && !isReplaced && !isRejected && claimStatus === "PENDING_REVIEW";
  // Soft-fail: tool returned a parsed result but the verdict is ambiguous (wrong_password,
  // login_stuck, generic error). The customer still has retry slots left so the claim stays at
  // claim.status=PENDING. Distinguish from isPendingReview (which is "all slots used, seller
  // takes over") so the UI can encourage retry instead of telling the customer to wait.
  // softFailed is a public flag set by the BE unconditionally (no token needed).
  // Fallback to result.ok === false for when token IS present (full result available).
  const isSoftFailed =
    isDone && !isReplaced && !isRejected && !isPendingReview &&
    claimStatus === "PENDING" &&
    (auto?.softFailed === true || (result && result.ok === false));

  // Count dead/free accounts from the accounts array for the summary line.
  const accountsArr: any[] = Array.isArray(result?.accounts) ? result.accounts : [];
  const deadAccounts = accountsArr.filter((a: any) => {
    const tier = String(a.tier || "").toLowerCase();
    const plan = String(a.plan || "").toLowerCase();
    return a.isDead === true || tier === "free" || plan === "free";
  });
  const deadCount = deadAccounts.length;

  // Plan label cho message "Phát hiện N tài khoản mất gói ___". Ưu tiên gói cụ thể từ kết quả
  // (Ultra/Pro/Premium), fallback theo tool (VEO/SuperGrok/ChatGPT), fallback cuối "trả phí".
  const toolName = String(auto?.autoCheckTool || "").toLowerCase();
  const TOOL_PLAN_FALLBACK: Record<string, string> = {
    veo: "VEO",
    grok: "SuperGrok",
    gpt: "ChatGPT",
  };
  const specificPlan = (() => {
    // Quét accounts đã die → lấy plan trước đó (nếu lưu) hoặc plan từ result top-level.
    const candidates: string[] = [];
    for (const a of deadAccounts) {
      if (a.previousPlan) candidates.push(String(a.previousPlan));
    }
    if (result?.plan && typeof result.plan === "string" && !/^\d/.test(result.plan)) {
      candidates.push(String(result.plan));
    }
    return candidates.find((p) => /ultra|pro|premium|plus/i.test(p)) || null;
  })();
  const planLabel = specificPlan || TOOL_PLAN_FALLBACK[toolName] || undefined;

  // publicErrorType is always present (no token needed); result?.errorType only when token ok.
  const errorTypeLower = String(auto?.publicErrorType || result?.errorType || "").toLowerCase();
  const isWrongPassSoftFail = isSoftFailed && errorTypeLower === "wrong_password";

  const resolvedTitle = isReplaced
    ? t.replacedTitle
    : isRejected
      ? t.rejectedTitle
      : isWrongPassSoftFail
        ? t.autoCheckSoftFailedWrongPassTitle
        : isSoftFailed
          ? t.autoCheckSoftFailedTitle
          : t.autoCheckDoneTitle;

  const resolvedSubtitle = isReplaced && deadCount > 0
    ? t.replacedDesc(deadCount, planLabel)
    : isRejected
      ? (auto?.resolutionNote || t.rejectedDesc)
      : isPendingReview
        ? t.autoCheckPendingReviewDesc
        : isWrongPassSoftFail
          ? t.autoCheckSoftFailedWrongPassHint
          : isSoftFailed
            ? `${t.autoCheckReason(auto?.publicErrorType || result?.errorType)}. ${t.autoCheckSoftFailedRetryHint}`
            : isFailedOrUnsupported
              ? t.autoCheckFailedDesc
              : claimMessage;

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <div
          className="flex h-14 w-14 items-center justify-center rounded-full"
          style={{
            background: isReplaced
              ? "rgba(16,185,129,0.12)"
              : isRejected
                ? "rgba(239,68,68,0.10)"
                : isWrongPassSoftFail
                  ? "rgba(245,158,11,0.12)"
                  : isDone
                    ? "rgba(16,185,129,0.12)"
                    : "rgba(59,130,246,0.12)",
          }}
        >
          {isRunning ? (
            <Loader2 className="h-7 w-7 animate-spin text-blue-500" />
          ) : isRejected ? (
            <ShieldAlert className="h-7 w-7 text-red-400" />
          ) : isWrongPassSoftFail ? (
            <AlertCircle className="h-7 w-7 text-amber-500" />
          ) : (
            <CheckCircle className="h-7 w-7 text-emerald-500" />
          )}
        </div>
        <div>
          <p className="text-base font-bold" style={{ color: "var(--tx)" }}>
            {isDone ? resolvedTitle : t.autoCheckTitle}
          </p>
          <p className="mt-1 text-sm" style={{ color: "var(--tx-m)" }}>
            {isDone ? resolvedSubtitle : claimMessage}
          </p>
        </div>
      </div>

      {isRunning && (
        <div className="rounded-[12px] p-4 space-y-2" style={{ background: "var(--inp)", border: "1px solid var(--bd)" }}>
          <p className="text-sm" style={{ color: "var(--tx)" }}>
            {queueState === "active" ? t.autoCheckActive : t.autoCheckRunning}
          </p>
          {queueState === "waiting" && (
            <p className="text-xs" style={{ color: "var(--tx-m)" }}>{t.autoCheckQueueAhead(aheadCount)}</p>
          )}
          {/* Legacy fallback: nếu BE không trả queueState (cũ), hiển thị vị trí xếp hàng đơn giản. */}
          {queueState === null && typeof queuePos === "number" && queuePos > 0 && (
            <p className="text-xs font-mono" style={{ color: "var(--tx-m)" }}>{t.autoCheckQueuePos(queuePos)}</p>
          )}
          {auto?.autoCheckProgress && auto.autoCheckProgress.total > 0 && queueState !== "waiting" && (
            <p className="text-xs font-mono" style={{ color: "var(--tx-m)" }}>
              {auto.autoCheckProgress.phase === "retry"
                ? t.autoCheckProgressRetry(auto.autoCheckProgress.completed, auto.autoCheckProgress.total)
                : t.autoCheckProgress(auto.autoCheckProgress.completed, auto.autoCheckProgress.total)}
            </p>
          )}
        </div>
      )}

      {isDone && result && (
        Array.isArray(result.accounts) && result.accounts.length > 0 ? (
          <div className="rounded-[12px] overflow-hidden" style={{ border: "1px solid var(--bd)" }}>
            {(result.accounts as any[]).map((acc: any, i: number) => {
              const username = String(acc.email || "").split("@")[0] || acc.email;
              const tier = String(acc.tier || "").toUpperCase();
              const plan = String(acc.plan || "");
              // Pull the credit number out of veo's "24460 credit" plan string so we can
              // display it as a suffix to the tier label. Veo's single-check.js falls back to
              // "<N> credit" when plan-name detection misses (DOM tweak, A/B test, etc.) —
              // shop only sells Ultra so any alive acc with credit is effectively Ultra.
              const creditMatch = plan.match(/^(\d[\d,.]*)\s*credit/i);
              const creditOnly = creditMatch ? `${creditMatch[1]} credit` : null;
              const isDead = acc.isDead === true;
              // Assume Ultra when veo returned a live acc with credits but no tier label.
              // Lets the pill show "Ultra · 24460 credit" instead of a bare yellow "24460 credit".
              const assumeVeoUltra =
                acc.tool === "veo" && acc.ok && !isDead && !tier && creditOnly;
              const isFreeDropped = !isDead && !acc.error && (tier === "FREE" || /^free$/i.test(plan));
              const isNeedReplacement = isDead || isFreeDropped;
              const stillPaid = acc.stillPaid === true;
              const hasError = !acc.ok && !!acc.error && !isDead && !isFreeDropped;
              const isPremiumPaid =
                tier === "ULTRA" ||
                tier === "SUPERGROK" || tier === "SUPER" ||
                assumeVeoUltra;
              const isHeavy = tier === "HEAVY";
              // Green for any paid premium tier (Ultra / SuperGrok / assumed-Ultra), purple
              // for Heavy (grok power tier), gray for confirmed Free, amber only for the
              // genuinely unknown / errored case.
              const tierColor =
                isPremiumPaid ? "#10b981" :
                isHeavy ? "#8b5cf6" :
                tier === "FREE" ? "#6b7280" :
                "#f59e0b";
              const planLabel = isDead
                ? "—"
                : assumeVeoUltra
                  ? `Ultra · ${creditOnly}`
                  : tier === "ULTRA"
                    ? (creditOnly ? `Ultra · ${creditOnly}` : "Ultra")
                    : (tier === "SUPERGROK" || tier === "SUPER")
                      ? "SuperGrok"
                      : tier === "HEAVY"
                        ? "Heavy"
                        : tier === "FREE"
                          ? "Free"
                          : tier === "UNKNOWN" || (!plan && !tier)
                            ? "Unknown"
                            : (plan || tier);
              const statusLabel = (() => {
                if (isDead) {
                  const et = String(acc.errorType || "").toLowerCase();
                  if (et === "wrong_password" || et === "login_stuck") return "Sai mật khẩu";
                  if (et === "blocked") return "Bị chặn";
                  if (et === "expired") return "Hết hạn";
                  return "Die";
                }
                if (isFreeDropped) return "Mất gói";
                if (hasError) return "Lỗi kiểm tra";
                if (stillPaid) return "Còn hạn";
                return acc.status ? String(acc.status) : "—";
              })();
              const rowBg = isNeedReplacement
                ? "rgba(239,68,68,0.05)"
                : stillPaid ? "rgba(16,185,129,0.05)" : "var(--inp)";
              const statusColor = isNeedReplacement ? "#ef4444" : hasError ? "#f59e0b" : stillPaid ? "#10b981" : "var(--tx-m)";
              return (
                <div
                  key={i}
                  className="flex items-center gap-3 px-3 py-2.5 text-sm"
                  style={{ borderTop: i > 0 ? "1px solid var(--bd)" : undefined, background: rowBg }}
                >
                  <span className="font-mono text-xs truncate flex-1" style={{ color: "var(--tx)", maxWidth: 140 }} title={acc.email}>
                    {username}
                  </span>
                  <span
                    className="text-xs font-semibold px-1.5 py-0.5 rounded"
                    style={{ background: tierColor + "22", color: tierColor, whiteSpace: "nowrap" }}
                  >
                    {planLabel}
                  </span>
                  {acc.expires && !isNeedReplacement && (
                    <span className="text-xs" style={{ color: "var(--tx-m)", whiteSpace: "nowrap" }}>
                      {String(acc.expires)}
                    </span>
                  )}
                  <span className="text-xs font-bold" style={{ color: statusColor, whiteSpace: "nowrap" }}>
                    {statusLabel}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-[12px] p-4 space-y-1.5" style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.2)" }}>
            {result.plan && (
              <p className="text-sm" style={{ color: "var(--tx)" }}>
                <span className="font-semibold">Gói: </span>{String(result.plan)}
              </p>
            )}
            {result.expires && (
              <p className="text-sm" style={{ color: "var(--tx)" }}>
                <span className="font-semibold">Hạn: </span>{String(result.expires)}
              </p>
            )}
            {result.status && (
              <p className="text-xs font-mono" style={{ color: "var(--tx-m)" }}>
                status: {String(result.status)}
              </p>
            )}
          </div>
        )
      )}

      {auto?.deliveredAccountText && (
        <div className="rounded-[12px] p-4" style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.2)" }}>
          <p className="mb-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">{t.replacementLabel}</p>
          <pre className="whitespace-pre-wrap break-all text-sm font-mono" style={{ color: "var(--tx)" }}>
            {auto.deliveredAccountText}
          </pre>
        </div>
      )}
    </div>
  );
}

function PageShell({
  children,
  shopName,
  t,
}: {
  children: React.ReactNode;
  shopName?: string | null;
  t: typeof T["vi"];
}) {
  return (
    <div className="min-h-screen px-4 py-10" style={{ background: "var(--bg)" }}>
      <div className="mx-auto max-w-md">
        <div className="mb-6 flex items-center gap-2.5">
          <ShieldCheck className="h-5 w-5 text-emerald-500" />
          <span className="text-sm font-bold" style={{ color: "var(--tx)" }}>
            {shopName ? t.shopWarranty(shopName) : t.warranty}
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}
