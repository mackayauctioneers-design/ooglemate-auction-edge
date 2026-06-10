import { useAuth } from '@/contexts/AuthContext';
import { DealerLayout } from '@/components/layout/DealerLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import TradingDeskPage from '@/pages/operator/TradingDeskPage';

export default function DealerTradingDeskPage() {
  const { currentUser, isLoading, isAdmin } = useAuth();

  if (isLoading) {
    return (
      <DealerLayout>
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </DealerLayout>
    );
  }

  if (isAdmin) {
    return <Navigate to="/operator/trading-desk" replace />;
  }

  if (!currentUser?.account_id) {
    return (
      <DealerLayout>
        <div className="p-6 max-w-2xl mx-auto">
          <Card>
            <CardContent className="p-8 text-center space-y-2">
              <h2 className="text-xl font-semibold">Trading Desk</h2>
              <p className="text-muted-foreground">
                Your dealership isn't linked to a Carbitrage account yet — contact your account manager to get set up.
              </p>
            </CardContent>
          </Card>
        </div>
      </DealerLayout>
    );
  }

  return <TradingDeskPage mode="dealer" lockedAccountId={currentUser.account_id} />;
}
