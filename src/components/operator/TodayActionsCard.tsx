import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  AlertTriangle, 
  Clock, 
  ShoppingCart, 
  ListTodo, 
  TrendingDown,
  ChevronRight,
  Zap,
  CheckCircle2,
  Target
} from "lucide-react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";

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
    asking_price?: number;
  }> | null;
  run_at?: string;
}

export function TodayActionsCard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["today-actions"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_today_actions");
      if (error) throw error;
      return data as unknown as TodayActions;
    },
    refetchInterval: 60000, // Refresh every 60 seconds
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            What Matters Today
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            What Matters Today
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">Failed to load actions</p>
        </CardContent>
      </Card>
    );
  }

  const hasUrgent = data.buy_window_stale > 0 || data.va_tasks_overdue > 0;
  const hasActions = data.buy_window_unassigned > 0 || data.va_tasks_due > 0 || data.trap_validation_pending > 0;
  const hasLearning = data.missed_buy_window_7d > 0;
  const allClear = !hasUrgent && !hasActions && !hasLearning;

  return (
    <Card className={hasUrgent ? "border-destructive/50 shadow-destructive/10 shadow-lg" : ""}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Zap className={`h-5 w-5 ${hasUrgent ? 'text-destructive' : 'text-primary'}`} />
          What Matters Today
        </CardTitle>
        <CardDescription>
          {hasUrgent 
            ? "🔴 Urgent items need attention" 
            : hasActions 
              ? "Tasks waiting for action" 
              : "All caught up!"}
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* URGENT Section */}
        {hasUrgent && (
          <div className="space-y-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30">
            <div className="text-sm font-semibold text-destructive flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4" /> URGENT
            </div>
            
            {data.buy_window_stale > 0 && (
              <Link 
                to="/trap-inventory?status=buy_window" 
                className="flex items-center justify-between hover:bg-destructive/10 p-2 rounded transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-destructive" />
                  <span className="text-sm font-medium">Stale BUY WINDOW (36h+)</span>
                </div>
                <Badge variant="destructive">{data.buy_window_stale}</Badge>
              </Link>
            )}
            
            {data.va_tasks_overdue > 0 && (
              <Link 
                to="/va/tasks" 
                className="flex items-center justify-between hover:bg-destructive/10 p-2 rounded transition-colors"
              >
                <div className="flex items-center gap-2">
                  <ListTodo className="h-4 w-4 text-destructive" />
                  <span className="text-sm font-medium">VA Tasks Overdue</span>
                </div>
                <Badge variant="destructive">{data.va_tasks_overdue}</Badge>
              </Link>
            )}
          </div>
        )}

        {/* ACTIONS Section */}
        {hasActions && (
          <div className="space-y-1">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Actions
            </div>
            
            {data.buy_window_unassigned > 0 && (
              <Link 
                to="/trap-inventory?status=buy_window" 
                className="flex items-center justify-between hover:bg-accent p-2 rounded transition-colors"
              >
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
              <Link 
                to="/va/tasks" 
                className="flex items-center justify-between hover:bg-accent p-2 rounded transition-colors"
              >
                <div className="flex items-center gap-2">
                  <ListTodo className="h-4 w-4 text-amber-500" />
                  <span className="text-sm">VA Tasks Due (24h)</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{data.va_tasks_due}</Badge>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </Link>
            )}
            
            {data.trap_validation_pending > 0 && (
              <Link 
                to="/operator/preflight" 
                className="flex items-center justify-between hover:bg-accent p-2 rounded transition-colors"
              >
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
        )}

        {/* LEARNING Section */}
        {hasLearning && (
          <div className="pt-2 border-t">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Learning
            </div>
            <div className="flex items-center justify-between p-2">
              <div className="flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Missed Buy Windows (7d)</span>
              </div>
              <Badge variant="outline" className="text-muted-foreground">{data.missed_buy_window_7d}</Badge>
            </div>
          </div>
        )}

        {/* TOP PRIORITY CAR */}
        {data.top_buy_window && data.top_buy_window.length > 0 && (
          <div className="pt-3 border-t">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-primary uppercase tracking-wide mb-2">
              <Target className="h-3.5 w-3.5" />
              Top Priority
            </div>
            <Link 
              to={`/trap-inventory?highlight=${data.top_buy_window[0].id}`}
              className="block p-3 rounded-lg bg-primary/5 border border-primary/20 hover:bg-primary/10 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold">
                    {data.top_buy_window[0].year} {data.top_buy_window[0].make} {data.top_buy_window[0].model}
                  </div>
                  <div className="text-sm text-muted-foreground flex items-center gap-2">
                    <span>{data.top_buy_window[0].location || 'Unknown location'}</span>
                    {data.top_buy_window[0].asking_price && (
                      <>
                        <span>•</span>
                        <span className="font-medium text-foreground">
                          ${Math.round(data.top_buy_window[0].asking_price).toLocaleString()}
                        </span>
                      </>
                    )}
                  </div>
                  {data.top_buy_window[0].buy_window_at && (
                    <div className="text-xs text-muted-foreground mt-1">
                      In window {formatDistanceToNow(new Date(data.top_buy_window[0].buy_window_at), { addSuffix: true })}
                    </div>
                  )}
                </div>
                <Badge 
                  variant={data.top_buy_window[0].watch_confidence === 'high' ? 'default' : 'secondary'}
                  className="shrink-0"
                >
                  {data.top_buy_window[0].watch_confidence || 'unknown'}
                </Badge>
              </div>
            </Link>
          </div>
        )}

        {/* ALL CLEAR State */}
        {allClear && (
          <div className="text-center py-8">
            <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto mb-3" />
            <p className="font-medium text-foreground">All caught up</p>
            <p className="text-sm text-muted-foreground mt-1">System is running. Go find some deals.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
