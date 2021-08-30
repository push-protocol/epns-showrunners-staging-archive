import { Router, Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';

import { celebrate, Joi } from 'celebrate';

import BProtocol from './bProtocolChannel';
import middlewares from '../../api/middlewares';
import { handleResponse } from '../../helpers/utilsHelper';

const route = Router();

export default (app: Router) => {
  app.use('/showrunners/bprotocol', route);

  /**
   * Send Message
   * @description Send a notification via the compound showrunner
   * @param {boolean} simulate whether to send the actual message or simulate message sending
   */
  route.post(
    '/send_message',
    celebrate({
      body: Joi.object({
        simulate: [Joi.bool(), Joi.object()],
      }),
    }), 
    middlewares.onlyLocalhost,
    async (req: Request, res: Response, next: NextFunction) => {
      const Logger: any = Container.get('logger');
      Logger.debug('Calling /showrunners/bprotocol/send_message endpoint with body: %o', req.body);
      try {
        const bProtocolLiquidation = Container.get(BProtocol);
        console.log(bProtocolLiquidation);
        const { success, data } = await bProtocolLiquidation.sendMessageToContract(req.body.simulate);

        return handleResponse(res, 201, true, success, data);
      } catch (e) {
        Logger.error('🔥 error: %o', e);
        return handleResponse(res, 500, false, 'error', JSON.stringify(e));
      }
    },
  );
};
