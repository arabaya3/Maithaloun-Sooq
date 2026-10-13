"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";

import {
  requestLoginCodeAction,
  verifyLoginCodeAction,
} from "@/features/accounts/application/account-actions";
import {
  WHATSAPP_COUNTRY_CODES,
  formatWhatsAppDisplay,
} from "@/features/orders/domain/phone";
import { useI18n } from "@/i18n/i18n-provider";

const PREFIX_LABELS = { "970": "+970", "972": "+972" } as const;

export function PhoneLoginForm({ next }: { next: string }) {
  const router = useRouter();
  const { m, href } = useI18n();
  const t = m.account;
  const [phoneE164, setPhoneE164] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setMessage("");
    const result = await requestLoginCodeAction({
      countryCode: form.get("countryCode"),
      nationalNumber: form.get("nationalNumber"),
    });
    setPending(false);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setPhoneE164(result.phoneE164);
    queueMicrotask(() => codeRef.current?.focus());
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!phoneE164) return;
    const form = new FormData(event.currentTarget);
    setPending(true);
    setMessage("");
    const result = await verifyLoginCodeAction({
      phoneE164,
      code: String(form.get("code") ?? ""),
    });
    setPending(false);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    router.replace(href(next));
    router.refresh();
  }

  if (!phoneE164) {
    return (
      <form className="account-form" onSubmit={requestCode} noValidate>
        <fieldset className="checkout-field checkout-whatsapp-field">
          <legend>{t.phoneLegend}</legend>
          <div className="checkout-whatsapp-row">
            <label className="checkout-whatsapp-prefix">
              <span className="sr-only">{t.countryCode}</span>
              <select name="countryCode" defaultValue="970">
                {WHATSAPP_COUNTRY_CODES.map((code) => (
                  <option key={code} value={code}>
                    {PREFIX_LABELS[code]}
                  </option>
                ))}
              </select>
            </label>
            <label className="checkout-whatsapp-national">
              <span className="sr-only">{t.localNumber}</span>
              <input
                name="nationalNumber"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                placeholder="05XXXXXXXX"
                maxLength={24}
                required
                aria-describedby="login-phone-help"
              />
            </label>
          </div>
          <small id="login-phone-help" className="checkout-field-help">
            {t.phoneHelp}
          </small>
        </fieldset>
        {message ? (
          <p className="account-message" role="alert">
            {message}
          </p>
        ) : null}
        <button type="submit" className="account-primary" disabled={pending}>
          {pending ? t.sending : t.sendCode}
        </button>
      </form>
    );
  }

  return (
    <form className="account-form" onSubmit={verifyCode} noValidate>
      <p className="account-note" role="status">
        {t.codeSentBefore}{" "}
        <bdi dir="ltr">{formatWhatsAppDisplay(phoneE164)}</bdi>{" "}
        {t.codeSentAfter}
      </p>
      <label className="checkout-field">
        <span>{t.codeLabel}</span>
        <input
          ref={codeRef}
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          dir="ltr"
          required
        />
      </label>
      {message ? (
        <p className="account-message" role="alert">
          {message}
        </p>
      ) : null}
      <button type="submit" className="account-primary" disabled={pending}>
        {pending ? t.verifying : t.confirmSignIn}
      </button>
      <button
        type="button"
        className="account-link-button"
        onClick={() => {
          setPhoneE164(null);
          setMessage("");
        }}
      >
        {t.changeNumber}
      </button>
    </form>
  );
}
