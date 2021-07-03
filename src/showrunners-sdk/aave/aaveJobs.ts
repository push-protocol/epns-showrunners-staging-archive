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

import AaveChannel from './aaceChannel';

export default () => {
  const startTime = new Date(new Date().setHours(0, 0, 0, 0));

  const dailyRule = new schedule.RecurrenceRule();
  dailyRule.hour = 0;
  dailyRule.minute = 0;
  dailyRule.second = 0;
  dailyRule.dayOfWeek = new schedule.Range(0, 6);

  const thirtyMinuteRule = new schedule.RecurrenceRule();
  thirtyMinuteRule.second = new schedule.Range(0, 0, 0, 5);

  // AAVE CHANNEL RUNS EVERY 24 Hours
  logger.info('     🛵 Scheduling Showrunner - Aave Channel [on 24 Hours]');
  schedule.scheduleJob({ start: startTime, rule: thirtyMinuteRule }, async function () {
    const aaveTicker = Container.get(AaveChannel);
    console.log(aaveTicker)
    // console.log("here")
    // const taskName = 'Aave users address checks and sendMessageToContract()';
    //
    // try {
    //   await aaveTicker.sendMessageToContract(false);
    //   logger.info(`🐣 Cron Task Completed -- ${taskName}`);
    // }
    // catch (err) {
    //   logger.error(`❌ Cron Task Failed -- ${taskName}`);
    //   logger.error(`Error Object: %o`, err);
    // }
  });
};
