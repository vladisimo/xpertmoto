import { redirect } from "next/navigation";

// Categories management moved to a tab on /admin/pricing. Keep this route as a
// permanent redirect so existing bookmarks and links land on the new tab.
export default function FinanceCategoriesRedirect() {
  redirect("/admin/pricing/categories");
}
