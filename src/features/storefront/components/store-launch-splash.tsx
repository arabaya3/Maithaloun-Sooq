import Image from "next/image";

import { LOGO_SIZES } from "@/features/storefront/brand-logo-asset";

import { LaunchSplashReady } from "./launch-splash-ready";

export const LAUNCH_SESSION_KEY = "souq:launched";

// Runs before first paint: a launch already seen in this session skips the splash on reloads.
const skipRepeatLaunch = `try{var k="${LAUNCH_SESSION_KEY}";if(sessionStorage.getItem(k)==="1"){document.documentElement.dataset.launch="skip"}else{sessionStorage.setItem(k,"1")}}catch(e){}`;

export function StoreLaunchSplash() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: skipRepeatLaunch }} />
      <div className="launch-splash" data-testid="launch-splash">
        <p className="sr-only" role="status">
          جارٍ فتح سوق ميثلون
        </p>
        <div className="launch-splash-brand" aria-hidden="true">
          <div className="launch-splash-mark">
            <Image
              className="launch-splash-logo"
              src="/brand/maithaloun-symbol.png"
              alt=""
              width={360}
              height={285}
              sizes={LOGO_SIZES}
              priority
            />
            <span className="launch-splash-shine" />
            <span className="launch-splash-bubble" />
            <span className="launch-splash-bubble" />
          </div>
          <p className="launch-splash-name">
            <span className="launch-splash-soq">سوق</span> ميثلون
          </p>
          <p className="launch-splash-tagline">منظفات ومعطرات جو</p>
        </div>
      </div>
      <LaunchSplashReady />
    </>
  );
}
