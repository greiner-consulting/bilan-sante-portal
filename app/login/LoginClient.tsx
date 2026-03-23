"use client";

import LoginForm from "./LoginForm";

export default function LoginClient({ next }: { next: string }) {
  return <LoginForm next={next} />;
}