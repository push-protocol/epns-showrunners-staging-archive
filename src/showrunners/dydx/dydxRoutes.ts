import { Router, Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';

import middlewares from '../../api/middlewares';
import { celebrate, Joi } from 'celebrate';
import DYDXChannel from './dydxChannel';

const route = Router();

export default (app: Router) => {
  app.use('/showrunners/dydx', route);

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
      Logger.debug('Calling /showrunners/dydx ticker endpoint with body: %o', req.body);
      try {
        const dydx = Container.get(DYDXChannel);
        await dydx.proposalCreatedTask(req.body.simulate);
        await dydx.proposalQueuedTask(req.body.simulate);
        await dydx.proposalExecutedTask(req.body.simulate);

        return res.status(201).json({ success: true });
      } catch (e) {
        Logger.error('🔥 error: %o', e);
        return next(e);
      }
    },
  );
};
