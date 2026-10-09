import { redirect } from "next/navigation";

// The manual form became the product wizard; old links and bookmarks land there.
export default function ManualProductCreatePage() {
  redirect("/admin/products/new");
}
