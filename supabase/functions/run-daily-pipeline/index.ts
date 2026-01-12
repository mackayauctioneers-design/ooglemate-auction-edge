import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Use 'any' for supabase client type in edge function context
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

interface StepConfig {
  name: string;
  order: number;
  handler: (supabase: SupabaseClient, stepId: string) => Promise<StepResult>;
}

interface StepResult {
  recordsProcessed?: number;
  recordsCreated?: number;
  recordsUpdated?: number;
  recordsFailed?: number;
  errorSample?: string;
  metadata?: Record<string, unknown>;
}

const PIPELINE_STEPS: StepConfig[] = [
  {
    name: "trap_health",
    order: 1,
    handler: async (supabase, _stepId) => {
      // Call trap-health-alerts function
      const { data, error } = await supabase.functions.invoke("trap-health-alerts");
      if (error) throw new Error(`trap-health-alerts: ${error.message}`);
      return {
        recordsProcessed: data?.trapsChecked ?? 0,
        recordsCreated: data?.alertsSent ?? 0,
        metadata: data,
      };
    },
  },
  {
    name: "pickles_ingestion",
    order: 2,
    handler: async (supabase, _stepId) => {
      // Call pickles-crawl function
      const { data, error } = await supabase.functions.invoke("pickles-crawl");
      if (error) throw new Error(`pickles-crawl: ${error.message}`);
      return {
        recordsProcessed: data?.lotsFound ?? 0,
        recordsCreated: data?.lotsCreated ?? 0,
        recordsUpdated: data?.lotsUpdated ?? 0,
        metadata: data,
      };
    },
  },
  {
    name: "valuations_ingestion",
    order: 3,
    handler: async (supabase, _stepId) => {
      // Call fingerprint-materialize function
      const { data, error } = await supabase.functions.invoke("fingerprint-materialize");
      if (error) throw new Error(`fingerprint-materialize: ${error.message}`);
      return {
        recordsProcessed: data?.records_upserted ?? 0,
        metadata: data,
      };
    },
  },
  {
    name: "f3_ingestion",
    order: 4,
    handler: async (supabase, _stepId) => {
      // Call f3-crawl function
      const { data, error } = await supabase.functions.invoke("f3-crawl");
      if (error) throw new Error(`f3-crawl: ${error.message}`);
      return {
        recordsProcessed: data?.lotsFound ?? 0,
        recordsCreated: data?.lotsCreated ?? 0,
        recordsUpdated: data?.lotsUpdated ?? 0,
        metadata: data,
      };
    },
  },
  {
    name: "postprocess_rules",
    order: 5,
    handler: async (supabase, _stepId) => {
      // Call refresh-watch-statuses function
      const { data, error } = await supabase.functions.invoke("refresh-watch-statuses");
      if (error) throw new Error(`refresh-watch-statuses: ${error.message}`);
      return {
        recordsProcessed: data?.total_evaluated ?? 0,
        recordsUpdated: data?.watching_count ?? 0,
        metadata: data,
      };
    },
  },
  {
    name: "slack_summary",
    order: 6,
    handler: async (supabase, _stepId) => {
      // Call buy-window-slack function
      const { data, error } = await supabase.functions.invoke("buy-window-slack");
      if (error) throw new Error(`buy-window-slack: ${error.message}`);
      return {
        recordsProcessed: data?.vehiclesFound ?? 0,
        metadata: data,
      };
    },
  },
];

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    // Parse request body
    const body = await req.json().catch(() => ({}));
    const triggeredBy = body.triggered_by ?? "manual";
    const retryFailedOnly = body.retry_failed_only ?? false;
    const previousRunId = body.previous_run_id;

    // Try to acquire advisory lock to prevent concurrent runs
    const { data: lockAcquired, error: lockError } = await supabase.rpc("try_acquire_pipeline_lock");
    
    if (lockError) {
      console.error("Lock acquisition error:", lockError);
      throw new Error("Failed to check pipeline lock");
    }

    if (!lockAcquired) {
      return new Response(
        JSON.stringify({ 
          error: "Pipeline is already running", 
          code: "PIPELINE_LOCKED" 
        }),
        { 
          status: 409, 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        }
      );
    }

    let stepsToRun = PIPELINE_STEPS;
    
    // If retrying failed steps, get them from previous run
    if (retryFailedOnly && previousRunId) {
      const { data: failedSteps } = await supabase
        .from("pipeline_steps")
        .select("step_name")
        .eq("run_id", previousRunId)
        .eq("status", "FAIL");
      
      if (failedSteps && failedSteps.length > 0) {
        const failedNames = failedSteps.map((s: { step_name: string }) => s.step_name);
        stepsToRun = PIPELINE_STEPS.filter((s) => failedNames.includes(s.name));
      }
    }

    // Create pipeline run record
    const { data: runData, error: runError } = await supabase
      .from("pipeline_runs")
      .insert({
        status: "RUNNING",
        triggered_by: triggeredBy,
        total_steps: stepsToRun.length,
        completed_steps: 0,
        failed_steps: 0,
      })
      .select("id")
      .single();

    if (runError || !runData) {
      await supabase.rpc("release_pipeline_lock");
      throw new Error(`Failed to create pipeline run: ${runError?.message}`);
    }

    const runId = runData.id;
    console.log(`Pipeline run started: ${runId}`);

    // Insert all step records as PENDING
    const stepInserts = stepsToRun.map((step) => ({
      run_id: runId,
      step_name: step.name,
      step_order: step.order,
      status: "PENDING",
    }));

    const { data: stepsData, error: stepsError } = await supabase
      .from("pipeline_steps")
      .insert(stepInserts)
      .select("id, step_name, step_order");

    if (stepsError) {
      await supabase
        .from("pipeline_runs")
        .update({ status: "FAIL", completed_at: new Date().toISOString(), error_summary: stepsError.message })
        .eq("id", runId);
      await supabase.rpc("release_pipeline_lock");
      throw new Error(`Failed to create step records: ${stepsError.message}`);
    }

    // Create step ID map
    const stepIdMap = new Map<string, string>();
    stepsData?.forEach((s: { id: string; step_name: string }) => {
      stepIdMap.set(s.step_name, s.id);
    });

    let completedCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    // Execute steps sequentially
    for (const step of stepsToRun.sort((a, b) => a.order - b.order)) {
      const stepId = stepIdMap.get(step.name)!;
      console.log(`Starting step: ${step.name}`);

      // Mark step as RUNNING
      await supabase
        .from("pipeline_steps")
        .update({ status: "RUNNING", started_at: new Date().toISOString() })
        .eq("id", stepId);

      try {
        const result = await step.handler(supabase, stepId);

        // Mark step as SUCCESS
        await supabase
          .from("pipeline_steps")
          .update({
            status: "SUCCESS",
            completed_at: new Date().toISOString(),
            records_processed: result.recordsProcessed ?? 0,
            records_created: result.recordsCreated ?? 0,
            records_updated: result.recordsUpdated ?? 0,
            records_failed: result.recordsFailed ?? 0,
            metadata: result.metadata ?? {},
          })
          .eq("id", stepId);

        completedCount++;
        console.log(`Step ${step.name} completed successfully`);
      } catch (stepError) {
        const errorMessage = stepError instanceof Error ? stepError.message : String(stepError);
        console.error(`Step ${step.name} failed:`, errorMessage);

        // Mark step as FAIL
        await supabase
          .from("pipeline_steps")
          .update({
            status: "FAIL",
            completed_at: new Date().toISOString(),
            error_sample: errorMessage.substring(0, 1000),
          })
          .eq("id", stepId);

        failedCount++;
        errors.push(`${step.name}: ${errorMessage}`);
      }

      // Update run progress
      await supabase
        .from("pipeline_runs")
        .update({
          completed_steps: completedCount,
          failed_steps: failedCount,
        })
        .eq("id", runId);
    }

    // Determine final status
    let finalStatus: "SUCCESS" | "PARTIAL_FAIL" | "FAIL";
    if (failedCount === 0) {
      finalStatus = "SUCCESS";
    } else if (completedCount > 0) {
      finalStatus = "PARTIAL_FAIL";
    } else {
      finalStatus = "FAIL";
    }

    // Update run with final status
    await supabase
      .from("pipeline_runs")
      .update({
        status: finalStatus,
        completed_at: new Date().toISOString(),
        error_summary: errors.length > 0 ? errors.join("; ") : null,
      })
      .eq("id", runId);

    // Release the advisory lock
    await supabase.rpc("release_pipeline_lock");

    // Post Slack summary if webhook is configured
    const slackWebhookUrl = Deno.env.get("SLACK_WEBHOOK_URL");
    if (slackWebhookUrl) {
      try {
        const emoji = finalStatus === "SUCCESS" ? "✅" : finalStatus === "PARTIAL_FAIL" ? "⚠️" : "❌";
        const slackMessage = {
          text: `${emoji} Daily Pipeline ${finalStatus}`,
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `${emoji} *Daily Pipeline ${finalStatus}*\n` +
                  `Steps: ${completedCount}/${stepsToRun.length} succeeded, ${failedCount} failed\n` +
                  `Run ID: \`${runId}\``,
              },
            },
          ],
        };

        if (errors.length > 0) {
          slackMessage.blocks.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Errors:*\n${errors.slice(0, 3).map(e => `• ${e}`).join("\n")}`,
            },
          });
        }

        await fetch(slackWebhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(slackMessage),
        });
      } catch (slackError) {
        console.error("Failed to send Slack notification:", slackError);
      }
    }

    console.log(`Pipeline run completed: ${runId} with status ${finalStatus}`);

    return new Response(
      JSON.stringify({
        run_id: runId,
        status: finalStatus,
        completed_steps: completedCount,
        failed_steps: failedCount,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Pipeline error:", error);
    
    // Make sure to release lock on error
    try {
      await supabase.rpc("release_pipeline_lock");
    } catch (unlockError) {
      console.error("Failed to release lock:", unlockError);
    }

    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : "Unknown error" 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }
});
