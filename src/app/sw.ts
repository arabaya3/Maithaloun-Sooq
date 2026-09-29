/// <reference lib="webworker" />

import {
  CacheFirst,
  ExpirationPlugin,
  NetworkOnly,
  Serwist,
  StaleWhileRevalidate,
  type PrecacheEntry,
  type SerwistGlobalConfig,
} from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope & SerwistGlobalConfig;

const sensitivePrefixes = [
  "/api/",
  "/auth/",
  "/checkout",
  "/orders/",
  "/account",
  "/admin",
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      matcher: ({ sameOrigin, url }) =>
        sameOrigin &&
        (url.pathname.startsWith("/_next/static/") ||
          url.pathname.startsWith("/icons/")),
      handler: new CacheFirst({
        cacheName: "static-assets-v1",
        plugins: [
          new ExpirationPlugin({
            maxEntries: 80,
            maxAgeSeconds: 30 * 24 * 60 * 60,
          }),
        ],
      }),
    },
    {
      matcher: ({ sameOrigin, request }) =>
        sameOrigin && request.destination === "image",
      handler: new StaleWhileRevalidate({
        cacheName: "local-images-v1",
        plugins: [
          new ExpirationPlugin({
            maxEntries: 40,
            maxAgeSeconds: 7 * 24 * 60 * 60,
          }),
        ],
      }),
    },
    {
      matcher: ({ sameOrigin, request }) =>
        sameOrigin && request.mode === "navigate",
      handler: new NetworkOnly(),
    },
    {
      matcher: /.*/,
      method: "GET",
      handler: new NetworkOnly(),
    },
  ],
  fallbacks: {
    entries: [
      {
        url: "/~offline",
        matcher: ({ request }) => {
          const path = new URL(request.url).pathname;
          return (
            request.mode === "navigate" &&
            !sensitivePrefixes.some((prefix) => path.startsWith(prefix))
          );
        },
      },
    ],
  },
});

self.addEventListener("push", (event) => {
  const payload = event.data?.json() as
    { title?: string; body?: string; href?: string } | undefined;
  event.waitUntil(
    self.registration.showNotification(payload?.title ?? "سوق ميثلون", {
      body: payload?.body ?? "لديك تحديث جديد في الطلبات.",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { href: payload?.href ?? "/admin/orders" },
      tag: payload?.href ?? "admin-update",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = String(event.notification.data?.href ?? "/admin/orders");
  const url = new URL(href, self.location.origin).href;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clients) => {
        const existing = clients.find((client) => client.url === url);
        if (existing && "focus" in existing) return existing.focus();
        return self.clients.openWindow(url);
      }),
  );
});

serwist.addEventListeners();
