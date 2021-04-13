import { Router, Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';
import UniSwap from '../../showrunners/uniSwapChannel';
import middlewares from '../middlewares';
import { celebrate, Joi } from 'celebrate';

const route = Router();

export default (app: Router) => {
  app.use('/showrunners/uniswap', route);

  // to add an incoming feed
  route.post(
    '/send_message',
    celebrate({
      body: Joi.object({
        simulate: [Joi.bool(), Joi.object()],
      }),
    }),
    middlewares.onlyLocalhost,
    async (req: Request, res: Response, next: NextFunction) => {
      const Logger = Container.get('logger');
      Logger.debug('Calling /showrunners/everest ticker endpoint with body: %o', req.body )
      try {
        const everest = Container.get(UniSwap);
        const { success,  data } = await everest.sendMessageToContract(req.body.simulate);

        return res.status(201).json({ success,  data });
      } catch (e) {
        Logger.error('🔥 error: %o', e);
        return next(e);
      }
    },
  );

  route.post(
    '/check_for_new_proposal',
    celebrate({
      body: Joi.object({
        uniSwapNetwork: Joi.string().required(),
        fromBlock: Joi.number().required(),
        simulate: [Joi.bool(), Joi.object()],
      }),
    }),
    middlewares.onlyLocalhost,
    async (req: Request, res: Response, next: NextFunction) => {
      const Logger = Container.get('logger');
      Logger.debug('Calling /showrunners/everest ticker endpoint with body: %o', req.body )
      try {
        const everest = Container.get(UniSwap);
        const response = await everest.checkForNewProposal(req.body.uniSwapNetwork, null, req.body.fromBlock, null, req.body.simulate);

        return res.status(201).json(response);
      } catch (e) {
        Logger.error('🔥 error: %o', e);
        return next(e);
      }
    },
  );

};
