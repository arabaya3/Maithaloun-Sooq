import "server-only";

import { db } from "@/server/db/db";

import { OrderService } from "./order-service";
import { StoreContactService } from "./store-contact-service";

export const orderService = new OrderService(db);

export const storeContactService = new StoreContactService(db);
