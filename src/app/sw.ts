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

declare const self: WorkerGlobalScope & SerwistGlobalConfig;

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

serwist.addEventListeners();
