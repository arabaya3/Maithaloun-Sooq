import "server-only";

import { cache } from "react";

import { db } from "@/server/db/db";

import {
  listAssignableCategories,
  listStorefrontCategories,
} from "./category-queries";

// One category read per request, shared by the layout and the page.
export const storefrontCategories = cache(() => listStorefrontCategories(db));

export const assignableCategories = cache(() => listAssignableCategories(db));
