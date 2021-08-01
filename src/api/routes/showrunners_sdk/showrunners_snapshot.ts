import { Router, Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';
import Snapshot from '../../../showrunners-sdk/snapShotChannel';
import middlewares from '../../middlewares';
import { celebrate, Joi } from 'celebrate';

const route = Router();

export default (app: Router) => {
    app.use('/showrunners-sdk/snapshot', route);

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
          Logger.debug('Calling /showrunners-sdk/snapshot ticker endpoint with body: %o', req.body )
          try {
            const snapshot = Container.get(Snapshot);
            const response = await snapshot.sendMessageToContract(req.body.simulate);
    
            return res.status(201).json(response);
          } catch (e) {
            Logger.error('🔥 error: %o', e);
            return next(e);
          }
        },
      );

      route.post(
        '/check_delegates',
        celebrate({
          body: Joi.object({
            simulate: [Joi.bool(), Joi.object()],
          }),
        }),
        middlewares.onlyLocalhost,
        async (req: Request, res: Response, next: NextFunction) => {
          const Logger = Container.get('logger');
          Logger.debug('Calling /showrunners-sdk/snapshot ticker endpoint with body: %o', req.body )
          try {
            const snapshot = Container.get(Snapshot);
            const response = await snapshot.fetchDelegateAndSaveToDB();
    
            return res.status(201).json(response);
          } catch (e) {
            Logger.error('🔥 error: %o', e);
            return next(e);
          }
        },
      );
}