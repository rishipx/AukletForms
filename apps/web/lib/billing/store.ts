import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import type { BillingStore, ProfilePatch, ProfileRef } from './handlers';

const PROFILE_REF_COLUMNS = 'id,plan_tier,billing_customer_id,billing_subscription_id,billing_updated_at';

/** Postgres unique-violation: the webhook id was already claimed. */
const UNIQUE_VIOLATION = '23505';

export function createSupabaseBillingStore(): BillingStore {
  const db = createAdminClient();

  async function findOne(column: 'id' | 'billing_customer_id', value: string): Promise<ProfileRef | null> {
    const { data, error } = await db.from('profiles').select(PROFILE_REF_COLUMNS).eq(column, value).maybeSingle();
    if (error) throw new Error(`profile lookup by ${column} failed: ${error.message}`);
    return (data as ProfileRef | null) ?? null;
  }

  return {
    async claimEvent(webhookId, type) {
      const { error } = await db.from('billing_events').insert({ id: webhookId, type });
      if (!error) return true;
      if (error.code === UNIQUE_VIOLATION) return false;
      throw new Error(`claiming billing event failed: ${error.message}`);
    },

    async releaseEvent(webhookId) {
      const { error } = await db.from('billing_events').delete().eq('id', webhookId);
      if (error) throw new Error(`releasing billing event failed: ${error.message}`);
    },

    findProfileById: (id) => findOne('id', id),
    findProfileByCustomerId: (customerId) => findOne('billing_customer_id', customerId),

    async findProfileByEmail(email) {
      // Case-insensitive, and refuse to guess when the match is ambiguous.
      const { data, error } = await db
        .from('profiles')
        .select(PROFILE_REF_COLUMNS)
        .ilike('email', email.replace(/[\\%_]/g, '\\$&'))
        .limit(2);
      if (error) throw new Error(`profile lookup by email failed: ${error.message}`);
      const rows = (data ?? []) as ProfileRef[];
      return rows.length === 1 ? (rows[0] ?? null) : null;
    },

    async updateProfile(id, patch: ProfilePatch) {
      const { data, error } = await db.from('profiles').update(patch).eq('id', id).select('id');
      if (error) throw new Error(`profile update failed: ${error.message}`);
      if (!data || data.length === 0) throw new Error(`profile ${id} no longer exists`);
    },
  };
}
