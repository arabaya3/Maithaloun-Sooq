import type { Metadata } from "next";
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
import { Link } from "@/i18n/link";
import { getMessages } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const m = await getMessages();
  return {
    title: m.meta.accountTitle,
    robots: { index: false, follow: false },
  };
}

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; mode?: string }>;
}) {
  await connection();
  const [params, m] = await Promise.all([searchParams, getMessages()]);
  const t = m.account;
  const enabled = customerAccountsEnabled();
  const customer = await getCustomerSession();
  const profile = customer
    ? await customerAccountService.profile(customer.id)
    : null;
  const creating = params.mode === "create";

  return (
    <>
      <SiteHeader />
      <main className="page-shell account-page">
        <div className="account-heading">
          <span className="eyebrow">MAYTHA MARKET</span>
          <h1>{profile ? t.greeting(profile.displayName ?? null) : t.title}</h1>
        </div>

        {profile ? (
          <AccountDashboard profile={profile} />
        ) : (
          <div className="account-sections">
            <section className="account-card" aria-labelledby="account-entry">
              <h2 id="account-entry">
                {!enabled
                  ? t.unavailableTitle
                  : creating
                    ? t.createTitle
                    : t.signInTitle}
              </h2>
              <p className="account-note">
                {enabled ? t.benefits : t.unavailableNote}
              </p>
              {enabled ? (
                <>
                  <div
                    className="account-mode-switch"
                    role="group"
                    aria-label={t.modeLabel}
                  >
                    <Link
                      href="/account"
                      aria-current={creating ? undefined : "page"}
                    >
                      {t.signInTitle}
                    </Link>
                    <Link
                      href="/account?mode=create"
                      aria-current={creating ? "page" : undefined}
                    >
                      {t.createTitle}
                    </Link>
                  </div>
                  <PhoneLoginForm next={safeAccountNext(params.next)} />
                </>
              ) : null}
              <Link className="account-guest-link" href="/">
                {t.continueAsGuest}
              </Link>
            </section>
            <nav className="account-shortcuts" aria-label={t.shortcuts}>
              <Link href="/favorites">{t.favorites}</Link>
            </nav>
            <section className="account-card">
              <h2>{t.storeApp}</h2>
              <InstallHelpEntry />
            </section>
          </div>
        )}
      </main>
      <MobileNavigation />
    </>
  );
}
