import { z } from 'zod';
import { route } from '../../apiRegistry';
import { speak } from './service';

route(
  'post',
  '/voice/speak',
  z.object({ text: z.string().trim().min(1).max(300), locale: z.enum(['ar', 'en']) }).strict(),
  (_r, b) => speak(b.text, b.locale),
);
