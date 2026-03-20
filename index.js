import 'dotenv/config';
import cron from 'node-cron';

// Prevent unhandled errors from silently killing the process on Railway
process.on('uncaughtException', (err) => {
  console.error('[ORACLE] uncaughtException — process kept alive:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[ORACLE] unhandledRejection — process kept alive:', reason);
});
import { runPipeline } from './src/pipeline/index.js';
import { runExperimentLoop, scoreActiveExperiments } from './src/loop/experiment.js';
import { pollAnalytics } from './src/analytics/tracker.js';
import { startDashboard } from './src/dashboard/server.js';
import { startTelegramBot } from './src/telegram/bot.js';
import { isOracleEnabled, getSetting } from './src/utils/settings.js';
import { logActivity } from './src/utils/activity.js';
import { supabase } from './src/utils/supabase.js';
import logger from './src/utils/logger.js';

// Karpathy research modules
import { classifyAndAnalyzeReplies } from './src/loop/reply_analyzer.js';
import { analyzeICPPerformance } from './src/loop/icp_refiner.js';
import { analyzeStepPerformance } from './src/loop/step_analyzer.js';
import { synthesizeWinners } from './src/loop/winner_synthesizer.js';
import { evolveProgramIfReady } from './src/loop/program_evolver.js';
import { monitorDeliverability } from './src/loop/deliverability_monitor.js';
import { analyzeCohorts } from './src/loop/cohort_analyzer.js';
import { proposeVerticalExpansion } from './src/loop/vertical_researcher.js';
import { checkForEarlyAbort } from './src/loop/early_abort.js';

// Dashboard and Telegram always run regardless of engine state
startDashboard();
startTelegramBot();

// Main pipeline: nightly at 01:00 UTC
cron.schedule('0 1 * * *', async () => {
  if (!(await isOracleEnabled())) {
    logger.info('ORACLE is OFF — pipeline skipped');
    return;
  }
  logger.info('ORACLE pipeline starting (scheduled)');
  await runPipeline();
});

// Early abort check: every 4 hours — fast-fail broken experiments before the 7-day window
cron.schedule('0 */4 * * *', async () => {
  if (!(await isOracleEnabled())) return;
  logger.info('Running early abort check');
  await checkForEarlyAbort();
});

// Score experiments + generate next hypothesis: every 6 hours
cron.schedule('0 */6 * * *', async () => {
  if (!(await isOracleEnabled())) {
    logger.info('ORACLE is OFF — experiment loop skipped');
    return;
  }
  logger.info('Running experiment scoring and loop');
  await scoreActiveExperiments();
  await runExperimentLoop();
});

// Analytics polling: every 2 hours
cron.schedule('0 */2 * * *', async () => {
  if (!(await isOracleEnabled())) {
    logger.info('ORACLE is OFF — analytics poll skipped');
    return;
  }
  logger.info('Polling analytics');
  await pollAnalytics();
});

// Draft expiry: hourly — expire pending drafts older than approval_timeout_hours
cron.schedule('0 * * * *', async () => {
  try {
    const timeoutHours = parseInt(await getSetting('approval_timeout_hours', '24'));
    const cutoff = new Date(Date.now() - timeoutHours * 60 * 60 * 1000).toISOString();

    const { data: expired } = await supabase
      .from('campaign_drafts')
      .update({ status: 'expired', actioned_at: new Date().toISOString() })
      .eq('status', 'pending')
      .lt('created_at', cutoff)
      .select();

    if (expired && expired.length > 0) {
      for (const draft of expired) {
        await logActivity({
          category: 'draft',
          level: 'warning',
          message: `Campaign draft expired — ${draft.campaign_name} (${timeoutHours}h timeout)`
        });
      }
    }
  } catch (err) {
    logger.error('Draft expiry cron failed', { error: err.message });
  }
});

// ---- Karpathy Research Layer crons ----

// Reply classification + clustering: every 4 hours
cron.schedule('0 */4 * * *', async () => {
  if (!(await isOracleEnabled())) return;
  logger.info('Running reply classification and analysis');
  await classifyAndAnalyzeReplies();
});

// ICP refinement + cohort analysis: every 12 hours
cron.schedule('0 */12 * * *', async () => {
  if (!(await isOracleEnabled())) return;
  logger.info('Running ICP refinement and cohort analysis');
  await analyzeICPPerformance();
  await analyzeCohorts();
});

// Step attribution: every 8 hours
cron.schedule('0 */8 * * *', async () => {
  if (!(await isOracleEnabled())) return;
  logger.info('Running email step attribution analysis');
  await analyzeStepPerformance();
});

// Winner synthesis: daily at 03:00 UTC
cron.schedule('0 3 * * *', async () => {
  if (!(await isOracleEnabled())) return;
  logger.info('Running winner synthesis');
  await synthesizeWinners();
});

// Program evolution: every 3 days at 04:00 UTC (Mon, Wed, Fri)
cron.schedule('0 4 * * 1,3,5', async () => {
  if (!(await isOracleEnabled())) return;
  logger.info('Checking if program evolution is ready');
  await evolveProgramIfReady();
});

// Deliverability monitoring: every 2 hours (aligned with analytics poll)
cron.schedule('30 */2 * * *', async () => {
  if (!(await isOracleEnabled())) return;
  await monitorDeliverability();
});

// Vertical expansion research: weekly on Sunday at 05:00 UTC
cron.schedule('0 5 * * 0', async () => {
  if (!(await isOracleEnabled())) return;
  logger.info('Running vertical expansion research');
  await proposeVerticalExpansion();
});

logger.info('ORACLE is watching. The crystal ball is spinning.');
