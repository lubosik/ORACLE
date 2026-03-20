import { supabase } from '../utils/supabase.js';
import { getSetting } from '../utils/settings.js';
import { logActivity } from '../utils/activity.js';

export async function selectInboxes() {
  const requireWarm = (await getSetting('require_warm_inboxes_only', 'true')) === 'true';
  const count = parseInt(await getSetting('inboxes_per_campaign', '3'));

  // Query the view which computes is_warm and days_warmed
  let query = supabase
    .from('inbox_registry_status')
    .select('*')
    .eq('is_active', true)
    .order('last_used_at', { ascending: true, nullsFirst: true });

  if (requireWarm) {
    query = query.eq('is_warm', true);
  }

  const { data: inboxes, error } = await query;

  if (error || !inboxes || inboxes.length === 0) {
    await logActivity({
      category: 'inbox',
      level: 'error',
      message: 'No warm inboxes available for campaign. Check inbox_registry.',
      detail: { requireWarm, error: error?.message }
    });
    throw new Error('No warm inboxes available');
  }

  if (inboxes.length < count) {
    await logActivity({
      category: 'inbox',
      level: 'warning',
      message: `Only ${inboxes.length} warm inbox(es) available — expected ${count}. Proceeding with what is available.`
    });
  }

  // Randomly shuffle and take required count
  const shuffled = inboxes.sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, Math.min(count, inboxes.length));

  await logActivity({
    category: 'inbox',
    level: 'info',
    message: `Inboxes selected for campaign: ${selected.map(i => i.email).join(', ')}`,
    detail: { selected: selected.map(i => ({ email: i.email, days_warmed: i.days_warmed, is_warm: i.is_warm })) }
  });

  return selected.map(i => i.email);
}

export async function markInboxesUsed(emails) {
  await supabase
    .from('inbox_registry')
    .update({ last_used_at: new Date().toISOString() })
    .in('email', emails);
}
