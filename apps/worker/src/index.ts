import { handleRequest } from './handler';
import { runMaintenance } from './maintenance';
import type { Env } from './types';

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, env, ctx);
  },

  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(runMaintenance(env));
  },
} satisfies ExportedHandler<Env>;
