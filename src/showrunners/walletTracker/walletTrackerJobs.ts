// Do Scheduling
// https://github.com/node-schedule/node-schedule
// *    *    *    *    *    *
// ┬    ┬    ┬    ┬    ┬    ┬
// │    │    │    │    │    │
// │    │    │    │    │    └ day of week (0 - 7) (0 or 7 is Sun)
// │    │    │    │    └───── month (1 - 12)
// │    │    │    └────────── day of month (1 - 31)
// │    │    └─────────────── hour (0 - 23)
// │    └──────────────────── minute (0 - 59)
// └───────────────────────── second (0 - 59, OPTIONAL)
// Execute a cron job every 5 Minutes = */5 * * * *
// Starts from seconds = * * * * * *

import config from '../../config';
import logger from '../../loaders/logger';

import { Container } from 'typedi';
import schedule from 'node-schedule';

import WalletTrackerChannel from './walletTrackerChannel';

export default () => {
    const startTime = new Date(new Date().setHours(0, 0, 0, 0));

    const dailyRule = new schedule.RecurrenceRule();
    dailyRule.hour = 0;
    dailyRule.minute = 0;
    dailyRule.second = 0;
    dailyRule.dayOfWeek = new schedule.Range(0, 6);

    const thirtyMinuteRule = new schedule.RecurrenceRule();
    thirtyMinuteRule.minute = new schedule.Range(0, 59, 30);

   // 1.7 WALLET TRACKER CHANNEL
   logger.info(`     🛵 Scheduling Showrunner - Wallet Tracker Channel [on 30 Minutes] [${new Date(Date.now())}]`);
   schedule.scheduleJob({ start: startTime, rule: thirtyMinuteRule }, async function () {
    const walletTracker = Container.get(WalletTrackerChannel);
    const taskName = 'Track wallets on every new block mined';

    try {
      await walletTracker.sendMessageToContract(false);
      logger.info(`[${new Date(Date.now())}] 🐣 Cron Task Completed -- ${taskName}`);
    }
    catch (err) {
      logger.error(`[${new Date(Date.now())}] ❌ Cron Task Failed -- ${taskName}`);
      logger.error(`[${new Date(Date.now())}] Error Object: %o`, err);
    }
  });
};
