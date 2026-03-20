import 'dotenv/config';
import cron from 'node-cron';
import { runPipeline } from './src/pipeline/index.js';
import { runExperimentLoop, scoreActiveExperiments } from './src/loop/experiment.js';
import { pollAnalytics } from './src/analytics/tracker.js';
import { startDashboard } from './src/dashboard/server.js';
import { startTelegramBot } from './src/telegram/bot.js';
import { isOracleEnabled, getSetting } from './src/utils/settings.js';
import { logActivity } from './src/utils/activity.js';
import { supabase } from './src/utils/supabase.js';
import logger from './src/utils/logger.js';

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

logger.info('ORACLE is watching. The crystal ball is spinning.');
