export default function ErrorBanner({ message }: { message: string }) {
  if (!message) return null;

  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">
      {message}
    </div>
  );
}