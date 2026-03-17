import { OperatorLayout } from "@/components/layout/OperatorLayout";
import { OogleBotSearch } from "@/components/ooglebot/OogleBotSearch";
import kitingWingMark from "@/assets/kiting-wing-mark.jpg";

export default function OogleBotPage() {
  return (
    <OperatorLayout>
      <div className="p-6 space-y-6 max-w-5xl mx-auto">
        <div className="flex items-center gap-3">
          <img src={kitingWingMark} alt="Kiting mode" className="h-8 w-auto opacity-80" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">OogleBot</h1>
            <p className="text-sm text-muted-foreground">
              Dealer demand hunting engine — budget-driven, cheapest 3 nationally
            </p>
          </div>
        </div>

        <OogleBotSearch />
      </div>
    </OperatorLayout>
  );
}
