import express from 'express';
import { salesAgentRouter } from './src/server/salesAgentRouter';

export function registerSalesAgent(app: express.Express) {
  app.use(salesAgentRouter);
}
