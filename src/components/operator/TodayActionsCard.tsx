import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  AlertTriangle, 
  Clock, 
  ShoppingCart, 
  ListTodo, 
  TrendingDown,
  ChevronRight,
  Zap
} from "lucide-react";
import { Link } from "react-router-dom";

interface TodayActions {
  buy_window_unassigned: number;
  buy_window_stale: number;
  va_tasks_due: number;
  va_tasks_overdue: number;
  trap_validation_pending: number;
  missed_buy_window_7d: number;
  top_buy_window: Array<{
    id: string;
    make: string;
    model: string;
    year: number;
    location: string;
    watch_confidence: string;
    buy_window_at: string;
  }> | null;
}

export function TodayActionsCard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["today-actions"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_today_actions");
      if (error) throw error;
      return data as unknown as TodayActions;
    },
    refetchInterval: 60000, // Refresh every minute
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            Today's Actions
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            Today's Actions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Failed to load actions</p>
        </CardContent>
      </Card>
    );
  }

  const hasUrgent = data.buy_window_stale > 0 || data.va_tasks_overdue > 0;
  const hasTasks = data.buy_window_unassigned > 0 || data.va_tasks_due > 0 || data.trap_validation_pending > 0;

  return (
    <Card className={hasUrgent ? "border-destructive" : ""}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-primary" />
          What Matters Today
        </CardTitle>
        <CardDescription>
          {hasUrgent ? "Urgent items need attention" : hasTasks ? "Tasks waiting for action" : "All caught up!"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Urgent Section */}
        {hasUrgent && (
          <div className="space-y-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
            <div className="text-sm font-medium text-destructive flex items-center gap-1">
              <AlertTriangle className="h-4 w-4" /> Urgent
            </div>
            
            {data.buy_window_stale > 0 && (
              <Link to="/trap-inventory?status=buy_window" className="flex items-center justify-between hover:bg-destructive/5 p-2 rounded">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-destructive" />
                  <span className="text-sm">Stale BUY WINDOW (36h+)</span>
                </div>
                <Badge variant="destructive">{data.buy_window_stale}</Badge>
              </Link>
            )}
            
            {data.va_tasks_overdue > 0 && (
              <Link to="/va/tasks" className="flex items-center justify-between hover:bg-destructive/5 p-2 rounded">
                <div className="flex items-center gap-2">
                  <ListTodo className="h-4 w-4 text-destructive" />
                  <span className="text-sm">VA Tasks Overdue</span>
                </div>
                <Badge variant="destructive">{data.va_tasks_overdue}</Badge>
              </Link>
            )}
          </div>
        )}

        {/* Action Items */}
        <div className="space-y-1">
          {data.buy_window_unassigned > 0 && (
            <Link to="/trap-inventory?status=buy_window" className="flex items-center justify-between hover:bg-accent p-2 rounded">
              <div className="flex items-center gap-2">
                <ShoppingCart className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Unassigned BUY WINDOW</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="default">{data.buy_window_unassigned}</Badge>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </Link>
          )}
          
          {data.va_tasks_due > 0 && (
            <Link to="/va/tasks" className="flex items-center justify-between hover:bg-accent p-2 rounded">
              <div className="flex items-center gap-2">
                <ListTodo className="h-4 w-4 text-orange-500" />
                <span className="text-sm">VA Tasks Due (24h)</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{data.va_tasks_due}</Badge>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </Link>
          )}
          
          {data.trap_validation_pending > 0 && (
            <Link to="/operator/preflight" className="flex items-center justify-between hover:bg-accent p-2 rounded">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-blue-500" />
                <span className="text-sm">Traps Pending Validation</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{data.trap_validation_pending}</Badge>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </Link>
          )}
        </div>

        {/* Missed Opportunities Learning */}
        {data.missed_buy_window_7d > 0 && (
          <div className="pt-2 border-t">
            <div className="flex items-center justify-between p-2">
              <div className="flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Missed Buy Windows (7d)</span>
              </div>
              <Badge variant="outline" className="text-muted-foreground">{data.missed_buy_window_7d}</Badge>
            </div>
          </div>
        )}

        {/* Top Priority Car */}
        {data.top_buy_window && data.top_buy_window.length > 0 && (
          <div className="pt-3 border-t">
            <div className="text-xs font-medium text-muted-foreground mb-2">TOP PRIORITY</div>
            <Link 
              to={`/trap-inventory?highlight=${data.top_buy_window[0].id}`}
              className="block p-3 rounded-lg bg-primary/5 border border-primary/20 hover:bg-primary/10 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">
                    {data.top_buy_window[0].year} {data.top_buy_window[0].make} {data.top_buy_window[0].model}
                  </div>
                  <div className="text-sm text-muted-foreground">{data.top_buy_window[0].location}</div>
                </div>
                <Badge 
                  variant={data.top_buy_window[0].watch_confidence === 'high' ? 'default' : 'secondary'}
                >
                  {data.top_buy_window[0].watch_confidence}
                </Badge>
              </div>
            </Link>
          </div>
        )}

        {/* All Clear State */}
        {!hasUrgent && !hasTasks && data.missed_buy_window_7d === 0 && (
          <div className="text-center py-6 text-muted-foreground">
            <div className="text-2xl mb-2">✅</div>
            <p>All caught up. System is running.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
