import { z } from 'zod';
import { route } from '../../apiRegistry';
import { speak } from './service';

route(
  'post',
  '/voice/speak',
  // `priority` is optional so older app builds keep working.
  z.object({ text: z.string().trim().min(1).max(300), locale: z.enum(['ar', 'en']), priority: z.enum(['now', 'soon']).optional() }).strict(),
  (_r, b) => speak(b.text, b.locale, b.priority),
);
