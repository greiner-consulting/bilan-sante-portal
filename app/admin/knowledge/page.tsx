import { requireAdminUser } from "@/lib/auth/access-control";

export default async function KnowledgePage() {
  await requireAdminUser();

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Knowledge</h1>
      <p className="mt-2 text-sm text-gray-600">
        Espace de connaissance en préparation.
      </p>
    </div>
  );
}