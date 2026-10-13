"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import {
  deleteAccountAction,
  deleteAddressAction,
  logoutAction,
  saveAddressAction,
  updateProfileAction,
} from "@/features/accounts/application/account-actions";
import type { CustomerProfile } from "@/features/accounts/application/customer-account-service";
import { MAX_SAVED_ADDRESSES } from "@/features/accounts/domain/account-config";
import {
  formatWhatsAppDisplay,
  normalizeWhatsAppPhone,
} from "@/features/orders/domain/phone";
import { useI18n } from "@/i18n/i18n-provider";
import { Link } from "@/i18n/link";

type Feedback = { tone: "ok" | "error"; text: string } | null;

function FeedbackLine({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null;
  return (
    <p
      className="account-message"
      data-tone={feedback.tone}
      role={feedback.tone === "error" ? "alert" : "status"}
    >
      {feedback.text}
    </p>
  );
}

export function AccountDashboard({ profile }: { profile: CustomerProfile }) {
  const router = useRouter();
  const { m, href } = useI18n();
  const t = m.account;
  const [profileFeedback, setProfileFeedback] = useState<Feedback>(null);
  const [addressFeedback, setAddressFeedback] = useState<Feedback>(null);
  const [sessionFeedback, setSessionFeedback] = useState<Feedback>(null);
  const [pending, setPending] = useState(false);

  async function run(
    action: () => Promise<{ ok: boolean; message?: string }>,
    setFeedback: (feedback: Feedback) => void,
    success: string,
  ) {
    setPending(true);
    const result = await action();
    setPending(false);
    setFeedback(
      result.ok
        ? { tone: "ok", text: success }
        : { tone: "error", text: result.message ?? t.saveFailed },
    );
    if (result.ok) router.refresh();
    return result.ok;
  }

  function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const national = String(form.get("whatsappNational") ?? "").trim();
    const whatsappE164 = national
      ? normalizeWhatsAppPhone(
          form.get("whatsappCountry") === "972" ? "972" : "970",
          national,
        )
      : null;
    if (national && !whatsappE164) {
      setProfileFeedback({ tone: "error", text: t.invalidWhatsApp });
      return;
    }
    void run(
      () =>
        updateProfileAction({
          displayName: String(form.get("displayName") ?? ""),
          whatsappE164,
          personalizationEnabled: form.get("personalization") === "on",
        }),
      setProfileFeedback,
      t.profileSaved,
    );
  }

  function addAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    void run(
      () =>
        saveAddressAction({
          label: String(form.get("label") ?? ""),
          address: String(form.get("address") ?? ""),
          landmark: String(form.get("landmark") ?? ""),
          isDefault: form.get("isDefault") === "on",
        }),
      setAddressFeedback,
      t.addressAdded,
    ).then((ok) => {
      if (ok) formElement.reset();
    });
  }

  async function signOut(scope: "this" | "all") {
    const ok = await run(
      () => logoutAction(scope),
      setSessionFeedback,
      t.signedOutDone,
    );
    if (ok) router.replace(href("/account"));
  }

  async function deleteAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const ok = await run(
      () => deleteAccountAction(String(form.get("confirmation") ?? "")),
      setSessionFeedback,
      t.accountDeleted,
    );
    if (ok) router.replace(href("/"));
  }

  const whatsappCountry = profile.whatsappE164?.startsWith("+972")
    ? "972"
    : "970";
  const whatsappNational = profile.whatsappE164
    ? `0${profile.whatsappE164.slice(4)}`
    : "";

  return (
    <div className="account-sections">
      <nav className="account-shortcuts" aria-label={t.accountShortcuts}>
        <Link href="/account/orders">{t.myOrders}</Link>
        <Link href="/favorites">{t.favorites}</Link>
      </nav>

      <section className="account-card" aria-labelledby="profile-title">
        <h2 id="profile-title">{t.profileTitle}</h2>
        <p className="account-note">
          {t.verifiedPhone}{" "}
          <bdi dir="ltr">{formatWhatsAppDisplay(profile.phoneE164)}</bdi>
        </p>
        <form className="account-form" onSubmit={saveProfile}>
          <label className="checkout-field">
            <span>{t.name}</span>
            <input
              name="displayName"
              autoComplete="name"
              maxLength={100}
              defaultValue={profile.displayName ?? ""}
            />
          </label>
          <fieldset className="checkout-field checkout-whatsapp-field">
            <legend>{t.whatsappLegend}</legend>
            <div className="checkout-whatsapp-row">
              <label className="checkout-whatsapp-prefix">
                <span className="sr-only">{t.countryCode}</span>
                <select name="whatsappCountry" defaultValue={whatsappCountry}>
                  <option value="970">+970</option>
                  <option value="972">+972</option>
                </select>
              </label>
              <label className="checkout-whatsapp-national">
                <span className="sr-only">{t.whatsappNumber}</span>
                <input
                  name="whatsappNational"
                  type="tel"
                  inputMode="tel"
                  placeholder="05XXXXXXXX"
                  maxLength={24}
                  defaultValue={whatsappNational}
                />
              </label>
            </div>
          </fieldset>
          <label className="account-toggle">
            <input
              type="checkbox"
              name="personalization"
              defaultChecked={profile.personalizationEnabled}
              aria-describedby="personalization-help"
            />
            <span>{t.personalization}</span>
          </label>
          <small id="personalization-help" className="checkout-field-help">
            {t.personalizationHelp}
          </small>
          <FeedbackLine feedback={profileFeedback} />
          <button type="submit" className="account-primary" disabled={pending}>
            {t.saveProfile}
          </button>
        </form>
      </section>

      <section className="account-card" aria-labelledby="addresses-title">
        <h2 id="addresses-title">{t.addressesTitle}</h2>
        {profile.addresses.length ? (
          <ul className="account-addresses">
            {profile.addresses.map((address) => (
              <li key={address.id}>
                <div>
                  <strong>{address.label}</strong>
                  {address.isDefault ? (
                    <span className="account-badge">{t.defaultBadge}</span>
                  ) : null}
                  <p>{address.address}</p>
                  {address.landmark ? <p>{address.landmark}</p> : null}
                </div>
                <div className="account-row-actions">
                  {address.isDefault ? null : (
                    <button
                      type="button"
                      className="account-link-button"
                      onClick={() =>
                        void run(
                          () =>
                            saveAddressAction(
                              {
                                label: address.label,
                                address: address.address,
                                landmark: address.landmark ?? "",
                                isDefault: true,
                              },
                              address.id,
                            ),
                          setAddressFeedback,
                          t.defaultSet,
                        )
                      }
                    >
                      {t.makeDefault}
                    </button>
                  )}
                  <button
                    type="button"
                    className="account-link-button"
                    onClick={() =>
                      void run(
                        () => deleteAddressAction(address.id),
                        setAddressFeedback,
                        t.addressDeleted,
                      )
                    }
                  >
                    {t.delete}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="account-note">{t.noAddresses}</p>
        )}
        {profile.addresses.length < MAX_SAVED_ADDRESSES ? (
          <form className="account-form" onSubmit={addAddress}>
            <label className="checkout-field">
              <span>{t.addressLabel}</span>
              <input
                name="label"
                placeholder={t.addressLabelPlaceholder}
                maxLength={40}
                required
              />
            </label>
            <label className="checkout-field">
              <span>{t.addressDetails}</span>
              <textarea
                name="address"
                rows={3}
                maxLength={500}
                autoComplete="street-address"
                required
              />
            </label>
            <label className="checkout-field">
              <span>{t.landmark}</span>
              <input name="landmark" maxLength={150} />
            </label>
            <label className="account-toggle">
              <input type="checkbox" name="isDefault" />
              <span>{t.setAsDefault}</span>
            </label>
            <FeedbackLine feedback={addressFeedback} />
            <button
              type="submit"
              className="account-secondary"
              disabled={pending}
            >
              {t.addAddress}
            </button>
          </form>
        ) : (
          <FeedbackLine feedback={addressFeedback} />
        )}
      </section>

      <section className="account-card" aria-labelledby="notifications-title">
        <h2 id="notifications-title">{t.notificationsTitle}</h2>
        <p className="account-note">{t.notificationsNote}</p>
      </section>

      <section className="account-card" aria-labelledby="session-title">
        <h2 id="session-title">{t.sessionTitle}</h2>
        <div className="account-row-actions">
          <button
            type="button"
            className="account-secondary"
            disabled={pending}
            onClick={() => void signOut("this")}
          >
            {t.signOut}
          </button>
          <button
            type="button"
            className="account-secondary"
            disabled={pending}
            onClick={() => void signOut("all")}
          >
            {t.signOutAll}
          </button>
        </div>
        <details className="account-danger">
          <summary>{t.deleteAccount}</summary>
          <p className="account-note">{t.deleteAccountNote}</p>
          <form className="account-form" onSubmit={deleteAccount}>
            <label className="checkout-field">
              <span>{t.deleteConfirmLabel}</span>
              <input name="confirmation" autoComplete="off" required />
            </label>
            <button
              type="submit"
              className="account-danger-button"
              disabled={pending}
            >
              {t.deleteForever}
            </button>
          </form>
        </details>
        <FeedbackLine feedback={sessionFeedback} />
      </section>
    </div>
  );
}
