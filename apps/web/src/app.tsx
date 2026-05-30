import { Navigate, Outlet, Route, Routes } from "react-router-dom";

import { useAuth } from "@/auth/auth-provider";
import { AppShellPrime } from "@/components/layout/app-shell-prime";
import { AdminCtvPage } from "@/pages/admin-ctv-page";
import { AdminOverviewPage } from "@/pages/admin-overview-page";
import { AdminOrdersPage } from "@/pages/admin-orders-page";
import { AdminWithdrawsPage } from "@/pages/admin-withdraws-page";
import { AdminSystemConfigPage } from "@/pages/admin-system-config-page";
import { AdminIconsPage } from "@/pages/admin-icons-page";
import { AdminTemplateBotPage } from "@/pages/admin-template-bot-page";
import { BotConfigPage } from "@/pages/bot-config-page-pro";
import { BroadcastsPage } from "@/pages/broadcasts-page-pro";
import { LoginPageStudio } from "@/pages/login-page-studio";
import { ManualCryptoPaymentPage } from "@/pages/manual-crypto-payment-page";
import { OrdersPageStudio } from "@/pages/orders-page-studio";
import { OverviewPagePrime } from "@/pages/overview-page-prime";
import { PendingOrdersPageStudio } from "@/pages/pending-orders-page-studio";
import { PaymentStatusPage } from "@/pages/payment-status-page-pro";
import { ProductsManagementPage } from "@/pages/products-management-page";
import { ProfilePage } from "@/pages/profile-page-pro";
import { RevenuePagePrime } from "@/pages/revenue-page-prime";
import { ResetPasswordPageStudio } from "@/pages/reset-password-page-studio";
import { SourceNetworkPage } from "@/pages/source-network-page";
import { TopBuyersPage } from "@/pages/top-buyers-page-pro";
import { TopReferrersPage } from "@/pages/top-referrers-page-pro";
import { WalletPage } from "@/pages/wallet-page-pro";
import { UpgradePage } from "@/pages/upgrade-page";
import { TierPricingPage } from "@/pages/tier-pricing-page";
import { SellerAffiliatePage } from "@/pages/seller-affiliate-page";
import { ProAnalyticsPage } from "@/pages/pro-analytics-page";
import { WarrantyClaimsPage } from "@/pages/warranty-claims-page";
import { WarrantyClaimPage } from "@/pages/warranty-claim-page";
import { CustomersPage } from "@/pages/customers-page";
import { MiniAppSettingsPage } from "@/pages/mini-app-settings-page";

function ProtectedLayout() {
  const { ready, session } = useAuth();
  const refCode = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("ref") : null;

  if (!ready) {
    return <div className="p-10 text-slate-300">Đang tải phiên làm việc...</div>;
  }

  if (!session) {
    // If URL has ?ref=, route to /register with the code preserved
    return <Navigate to={refCode ? `/register?ref=${encodeURIComponent(refCode)}` : "/login"} replace />;
  }

  return (
    <AppShellPrime>
      <Outlet />
    </AppShellPrime>
  );
}

function SellerOnlyLayout() {
  const { session } = useAuth();

  if (session?.user.role === "super_admin") {
    return <Navigate to="/admin" replace />;
  }

  return <Outlet />;
}

function AdminOnlyLayout() {
  const { session } = useAuth();

  if (session?.user.role !== "super_admin") {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}

function HomeRoute() {
  const { session } = useAuth();

  if (session?.user.role === "super_admin") {
    return <Navigate to="/admin" replace />;
  }

  return <OverviewPagePrime />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPageStudio />} />
      <Route path="/register" element={<LoginPageStudio />} />
      <Route path="/reset-password" element={<ResetPasswordPageStudio />} />
      <Route path="/payments/crypto" element={<ManualCryptoPaymentPage />} />
      <Route path="/payments/success" element={<PaymentStatusPage mode="success" />} />
      <Route path="/payments/cancel" element={<PaymentStatusPage mode="cancel" />} />
      <Route path="/bao-hanh" element={<WarrantyClaimPage />} />
      <Route path="/mini-app/settings" element={<MiniAppSettingsPage />} />
      <Route element={<ProtectedLayout />}>
        <Route path="/" element={<HomeRoute />} />
        <Route element={<SellerOnlyLayout />}>
          <Route path="/bot-config" element={<BotConfigPage />} />
          <Route path="/products" element={<ProductsManagementPage />} />
          <Route path="/source-connection" element={<Navigate to="/source-network" replace />} />
          <Route path="/source-network" element={<SourceNetworkPage />} />
          <Route path="/orders/pending" element={<PendingOrdersPageStudio />} />
          <Route path="/orders" element={<OrdersPageStudio />} />
          <Route path="/wallet" element={<WalletPage />} />
          <Route path="/warranty" element={<WarrantyClaimsPage />} />
          <Route path="/reports/top-buyers" element={<TopBuyersPage />} />
          <Route path="/reports/top-referrers" element={<TopReferrersPage />} />
          <Route path="/reports/revenue" element={<RevenuePagePrime />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/broadcasts" element={<BroadcastsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/upgrade" element={<UpgradePage />} />
          <Route path="/pricing" element={<TierPricingPage />} />
          <Route path="/affiliate" element={<SellerAffiliatePage />} />
          <Route path="/pro-analytics" element={<ProAnalyticsPage />} />
          <Route path="/source-products" element={<Navigate to="/products" replace />} />
        </Route>
        <Route element={<AdminOnlyLayout />}>
          <Route path="/admin" element={<AdminOverviewPage />} />
          <Route path="/admin/ctv" element={<AdminCtvPage />} />
          <Route path="/admin/orders" element={<AdminOrdersPage />} />
          <Route path="/admin/withdraws" element={<AdminWithdrawsPage />} />
          <Route path="/admin/settings" element={<AdminSystemConfigPage />} />
          <Route path="/admin/icons" element={<AdminIconsPage />} />
          <Route path="/admin/template-bot" element={<AdminTemplateBotPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
