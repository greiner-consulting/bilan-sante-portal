import { redirect } from "next/navigation";
import { requireAdminUser } from "@/lib/auth/access-control";

export default async function AdminDashboardEntryPage() {
  await requireAdminUser();
  redirect("/dashboard");
}
