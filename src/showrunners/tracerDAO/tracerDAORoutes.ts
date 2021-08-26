import { Router, Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';
import TracerDAOChannel from "./tracerDAOChannel"
import middlewares from '../../api/middlewares';
import { celebrate, Joi } from 'celebrate';

const route = Router();

export default (app: Router) => {
    app.use('/showrunners-sdk/tracerdao', route);
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
          Logger.debug('Calling /showrunners-sdk/tracerdao ticker endpoint with body: %o', req.body )
          try {
            const tracer = Container.get(TracerDAOChannel);
            const response = await tracer.sendMessageToContract(req.body.simulate);
    
            return res.status(201).json(response);
          } catch (e) {
            Logger.error('🔥 error: %o', e);
            return next(e);
          }
        },
      );

      route.post(
        '/send_vote_result',
        celebrate({
          body: Joi.object({
            simulate: [Joi.bool(), Joi.object()],
          }),
        }),
        middlewares.onlyLocalhost,
        async (req: Request, res: Response, next: NextFunction) => {
          const Logger = Container.get('logger');
          Logger.debug('Calling /showrunners-sdk/tracerdao ticker endpoint with body: %o', req.body )
          try {
            const tracer = Container.get(TracerDAOChannel);
            const response = await tracer.fetchVotesForFinsihedProposal(req.body.simulate);
    
            return res.status(201).json(response);
          } catch (e) {
            Logger.error('🔥 error: %o', e);
            return next(e);
          }
        },
      );

}