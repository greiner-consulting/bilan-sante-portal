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
    <section className="rounded-2xl border bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-4">
          <BrandMark />
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold text-slate-900">{pageTitle}</h1>
            <p className="max-w-3xl text-sm leading-6 text-slate-700">
              {description}
            </p>
          </div>
        </div>

        {(userValue || actions) && (
          <div className="flex flex-col gap-3 md:items-end">
            {userValue ? (
              <div className="rounded-xl border bg-slate-50 px-4 py-3 text-sm text-slate-700">
                {userLabel ? `${userLabel} : ` : ""}
                <span className="font-medium">{userValue}</span>
              </div>
            ) : null}

            {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
          </div>
        )}
      </div>
    </section>
  );
}