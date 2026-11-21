import type { SupabaseClient } from '@supabase/supabase-js';
import { subscribeArenaCatalogBatch, type ArenaCatalogEvent, type ArenaCatalogPort, type CatalogOptions } from '../packages/data/arena-catalog-realtime';
export type { ArenaCatalogEntity, ArenaCatalogEvent } from '../packages/data/arena-catalog-realtime';

export function subscribeToArenaCatalogBatch(client: SupabaseClient, groupId: string,
  changed: (events: readonly ArenaCatalogEvent[]) => void, options: CatalogOptions = {}) {
  const port: ArenaCatalogPort = {
    authenticate: () => client.realtime.setAuth(),
    channel: (topic, receive) => {
      const channel = client.channel(topic, { config: { private: true } })
        .on('broadcast', { event: 'catalog_changed' }, ({ payload }) => receive(payload));
      return { subscribe: status => channel.subscribe(status), remove: () => client.removeChannel(channel), teardown: () => channel.teardown() };
    },
  };
  return subscribeArenaCatalogBatch(client, port, groupId, changed, options);
}
export function subscribeToArenaCatalog(client: SupabaseClient, groupId: string,
  changed: (event: ArenaCatalogEvent) => void, options: CatalogOptions = {}) {
  return subscribeToArenaCatalogBatch(client, groupId, events => events.forEach(event => changed(event)), options);
}
