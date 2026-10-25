import { startServer } from './server.mjs';
startServer({ port: Number(process.env.PORT ?? 4173), host: process.env.HOST ?? '127.0.0.1' });
