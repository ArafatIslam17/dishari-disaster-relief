import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { uuidSchema } from '@relief/shared';
import { z } from 'zod';
import { authOf, requireAuth } from '../auth/guard.js';
import { notification } from '../db/schema.js';
import { notFound } from '../lib/errors.js';

/** UC20 View Notifications: only the recipient can read or mark a notification. */
export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;
  const authed = requireAuth(ctx);

  app.get('/api/notifications', { preHandler: authed }, async (request) => {
    const auth = authOf(request);
    const rows = await ctx.db
      .select()
      .from(notification)
      .where(eq(notification.userId, auth.userId))
      .orderBy(desc(notification.createdAt))
      .limit(100);
    const [{ unread } = { unread: 0 }] = await ctx.db
      .select({ unread: sql<number>`count(*)::int` })
      .from(notification)
      .where(and(eq(notification.userId, auth.userId), eq(notification.isRead, false)));
    return {
      unread,
      notifications: rows.map((n) => ({
        id: n.id,
        type: n.type,
        params: n.params,
        link: n.link,
        isRead: n.isRead,
        createdAt: n.createdAt.toISOString(),
      })),
    };
  });

  app.post('/api/notifications/:id/read', { preHandler: authed }, async (request) => {
    const auth = authOf(request);
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const updated = await ctx.db
      .update(notification)
      .set({ isRead: true, readAt: ctx.now() })
      .where(and(eq(notification.id, id), eq(notification.userId, auth.userId)))
      .returning({ id: notification.id });
    if (updated.length === 0) throw notFound('notification_not_found');
    return { ok: true };
  });

  app.post('/api/notifications/read-all', { preHandler: authed }, async (request) => {
    const auth = authOf(request);
    await ctx.db
      .update(notification)
      .set({ isRead: true, readAt: ctx.now() })
      .where(and(eq(notification.userId, auth.userId), eq(notification.isRead, false)));
    return { ok: true };
  });
}
