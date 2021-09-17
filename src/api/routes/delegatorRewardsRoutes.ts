import { Router, Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';
import DelegatorRewards from '../../services/delegatorRewards';
import middlewares from '../middlewares';
import { celebrate, Joi } from 'celebrate';

const route = Router();

export default (app: Router) => {
  app.use('/showrunners/delegator_rewards', route);

  route.post(
    '/getDelegatorInfo',
    celebrate({
      body: Joi.object({
        simulate: [Joi.bool(), Joi.object()],
      }),
    }),
    middlewares.onlyLocalhost,
    async (req: Request, res: Response, next: NextFunction) => {
      const Logger = Container.get('logger');
      Logger.debug('Calling /showrunners/delegator_rewards/getDelegatorInfo endpoint with body: %o', req.body )
      try {
        const delegatorRewards = Container.get(DelegatorRewards);
        const result = await delegatorRewards.getDelegatorInfo();

        return res.status(201).json({result});
      } catch (e) {
        Logger.error('🔥 error: %o', e);
        return next(e);
      }
    },
  );

  
};
