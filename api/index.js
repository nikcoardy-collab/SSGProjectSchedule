// Vercel serverless entry point: every /api/* request is rewritten here by vercel.json.
// Static files are served by Vercel's CDN from client/dist, so this app handles the API
// only.
import { createApp } from '../server/app.js';

export default createApp({ serveClient: false });
