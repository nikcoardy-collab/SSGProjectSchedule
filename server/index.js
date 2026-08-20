import 'dotenv/config';
import { createApp } from './app.js';

const PORT = Number(process.env.PORT) || 4000;

createApp().listen(PORT, () => {
  console.log(`SSG Project Schedule listening on http://localhost:${PORT}`);
});
