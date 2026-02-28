import { useState } from "react";
import { OperatorLayout } from "@/components/layout/OperatorLayout";
import { OogleBotJobForm } from "@/components/ooglebot/OogleBotJobForm";
import { OogleBotJobList } from "@/components/ooglebot/OogleBotJobList";
import { OogleBotJobDetail } from "@/components/ooglebot/OogleBotJobDetail";
import { OogleBotSearch } from "@/components/ooglebot/OogleBotSearch";
import kitingWingMark from "@/assets/kiting-wing-mark.jpg";

export default function OogleBotPage() {
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  return (
    <OperatorLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        <div className="flex items-center gap-3">
          <img src={kitingWingMark} alt="Kiting mode" className="h-8 w-auto opacity-80" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">OogleBot</h1>
            <p className="text-sm text-muted-foreground">
              Dealer demand hunting engine — budget-driven, cheapest 3 nationally
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Create + List */}
          <div className="lg:col-span-2 space-y-6">
            <OogleBotJobForm />
            <OogleBotJobList
              selectedJobId={selectedJobId}
              onSelectJob={setSelectedJobId}
            />
          </div>

          {/* Right: Active Hunt first, then Job Detail */}
          <div className="space-y-6">
            <OogleBotSearch />
            <OogleBotJobDetail jobId={selectedJobId} />
          </div>
        </div>
      </div>
    </OperatorLayout>
  );
}
