import 'dotenv/config';
import cron from 'node-cron';
import { runPipeline } from './src/pipeline/index.js';
import { runExperimentLoop, scoreActiveExperiments } from './src/loop/experiment.js';
import { pollAnalytics } from './src/analytics/tracker.js';
import { startDashboard } from './src/dashboard/server.js';
import { startTelegramBot } from './src/telegram/bot.js';
import { isEngineEnabled } from './src/utils/engine-state.js';
import logger from './src/utils/logger.js';

// Dashboard and Telegram always run regardless of engine state
startDashboard();
startTelegramBot();

// Main pipeline: nightly at 01:00 UTC
cron.schedule('0 1 * * *', async () => {
  if (!isEngineEnabled()) {
    logger.info('ORACLE engine is OFF — pipeline skipped');
    return;
  }
  logger.info('ORACLE pipeline starting (scheduled)');
  await runPipeline();
});

// Score experiments + generate next hypothesis: every 6 hours
cron.schedule('0 */6 * * *', async () => {
  if (!isEngineEnabled()) {
    logger.info('ORACLE engine is OFF — experiment loop skipped');
    return;
  }
  logger.info('Running experiment scoring and loop');
  await scoreActiveExperiments();
  await runExperimentLoop();
});

// Analytics polling: every 2 hours
cron.schedule('0 */2 * * *', async () => {
  if (!isEngineEnabled()) {
    logger.info('ORACLE engine is OFF — analytics poll skipped');
    return;
  }
  logger.info('Polling analytics');
  await pollAnalytics();
});

logger.info('ORACLE is watching. The crystal ball is spinning.');
