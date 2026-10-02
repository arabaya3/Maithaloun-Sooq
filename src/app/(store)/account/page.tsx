import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { customerAccountService } from "@/features/accounts/application/customer-services";
import { getCustomerSession } from "@/features/accounts/application/customer-session";
import { customerAccountsEnabled } from "@/features/accounts/domain/account-config";
import { safeAccountNext } from "@/features/accounts/domain/safe-next";
import { AccountDashboard } from "@/features/accounts/ui/account-dashboard";
import { PhoneLoginForm } from "@/features/accounts/ui/phone-login-form";
import { InstallHelpEntry } from "@/features/pwa/install-help-entry";
import { MobileNavigation } from "@/features/storefront/components/mobile-navigation";
import { SiteHeader } from "@/features/storefront/components/site-header";

export const metadata: Metadata = {
  title: "حسابي",
  robots: { index: false, follow: false },
};

const BENEFITS =
  "أنشئ حساباً لحفظ المفضلة، متابعة الطلبات وإعادة طلب مشترياتك بسهولة. الحساب اختياري، ويمكنك الطلب كضيف دائماً.";

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; mode?: string }>;
}) {
  await connection();
  const params = await searchParams;
  const enabled = customerAccountsEnabled();
  const customer = await getCustomerSession();
  const profile = customer
    ? await customerAccountService.profile(customer.id)
    : null;
  const creating = params.mode === "create";
  const greeting = profile?.displayName
    ? `أهلاً ${profile.displayName}`
    : "أهلاً";

  return (
    <>
      <SiteHeader />
      <main className="page-shell account-page">
        <div className="account-heading">
          <span className="eyebrow">سوق ميثلون</span>
          <h1>{profile ? greeting : "حسابي"}</h1>
        </div>

        {profile ? (
          <AccountDashboard profile={profile} />
        ) : (
          <div className="account-sections">
            <section className="account-card" aria-labelledby="account-entry">
              <h2 id="account-entry">
                {!enabled
                  ? "الحسابات غير متاحة بعد"
                  : creating
                    ? "إنشاء حساب"
                    : "تسجيل الدخول"}
              </h2>
              <p className="account-note">
                {enabled
                  ? BENEFITS
                  : "يمكنك الطلب كضيف كالمعتاد، والمفضلة محفوظة على هذا الجهاز."}
              </p>
              {enabled ? (
                <>
                  <div
                    className="account-mode-switch"
                    role="group"
                    aria-label="نوع الدخول"
                  >
                    <Link
                      href="/account"
                      aria-current={creating ? undefined : "page"}
                    >
                      تسجيل الدخول
                    </Link>
                    <Link
                      href="/account?mode=create"
                      aria-current={creating ? "page" : undefined}
                    >
                      إنشاء حساب
                    </Link>
                  </div>
                  <PhoneLoginForm next={safeAccountNext(params.next)} />
                </>
              ) : null}
              <Link className="account-guest-link" href="/">
                متابعة كضيف
              </Link>
            </section>
            <nav className="account-shortcuts" aria-label="اختصارات">
              <Link href="/favorites">المفضلة</Link>
            </nav>
            <section className="account-card">
              <h2>تطبيق المتجر</h2>
              <InstallHelpEntry />
            </section>
          </div>
        )}
      </main>
      <MobileNavigation />
    </>
  );
}
