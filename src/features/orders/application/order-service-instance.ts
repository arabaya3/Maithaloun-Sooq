import "server-only";

import { db } from "@/server/db/db";

import { OrderService } from "./order-service";

export const orderService = new OrderService(db);
