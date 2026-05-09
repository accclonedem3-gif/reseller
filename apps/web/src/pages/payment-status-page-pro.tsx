import { CheckCircle2, LoaderCircle, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api";
import { useLang } from "@/lib/lang";

const T = {
  vi: {
    kicker: "Kết quả thanh toán",
    success: "Thanh toán thành công",
    cancelled: "Thanh toán đã bị hủy",
    orderCode: (code: string) => `Mã thanh toán: ${code}`,
    noCode: "không có",
    back: "Quay về dashboard",
    cancelDetail: "Bạn có thể quay lại bot Telegram hoặc dashboard để tạo giao dịch khác.",
    loadingDetail: "Đang đối soát thanh toán với PayOS và cập nhật trạng thái đơn hàng...",
    noTokenDetail: "Trang thanh toán này không có mã đối soát hợp lệ. Hãy quay lại bot hoặc dashboard để kiểm tra trạng thái đơn hàng.",
    defaultDetail: "Bạn có thể quay lại bot Telegram hoặc dashboard để theo dõi trạng thái đơn hàng và tình hình giao account.",
    failureMsg: (reason: string) => `Thanh toán đã được ghi nhận nhưng đơn chưa mua được: ${reason}`,
    reconcileOrder: "Hệ thống đã xác nhận thanh toán và đang xử lý giao tài khoản.",
    reconcileOther: "Hệ thống đã xác nhận thanh toán thành công.",
    providerStatus: (s: string) => `PayOS hiện báo trạng thái ${s}. Nếu bạn vừa mới chuyển khoản, hãy chờ thêm vài giây rồi tải lại trang.`,
    notConfirmed: "Hệ thống chưa xác nhận được giao dịch. Hãy chờ thêm vài giây rồi tải lại trang.",
    reconcileErr: "Chưa thể đối soát thanh toán tự động. Hãy tải lại trang sau vài giây.",
  },
  en: {
    kicker: "Payment result",
    success: "Payment successful",
    cancelled: "Payment cancelled",
    orderCode: (code: string) => `Order code: ${code}`,
    noCode: "none",
    back: "Back to dashboard",
    cancelDetail: "You can return to the Telegram bot or dashboard to create another transaction.",
    loadingDetail: "Reconciling payment with PayOS and updating order status...",
    noTokenDetail: "This payment page has no valid reconciliation token. Return to the bot or dashboard to check order status.",
    defaultDetail: "You can return to the Telegram bot or dashboard to track order status and account delivery.",
    failureMsg: (reason: string) => `Payment was recorded but the order could not be fulfilled: ${reason}`,
    reconcileOrder: "The system has confirmed payment and is processing account delivery.",
    reconcileOther: "The system has confirmed payment successfully.",
    providerStatus: (s: string) => `PayOS currently shows status ${s}. If you just transferred, wait a few seconds and refresh.`,
    notConfirmed: "The system could not confirm the transaction. Wait a few seconds and refresh.",
    reconcileErr: "Could not auto-reconcile payment. Please refresh after a few seconds.",
  },
  th: {
    kicker: "ผลการชำระเงิน",
    success: "ชำระเงินสำเร็จ",
    cancelled: "ยกเลิกการชำระเงินแล้ว",
    orderCode: (code: string) => `รหัสการชำระเงิน: ${code}`,
    noCode: "ไม่มี",
    back: "กลับไปแดชบอร์ด",
    cancelDetail: "คุณสามารถกลับไปที่บอท Telegram หรือแดชบอร์ดเพื่อสร้างธุรกรรมใหม่",
    loadingDetail: "กำลังยืนยันการชำระเงินกับ PayOS และอัปเดตสถานะคำสั่งซื้อ...",
    noTokenDetail: "หน้าชำระเงินนี้ไม่มีโทเคนยืนยันที่ถูกต้อง กลับไปที่บอทหรือแดชบอร์ดเพื่อตรวจสอบสถานะ",
    defaultDetail: "คุณสามารถกลับไปที่บอท Telegram หรือแดชบอร์ดเพื่อติดตามสถานะคำสั่งซื้อ",
    failureMsg: (reason: string) => `บันทึกการชำระเงินแล้วแต่คำสั่งซื้อไม่สำเร็จ: ${reason}`,
    reconcileOrder: "ระบบยืนยันการชำระเงินและกำลังดำเนินการส่งบัญชีแล้ว",
    reconcileOther: "ระบบยืนยันการชำระเงินสำเร็จแล้ว",
    providerStatus: (s: string) => `PayOS แสดงสถานะ ${s} ถ้าโอนเงินเพิ่งทำ โปรดรอสักครู่แล้วรีเฟรช`,
    notConfirmed: "ระบบยังไม่สามารถยืนยันธุรกรรมได้ โปรดรอสักครู่แล้วรีเฟรชหน้า",
    reconcileErr: "ไม่สามารถยืนยันการชำระเงินอัตโนมัติได้ โปรดรีเฟรชหลังจากสักครู่",
  },
};

export function PaymentStatusPage({ mode }: { mode: "success" | "cancel" }) {
  const { lang } = useLang();
  const t = T[lang];
  const [searchParams] = useSearchParams();
  const externalOrderCode = searchParams.get("orderCode") || "";
  const reconcileToken = searchParams.get("rt") || "";
  const [reconcileState, setReconcileState] = useState<{
    loading: boolean;
    message: string | null;
  }>({
    loading: mode === "success" && Boolean(externalOrderCode && reconcileToken),
    message: null,
  });

  useEffect(() => {
    if (mode !== "success" || !externalOrderCode || !reconcileToken) {
      setReconcileState({ loading: false, message: null });
      return;
    }

    let cancelled = false;

    void api
      .post(`/webhooks/payos/reconcile/${externalOrderCode}`, { token: reconcileToken })
      .then((response) => {
        if (cancelled) return;

        const data = response.data as {
          reconciled?: boolean;
          kind?: string;
          providerStatus?: string;
          localOrderStatus?: string | null;
          failureReason?: string | null;
        };

        if (data.localOrderStatus === "FAILED" && data.failureReason) {
          setReconcileState({ loading: false, message: t.failureMsg(data.failureReason) });
          return;
        }

        if (data.reconciled) {
          setReconcileState({
            loading: false,
            message: data.kind === "order" ? t.reconcileOrder : t.reconcileOther,
          });
          return;
        }

        setReconcileState({
          loading: false,
          message: data.providerStatus
            ? t.providerStatus(data.providerStatus)
            : t.notConfirmed,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setReconcileState({ loading: false, message: t.reconcileErr });
      });

    return () => { cancelled = true; };
  }, [externalOrderCode, mode, reconcileToken]);

  const detailMessage = useMemo(() => {
    if (mode !== "success") return t.cancelDetail;
    if (reconcileState.loading) return t.loadingDetail;
    if (!reconcileToken) return t.noTokenDetail;
    return reconcileState.message || t.defaultDetail;
  }, [mode, reconcileState, reconcileToken, t]);

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="max-w-xl">
        <div className="flex items-start gap-4">
          <div className="glass-chip flex h-14 w-14 items-center justify-center rounded-2xl">
            {reconcileState.loading && mode === "success" ? (
              <LoaderCircle className="h-6 w-6 animate-spin text-amber-200" />
            ) : mode === "success" ? (
              <CheckCircle2 className="h-6 w-6 text-emerald-200" />
            ) : (
              <XCircle className="h-6 w-6 text-rose-200" />
            )}
          </div>
          <div>
            <p className="app-kicker">{t.kicker}</p>
            <h1 className="mt-3 font-display text-3xl font-semibold text-white">
              {mode === "success" ? t.success : t.cancelled}
            </h1>
            <p className="mt-3 text-sm leading-7 text-slate-300">
              {t.orderCode(externalOrderCode || t.noCode)}
            </p>
            <p className="mt-2 text-sm leading-7 text-slate-500">{detailMessage}</p>
            <div className="mt-6">
              <Button variant="secondary" onClick={() => window.location.assign("/")}>
                {t.back}
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
