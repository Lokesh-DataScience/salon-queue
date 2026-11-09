// backend/src/services/barberScope.service.ts
// Who is asking, and which barber's line is this request about?
//   staff (BARBER)  always their own line; a ?laneId=... in the request is ignored
//   owner           their own line by default, or any line of the salon via ?laneId=...
// Everything is read from the database on each request (not from the token), so a barber who has
// been switched off loses access to the queue immediately, not when the token expires.
import { supabase } from '../config/supabase';
import { AppError } from '../middleware/errorHandler';

export interface LaneInfo {
  id: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
  isPaused: boolean;
}

export interface BarberScope {
  salonId: string;
  staffId: string;
  isOwner: boolean;
  /** More than one active barber. With one barber everything works exactly as it always did. */
  multi: boolean;
  /** The line this request is about. */
  laneId: string;
  laneName: string;
  laneIsPaused: boolean;
  /** The signed-in person's own line. */
  ownLaneId: string;
  lanes: LaneInfo[];
  /** Entry-level actions: staff may only touch their own line (a lane id); the owner may touch any (null). */
  entryLaneId: string | null;
}

export async function resolveScope(
  staff: { staffId: string; salonId: string; role: string },
  requestedLaneId?: string,
): Promise<BarberScope> {
  const [meRes, lanesRes] = await Promise.all([
    supabase
      .from('salon_staff')
      .select('id, lane_id, is_active')
      .eq('id', staff.staffId)
      .eq('salon_id', staff.salonId)
      .maybeSingle(),
    supabase
      .from('lanes')
      .select('id, name, is_default, is_active, is_paused')
      .eq('salon_id', staff.salonId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true }),
  ]);
  if (meRes.error) throw meRes.error;
  if (lanesRes.error) throw lanesRes.error;

  const me = meRes.data;
  if (!me || !me.is_active) throw new AppError('Session expired. Please log in again.', 401);

  const lanes: LaneInfo[] = (lanesRes.data ?? []).map((l) => ({
    id: l.id as string,
    name: l.name as string,
    isDefault: Boolean(l.is_default),
    isActive: Boolean(l.is_active),
    isPaused: Boolean(l.is_paused),
  }));
  const fallback = lanes.find((l) => l.isDefault) ?? lanes[0];
  if (!fallback) throw new AppError('This salon has no queue line yet.', 409);

  const isOwner = staff.role === 'OWNER';
  const own = lanes.find((l) => l.id === me.lane_id) ?? fallback;

  let lane = own;
  if (isOwner && requestedLaneId) {
    const wanted = lanes.find((l) => l.id === requestedLaneId);
    if (!wanted) throw new AppError('Line not found.', 404); // another salon's line looks like no line
    lane = wanted;
  }

  return {
    salonId: staff.salonId,
    staffId: staff.staffId,
    isOwner,
    multi: lanes.filter((l) => l.isActive).length > 1,
    laneId: lane.id,
    laneName: lane.name,
    laneIsPaused: lane.isPaused,
    ownLaneId: own.id,
    lanes,
    entryLaneId: isOwner ? null : lane.id,
  };
}
