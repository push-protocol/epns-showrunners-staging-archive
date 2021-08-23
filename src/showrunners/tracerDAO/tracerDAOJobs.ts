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

import TracerDAOChannel from "./tracerDAOChannel"

export default () => {
    const startTime = new Date(new Date().setHours(0, 0, 0, 0));

    const threeHourRule = new schedule.RecurrenceRule();
    threeHourRule.hour = new schedule.Range(0, 23, 3);
    threeHourRule.minute = 0;
    threeHourRule.second = 0;

    const sixHourRule = new schedule.RecurrenceRule();
    sixHourRule.hour = new schedule.Range(0, 23, 6);
    sixHourRule.minute = 0;
    sixHourRule.second = 0;


        //TracerDAO send new proposal
        logger.info('-- 🛵 Scheduling Showrunner - TracerDAO Channel [on 3hr ]');
        schedule.scheduleJob({ start: startTime, rule: threeHourRule }, async function () {
            const tracerdao = Container.get(TracerDAOChannel);
            const taskName = 'TracerDAO proposal event checks and sendMessageToContract()';
            try {
                await tracerdao.sendMessageToContract(false);
                logger.info(`🐣 Cron Task Completed -- ${taskName}`);
            }
            catch (err) {
                logger.error(`❌ Cron Task Failed -- ${taskName}`);
                logger.error(`Error Object: %o`, err);
            }
        })

            //TracerDAO send finsished proposals
    logger.info('-- 🛵 Scheduling Showrunner - TracerDAO Channel [on 6 Hours]');
    schedule.scheduleJob({ start: startTime, rule: sixHourRule }, async function () {
        const tarcerdao = Container.get(TracerDAOChannel);
        const taskName = 'TracerDAO checking finsihed proposals';
        try {
            await tarcerdao.fetchVotesForFinsihedProposal(false);
            logger.info(`🐣 Cron Task Completed -- ${taskName}`);
        }
        catch (err) {
            logger.error(`❌ Cron Task Failed -- ${taskName}`);
            logger.error(`Error Object: %o`, err);
        }
    })

}