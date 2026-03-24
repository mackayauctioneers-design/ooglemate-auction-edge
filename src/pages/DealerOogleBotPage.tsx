import { useState } from "react";
import { DealerLayout } from "@/components/layout/DealerLayout";
import { OogleBotSearch } from "@/components/ooglebot/OogleBotSearch";
import { Bot } from "lucide-react";

export default function DealerOogleBotPage() {
  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-3">
          <Bot className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">OogleBot</h1>
            <p className="text-sm text-muted-foreground">
              Search for vehicles across the market
            </p>
          </div>
        </div>

        <OogleBotSearch />
      </div>
    </AppLayout>
  );
}
