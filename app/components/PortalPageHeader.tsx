import type { ReactNode } from "react";
import BrandMark from "@/app/dashboard/[id]/BrandMark";

type Props = {
  pageTitle: string;
  description: string;
  userLabel?: string;
  userValue?: string;
  actions?: ReactNode;
};

export default function PortalPageHeader({
  pageTitle,
  description,
  userLabel,
  userValue,
  actions,
}: Props) {
  return (
    <section className="overflow-hidden rounded-2xl border border-[#B8C9D7] bg-white shadow-[0_10px_30px_rgba(23,58,94,0.10)]">
      <div className="h-1.5 bg-gradient-to-r from-[#173A5E] via-[#3676A8] to-[#78A9CE]" />
      <div className="flex flex-col gap-5 p-6 md:flex-row md:items-start md:justify-between">
        <div className="space-y-4">
          <BrandMark />
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold text-[#173A5E]">{pageTitle}</h1>
            <p className="max-w-3xl text-sm leading-6 text-[#43566B]">
              {description}
            </p>
          </div>
        </div>

        {(userValue || actions) && (
          <div className="flex flex-col gap-3 md:items-end">
            {userValue ? (
              <div className="rounded-xl border border-[#B8C9D7] bg-[#EAF2F8] px-4 py-3 text-sm text-[#294762] shadow-sm">
                {userLabel ? `${userLabel} : ` : ""}
                <span className="font-semibold text-[#173A5E]">{userValue}</span>
              </div>
            ) : null}

            {actions ? <div className="flex flex-wrap gap-3 md:justify-end">{actions}</div> : null}
          </div>
        )}
      </div>
    </section>
  );
}
