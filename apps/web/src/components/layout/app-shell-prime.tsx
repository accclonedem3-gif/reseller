import type { ReactNode } from "react";
import {
  BarChart3,
  Bell,
  Bot,
  Cable,
  ChartColumn,
  CheckCircle2,
  ChevronLeft,
  Crown,
  ChevronRight,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Moon,
  Package,
  Image as ImageIcon,
  Settings2,
  ShieldCheck,
  ShieldPlus,
  ShoppingBag,
  Sparkles,
  Sun,
  UserCircle2,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

import { useAuth } from "@/auth/auth-provider";
import { ReadOnlyNotice } from "@/components/ui/read-only-notice";
import { cn } from "@/lib/cn";
import { formatRoleLabel } from "@/lib/format";
import { hasSellerCapability } from "@/lib/seller-access";
import { useLang } from "@/lib/lang";
import type { Lang } from "@/lib/lang";

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  badge?: number;
};

const NAV_LABELS = {
  vi: {
    overview: "Tổng quan", botConfig: "Cấu hình bot", products: "Sản phẩm",
    sourceNetwork: "Quản lý CTV", pendingOrders: "Đơn chờ xử lý",
    orders: "Đơn hàng", wallet: "Quản lý người dùng bot", warranty: "Bảo hành",
    proAnalytics: "Phân tích ULTRA", topBuyers: "Top người mua",
    topReferrers: "Top giới thiệu", revenue: "Doanh thu",
    customers: "Khách hàng",
    broadcasts: "Thông báo bot", profile: "Hồ sơ",
    adminOverview: "Tổng quan", adminAccounts: "Tài khoản CTV",
    adminOrders: "Đơn hàng HT", adminSettings: "Cài đặt HT",
    adminIcons: "Thư viện icon",
    adminTemplate: "Bot Template",
    coreWorkspace: "Vận hành", internalManagement: "Phân tích",
    masterIntelligence: "Master Intelligence",
  },
  en: {
    overview: "Overview", botConfig: "Bot Config", products: "Products",
    sourceNetwork: "Manage CTV", pendingOrders: "Pending Orders",
    orders: "Orders", wallet: "Manage Bot Users", warranty: "Warranty",
    proAnalytics: "ULTRA Analytics", topBuyers: "Top Buyers",
    topReferrers: "Top Referrers", revenue: "Revenue",
    customers: "Customers",
    broadcasts: "Broadcasts", profile: "Profile",
    adminOverview: "Overview", adminAccounts: "CTV Accounts",
    adminOrders: "System Orders", adminSettings: "System Settings",
    adminIcons: "Icon Library",
    adminTemplate: "Bot Template",
    coreWorkspace: "Workspace", internalManagement: "Analytics",
    masterIntelligence: "Master Intelligence",
  },
  th: {
    overview: "ภาพรวม", botConfig: "ตั้งค่าบอท", products: "สินค้า",
    sourceNetwork: "จัดการ CTV", pendingOrders: "คำสั่งซื้อรอดำเนินการ",
    orders: "คำสั่งซื้อ", wallet: "จัดการผู้ใช้บอท", warranty: "การรับประกัน",
    proAnalytics: "วิเคราะห์ ULTRA", topBuyers: "ผู้ซื้อสูงสุด",
    topReferrers: "ผู้แนะนำสูงสุด", revenue: "รายได้",
    customers: "ลูกค้า",
    broadcasts: "ประกาศบอท", profile: "โปรไฟล์",
    adminOverview: "ภาพรวม", adminAccounts: "บัญชีผู้ขาย",
    adminOrders: "คำสั่งซื้อระบบ", adminSettings: "ตั้งค่าระบบ",
    adminIcons: "คลังไอคอน",
    adminTemplate: "เทมเพลตบอท",
    coreWorkspace: "พื้นที่ทำงาน", internalManagement: "วิเคราะห์",
    masterIntelligence: "Master Intelligence",
  },
} as const;

function buildAdminItems(lang: Lang): readonly NavItem[] {
  const L = NAV_LABELS[lang];
  return [
    { to: "/admin",          label: L.adminOverview,  icon: LayoutDashboard },
    { to: "/admin/ctv",      label: L.adminAccounts,  icon: ShieldPlus },
    { to: "/admin/orders",   label: L.adminOrders,    icon: ShoppingBag },
    { to: "/admin/settings", label: L.adminSettings,  icon: Settings2 },
    { to: "/admin/icons",    label: L.adminIcons,     icon: ImageIcon },
    { to: "/admin/template-bot", label: L.adminTemplate, icon: Settings2 },
  ];
}

function buildSellerNavGroups(session: ReturnType<typeof useAuth>["session"], lang: Lang, warrantyCount = 0) {
  const L = NAV_LABELS[lang];
  const operations: NavItem[] = [
    { to: "/",           label: L.overview,    icon: LayoutDashboard },
    { to: "/bot-config", label: L.botConfig,   icon: Bot },
    { to: "/products",   label: L.products,    icon: Package },
  ];

  if (
    hasSellerCapability(session, "source_internal_use") ||
    hasSellerCapability(session, "source_internal_manage") ||
    hasSellerCapability(session, "source_key_manage")
  )
    operations.push({ to: "/source-network", label: L.sourceNetwork, icon: Cable });

  operations.push(
    { to: "/orders/pending", label: L.pendingOrders, icon: ShoppingBag },
    { to: "/orders",         label: L.orders,        icon: ShoppingBag },
    { to: "/wallet",         label: L.wallet,        icon: CreditCard },
  );

  if (hasSellerCapability(session, "warranty_manage"))
    operations.push({ to: "/warranty", label: L.warranty, icon: ShieldCheck, badge: warrantyCount || undefined });

  const insights: NavItem[] = [];

  if (hasSellerCapability(session, "source_key_manage"))
    insights.push({ to: "/pro-analytics", label: L.proAnalytics, icon: BarChart3 });

  insights.push(
    { to: "/reports/revenue",       label: L.revenue,      icon: ChartColumn },
    { to: "/affiliate",             label: "🎁 Affiliate",  icon: Sparkles },
    { to: "/broadcasts",            label: L.broadcasts,   icon: Bell },
    { to: "/profile",               label: L.profile,      icon: UserCircle2 },
  );

  return [
    { title: L.coreWorkspace,      items: operations },
    { title: L.internalManagement, items: insights },
  ];
}

function isItemActive(pathname: string, itemPath: string) {
  if (itemPath === "/" || itemPath === "/admin") return pathname === itemPath;
  return pathname === itemPath || pathname.startsWith(`${itemPath}/`);
}

function ModeToggle() {
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains("dark"),
  );

  useEffect(() => {
    if (dark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch {}
  }, [dark]);

  return (
    <button
      type="button"
      onClick={() => setDark((d) => !d)}
      title={dark ? "Chuyển sang light mode" : "Chuyển sang dark mode"}
      className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--bd)] bg-[var(--surface)] text-[var(--tx-m)] transition hover:text-orange-500 hover:border-orange-500/30"
    >
      {dark ? <Sun className="size-4.5" /> : <Moon className="size-4.5" />}
    </button>
  );
}

function LangToggle() {
  const { lang, setLang } = useLang();
  const next = lang === "vi" ? "en" : lang === "en" ? "th" : "vi";
  const label = lang === "vi" ? "EN" : lang === "en" ? "TH" : "VI";
  const title = lang === "vi" ? "Switch to English" : lang === "en" ? "เปลี่ยนเป็นภาษาไทย" : "Chuyển sang Tiếng Việt";
  return (
    <button
      type="button"
      onClick={() => setLang(next)}
      title={title}
      className="flex h-10 items-center justify-center rounded-2xl border border-[var(--bd)] bg-[var(--surface)] px-3 text-[11px] font-black uppercase tracking-[0.12em] text-[var(--tx-m)] transition hover:text-orange-500 hover:border-orange-500/30"
    >
      {label}
    </button>
  );
}

export function AppShellPrime({ children }: { children: ReactNode }) {
  const { logout, session } = useAuth();
  const { lang } = useLang();
  const location = useLocation();
  const navigate = useNavigate();

  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("sidebar-collapsed") === "true"; } catch { return false; }
  });

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem("sidebar-collapsed", String(next)); } catch {}
      return next;
    });
  }

  const isSuperAdmin = session?.user.role === "super_admin";
  const sellerTier   = session?.user.sellerTier;
  const displayName  =
    session?.user.displayName ||
    (isSuperAdmin ? "Quản trị viên" : session?.user.email) ||
    "Seller";

  const warrantyQuery = useQuery({
    queryKey: ["warranty-claims-count"],
    queryFn: async () => (await api.get("/warranty/claims", { params: { status: "PENDING" } })).data,
    refetchInterval: 60000,
    retry: false,
    enabled: !isSuperAdmin,
  });
  const warrantyCount = Array.isArray(warrantyQuery.data) ? warrantyQuery.data.length : 0;

  const navGroups  = isSuperAdmin
    ? [{ title: NAV_LABELS[lang].masterIntelligence, items: buildAdminItems(lang) }]
    : buildSellerNavGroups(session, lang, warrantyCount);
  const currentItems = navGroups.flatMap((g) => g.items);
  const currentLabel =
    currentItems.find((item) => isItemActive(location.pathname, item.to))?.label ||
    "Bảng điều khiển";

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--bg)", color: "var(--tx)" }}>

      {/* ── Sidebar (desktop) ───────────────────────────────── */}
      <aside
        className={cn(
          "fixed left-0 top-0 h-full hidden xl:flex flex-col z-30 shell-sidebar",
          "border-r transition-all duration-500 ease-in-out",
          collapsed ? "w-[72px]" : "w-[264px]",
        )}
        style={{
          backgroundColor: "var(--sidebar)",
          borderColor: "var(--bd)",
          boxShadow: "2px 0 24px rgba(0,0,0,0.06)",
        }}
      >
        {/* Header */}
        <div
          className="h-20 flex items-center px-4 shrink-0 relative overflow-hidden"
          style={{ borderBottom: "1px solid var(--bd)" }}
        >
          <div className="absolute -left-10 -top-10 w-24 h-24 bg-orange-500/8 blur-3xl rounded-full pointer-events-none" />
          <div className={cn("flex items-center gap-4 flex-1 min-w-0", collapsed && "justify-center")}>
            <div className="flex size-10 min-w-[40px] items-center justify-center rounded-2xl bg-orange-500 text-white font-black shadow-lg shadow-orange-500/20 shrink-0">
              <CheckCircle2 className="size-5" />
            </div>
            {!collapsed && (
              <span
                className="font-black text-xl tracking-tighter uppercase italic whitespace-nowrap overflow-hidden"
                style={{ color: "var(--tx)" }}
              >
                Altivox{" "}
                <span className="text-orange-500 font-medium lowercase not-italic">AI</span>
              </span>
            )}
          </div>
          {!collapsed && (
            <button
              type="button"
              onClick={toggleCollapsed}
              className="p-1.5 rounded-xl transition-colors shrink-0"
              style={{ color: "var(--tx-f)" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--tx)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--tx-f)"; }}
            >
              <ChevronLeft className="size-4" />
            </button>
          )}
        </div>

        {/* Nav */}
        <div className="flex-1 overflow-y-auto px-3 pt-6 custom-scrollbar">
          {navGroups.map((group) => (
            <div key={group.title} className="mb-6">
              {!collapsed && (
                <p
                  className="text-[9px] font-black uppercase tracking-[0.3em] px-4 pb-4"
                  style={{ color: "var(--tx-f)" }}
                >
                  {group.title}
                </p>
              )}
              <div className="space-y-1">
                {group.items.map((item) => {
                  const active = isItemActive(location.pathname, item.to);
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      title={collapsed ? item.label : undefined}
                      className={cn(
                        "relative flex items-center gap-3 h-11 rounded-xl transition-all duration-200 group",
                        collapsed ? "justify-center px-0" : "px-3",
                      )}
                      style={
                        active
                          ? { backgroundColor: "rgba(249,115,22,0.1)", color: "var(--tx)" }
                          : { color: "var(--tx-m)" }
                      }
                    >
                      {/* Left orange indicator */}
                      {active && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-orange-500" />
                      )}
                      <item.icon
                        className={cn("size-5 min-w-[20px] shrink-0 transition-colors", active ? "text-orange-500" : "group-hover:text-orange-400")}
                      />
                      {!collapsed && (
                        <span className={cn("flex-1 text-[13px] font-bold tracking-tight transition-colors", active ? "text-orange-50" : "group-hover:text-[var(--tx)]")}>
                          {item.label}
                        </span>
                      )}
                      {!collapsed && item.badge != null && item.badge > 0 && (
                        <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-orange-500 px-1.5 text-[10px] font-black text-white shadow-sm">
                          {item.badge > 99 ? "99+" : item.badge}
                        </span>
                      )}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* User footer */}
        <div
          className="p-4 shrink-0"
          style={{ borderTop: "1px solid var(--bd)", backgroundColor: "var(--surface)" }}
        >
          {!isSuperAdmin && !collapsed && (
            <button
              type="button"
              onClick={() => navigate("/pricing")}
              className="mb-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-orange-500 py-3 text-[10px] font-black uppercase tracking-[0.22em] text-white shadow-lg shadow-orange-500/20 transition hover:brightness-110"
            >
              <Crown className="size-3.5" />
              Nâng cấp / Gia hạn
            </button>
          )}

          <div className={cn("flex items-center gap-3", collapsed && "justify-center flex-col")}>
            <div className="flex size-10 min-w-[40px] items-center justify-center rounded-xl bg-orange-500 text-white font-black text-sm shadow-lg shadow-orange-500/20 shrink-0">
              {displayName[0]?.toUpperCase()}
            </div>
            {!collapsed && (
              <>
                <div className="flex-1 min-w-0">
                  <p
                    className="font-black text-sm truncate uppercase italic tracking-tighter"
                    style={{ color: "var(--tx)" }}
                  >
                    {displayName}
                  </p>
                  <p className="text-[9px] font-black text-orange-500 uppercase tracking-[0.2em] truncate">
                    {isSuperAdmin ? "Master" : (sellerTier?.toUpperCase() ?? "Seller")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={logout}
                  title="Đăng xuất"
                  className="p-2 rounded-xl text-rose-400 hover:bg-rose-500/10 transition-colors shrink-0"
                >
                  <LogOut className="size-4" />
                </button>
              </>
            )}
            {collapsed && (
              <>
                <button
                  type="button"
                  onClick={logout}
                  title="Đăng xuất"
                  className="p-2 rounded-xl text-rose-400 hover:bg-rose-500/10 transition-colors"
                >
                  <LogOut className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={toggleCollapsed}
                  className="p-2 rounded-xl transition-colors"
                  style={{ color: "var(--tx-f)" }}
                >
                  <ChevronRight className="size-4" />
                </button>
              </>
            )}
          </div>
        </div>
      </aside>

      {/* ── Main area ──────────────────────────────────────── */}
      <div
        className={cn(
          "flex flex-col min-h-screen transition-[margin] duration-500",
          collapsed ? "xl:ml-[72px]" : "xl:ml-[264px]",
        )}
      >
        {/* Topbar (desktop) */}
        <header
          className="shell-topbar h-20 hidden xl:flex items-center justify-between px-8 sticky top-0 z-20 backdrop-blur-xl"
          style={{
            borderBottom: "1px solid var(--bd)",
            backgroundColor: "color-mix(in srgb, var(--bg) 85%, transparent)",
          }}
        >
          <nav className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.1em]">
            <span style={{ color: "var(--tx-f)" }}>Home</span>
            <span style={{ color: "var(--tx-f)" }}>/</span>
            <span style={{ color: "var(--tx)" }}>{currentLabel}</span>
          </nav>

          <div className="flex items-center gap-3">
            {/* User chip */}
            <div
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-full border text-sm"
              style={{ borderColor: "var(--bd)", backgroundColor: "var(--surface)", color: "var(--tx-m)" }}
            >
              {displayName}
            </div>
            {/* Tier badge */}
            {!isSuperAdmin && sellerTier && (
              <div className="px-4 py-2.5 rounded-full border border-orange-500/20 bg-orange-500/10 text-[10px] font-black uppercase tracking-[0.18em] text-orange-500">
                {formatRoleLabel(sellerTier)}
              </div>
            )}
            {isSuperAdmin && (
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-full border border-orange-500/20 bg-orange-500/10 text-[9px] font-black uppercase tracking-[0.2em] text-orange-500">
                <span className="size-1.5 rounded-full bg-orange-500 animate-pulse" />
                Master Instance
              </div>
            )}
            {/* Lang + Dark/Light toggles */}
            <LangToggle />
            <ModeToggle />
          </div>
        </header>

        {/* Mobile bar */}
        <div
          className="shell-mobilebar xl:hidden px-4 py-3 sticky top-0 z-20"
          style={{ borderBottom: "1px solid var(--bd)", backgroundColor: "var(--sidebar)" }}
        >
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-3">
              <div className="flex size-8 items-center justify-center rounded-xl bg-orange-500 text-white font-black text-xs shadow-lg shadow-orange-500/20">
                <CheckCircle2 className="size-4" />
              </div>
              <span className="font-black text-base uppercase italic tracking-tighter" style={{ color: "var(--tx)" }}>
                Altivox{" "}
                <span className="text-orange-500 font-medium lowercase not-italic">AI</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <LangToggle />
              <ModeToggle />
              <button
                type="button"
                onClick={logout}
                className="p-2 rounded-xl text-rose-400 hover:bg-rose-500/10 transition-colors"
              >
                <LogOut className="size-4" />
              </button>
            </div>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
            {currentItems.map((item) => {
              const active = isItemActive(location.pathname, item.to);
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className="inline-flex items-center gap-2 rounded-[12px] border px-3 py-2 text-xs font-bold uppercase tracking-wide whitespace-nowrap shrink-0 transition"
                  style={
                    active
                      ? { backgroundColor: "var(--s-act)", color: "var(--s-act-tx)", borderColor: "rgba(249,115,22,0.2)" }
                      : { backgroundColor: "var(--surface)", color: "var(--tx-m)", borderColor: "var(--bd)" }
                  }
                >
                  <item.icon className="size-3.5" />
                  {item.label}
                </NavLink>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <main className="flex-1 p-6 lg:p-10 relative overflow-hidden">
          <div
            className="absolute -right-40 -bottom-40 w-[600px] h-[600px] blur-[120px] rounded-full pointer-events-none z-0"
            style={{ backgroundColor: "var(--blob)" }}
          />
          <div
            className="absolute -left-20 -top-20 w-[400px] h-[400px] blur-[100px] rounded-full pointer-events-none z-0"
            style={{ backgroundColor: "var(--blob)" }}
          />
          <div className="max-w-[1600px] mx-auto relative z-10">
            <div key={location.pathname} className="page-stage space-y-6">
              {session?.user.sellerReadOnly ? <ReadOnlyNotice /> : null}
              {children}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
