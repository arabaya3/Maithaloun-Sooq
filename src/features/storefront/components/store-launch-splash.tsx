import { getMessages } from "@/i18n/server";

import { BrandWordmark } from "./brand-logo";
import { LaunchSplashReady } from "./launch-splash-ready";

export const LAUNCH_SESSION_KEY = "souq:launched";

// Runs before first paint: a launch already seen in this session skips the splash on reloads.
const skipRepeatLaunch = `try{var k="${LAUNCH_SESSION_KEY}";if(sessionStorage.getItem(k)==="1"){document.documentElement.dataset.launch="skip"}else{sessionStorage.setItem(k,"1")}}catch(e){}`;

export async function StoreLaunchSplash() {
  const m = await getMessages();
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: skipRepeatLaunch }} />
      <div className="launch-splash" data-testid="launch-splash">
        <p className="sr-only" role="status">
          {m.store.opening}
        </p>
        <div className="launch-splash-brand" aria-hidden="true">
          <BrandWordmark />
          <span className="launch-splash-rule" />
        </div>
      </div>
      <LaunchSplashReady />
    </>
  );
}
