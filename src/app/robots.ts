import type { MetadataRoute } from "next";

const privatePaths = ["/cart", "/checkout", "/orders"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin",
        "/api",
        ...privatePaths,
        ...privatePaths.map((path) => `/en${path}`),
      ],
    },
  };
}
