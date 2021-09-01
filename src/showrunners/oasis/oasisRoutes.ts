import { Router, Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';

import { celebrate, Joi } from 'celebrate';

import OasisChannel from "./oasisChannel"
import middlewares from '../../api/middlewares';
import { handleResponse } from '../../helpers/utilsHelper';

const route = Router();

export default (app: Router) => {
    app.use('/showrunners/oasis', route);

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
            Logger.debug('Calling /showrunners/oasis/send_message ticker endpoint with body: %o', req.body )
            try{
                const bzx = Container.get(OasisChannel);
                const response = await bzx.sendMessageToContract(req.body.simulate);

                return res.status(201).json(response);
            } catch (e) {
                Logger.error('🔥 error: %o', e);
                return next(e);
            }
        }
    )
}