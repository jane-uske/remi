import { redirect } from "next/navigation";

// `/remi` was renamed to `/develop`. Keep the old path working for bookmarks
// and inbound links.
export default function RemiLegacyRedirect() {
  redirect("/develop");
}
