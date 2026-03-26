import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
};

export default function KnowledgeLayout({ children }: Props) {
  return <>{children}</>;
}