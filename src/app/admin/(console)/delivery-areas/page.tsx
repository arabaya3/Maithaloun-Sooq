import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "مناطق التوصيل",
};

export default function AdminDeliveryAreasPage() {
  redirect("/admin/settings");
}
