import { Router, Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';
import PoolTogetherChannel from '../../../showrunners-sdk/poolTogetherChannel';
import middlewares from '../../middlewares';
import { celebrate, Joi } from 'celebrate';

const route = Router();

export default (app: Router) => {
  app.use('/showrunners-sdk/pooltogether', route);

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
      Logger.debug('Calling /showrunners-sdk/pooltogether ticker endpoint with body: %o', req.body )
      try {
        const poolTogether = Container.get(PoolTogetherChannel);
        const response = await poolTogether.sendMessageToContract(req.body.simulate);

        return res.status(201).json(response);
      } catch (e) {
        Logger.error('🔥 error: %o', e);
        return next(e);
      }
    },
  );

  route.post(
    '/check_new_winner',
    celebrate({
      body: Joi.object({
        web3network: Joi.string().required(),
        poolTogether,
        fromBlock: Joi.number().required(),
        toBlock: Joi.number(),
        simulate: [Joi.bool(), Joi.object()],
      }),
    }),
    middlewares.onlyLocalhost,
    async (req: Request, res: Response, next: NextFunction) => {
      const Logger = Container.get('logger');
      Logger.debug('Calling /showrunners-sdk/pooltogether ticker endpoint with body: %o', req.body )
      try {
        const poolTogether = Container.get(PoolTogetherChannel);
        const response = await poolTogether.getWinners(req.body.web3network, null, req.body.fromBlock, req.body.toBlock, req.body.simulate);

        return res.status(201).json(response);
      } catch (e) {
        Logger.error('🔥 error: %o', e);
        return next(e);
      }
    },
  );
};
