// Usage (from backend/):
//   npm run db:backfill-places -- --project <ref>            (dry run: prints what it would set)
//   npm run db:backfill-places -- --project <ref> --apply
import { env } from '../src/config/env';
import { parseArgs } from 'node:util';
import { supabase } from '../src/config/supabase';
import { reverseGeocode } from '../src/services/geocode.service';
import { assignPlaceToSalon } from '../src/services/place.service';

const { values } = parseArgs({
  options: { project: { type: 'string' }, apply: { type: 'boolean', default: false } },
});

async function main() {
  const targetRef = new URL(env.SUPABASE_URL).hostname.split('.')[0];
  if (!values.project || targetRef !== values.project) {
    console.error(`Refusing to run: this would use project "${targetRef}", but you asked for "${values.project}".`);
    process.exit(1);
  }
  console.log(`Project ${targetRef}${values.apply ? ' (APPLYING)' : ' (dry run)'}`);

  const { data: salons, error } = await supabase
    .from('salons')
    .select('id, name, latitude, longitude')
    .is('place_id', null);
  if (error) throw error;

  for (const s of salons ?? []) {
    try {
      const g = await reverseGeocode(Number(s.latitude), Number(s.longitude));
      console.log(`${s.name}: district="${g.district}" state="${g.state}"`);
      if (!g.district && !g.state) {
        console.log('  -> nothing found, skipped');
        continue;
      }
      if (values.apply) await assignPlaceToSalon(s.id, { district: g.district, state: g.state });
    } catch {
      console.log(`${s.name}: lookup failed, skipped`);
    }
  }
}

void main();