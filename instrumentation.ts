/**
 * Next.js server boot hook.
 *
 * Starts Slack Socket Mode inside the long-lived `next start` / `next dev`
 * Node process when SLACK_APP_TOKEN is set. See docs/slack-regi.md.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  try {
    const { shouldStartSocketModeInProcess, startSlackSocketMode } = await import(
      "./lib/slack/socket"
    );
    if (!shouldStartSocketModeInProcess()) return;
    // Do not block Next.js becoming ready on Slack connecting.
    void startSlackSocketMode({ source: "instrumentation" }).then((result) => {
      if (!result.started && result.reason !== "not_configured") {
        console.warn(
          JSON.stringify({
            ts: new Date().toISOString(),
            level: "warn",
            message: "slack_socket_instrumentation_skipped",
            meta: { reason: result.reason },
          }),
        );
      }
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        message: "slack_socket_instrumentation_failed",
        meta: {
          error: error instanceof Error ? error.message : "unknown",
        },
      }),
    );
  }
}
